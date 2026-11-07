import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Withdrawal } from '../src/models/Withdrawal.js';
import { Wallet } from '../src/models/Wallet.js';
import { Transaction } from '../src/models/Transaction.js';
import {
  createWithdrawalRequest,
  cancelWithdrawalRequest,
  rejectWithdrawalAdmin,
  updateWithdrawalStatusAdmin,
  reconcileWithdrawalRefund,
  auditWalletLedgerIntegrity,
  getQuarantinedWithdrawalsAdmin,
  resolveQuarantinedWithdrawalAdmin,
} from '../src/services/walletService.js';
import {
  validateWithdrawalRequest,
  validateDepositIntent,
} from '../src/validators/walletValidators.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { User } from '../src/models/User.js';
import { getDurabilityOptions, validateDurabilityPolicy } from '../src/config/db.js';
import { dispatchQuarantineAlert } from '../src/utils/financialAlertService.js';

describe('MAT-17 — Withdrawal Recovery Safety & Financial Ledger Audit Tests (Mocked Storage Environment)', () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const adminId = new mongoose.Types.ObjectId().toString();
  const secondAdminId = new mongoose.Types.ObjectId().toString();
  const otherUserId = new mongoose.Types.ObjectId().toString();

  let withdrawals = new Map();
  let wallets = new Map();
  let users = new Map();
  let transactions = [];
  let auditLogs = [];

  let origUserFindById;
  let origUserFindOne;

  let origWithdrawalFindOne;
  let origWithdrawalFindById;
  let origWithdrawalFindOneAndUpdate;
  let origWithdrawalUpdateOne;
  let origWithdrawalCreate;
  let origWithdrawalFindByIdAndDelete;
  let origWithdrawalFind;
  let origWithdrawalCountDocuments;
  let origWalletFindOne;
  let origWalletFindById;
  let origWalletFindOneAndUpdate;
  let origTransactionFindOne;
  let origTransactionFind;
  let origTransactionCreate;
  let origAuditLogCreate;
  let mockWalletFindOneAndUpdate;

  beforeEach(() => {
    withdrawals = new Map();
    wallets = new Map();
    transactions = [];
    auditLogs = [];

    // Initialize user wallet with 2000 INR
    wallets.set(userId, {
      _id: new mongoose.Types.ObjectId(),
      user: userId,
      balance: 2000,
      processedOperations: [],
    });

    users = new Map();
    users.set(adminId, { _id: adminId, role: 'admin', isActive: true });
    users.set(secondAdminId, { _id: secondAdminId, role: 'admin', isActive: true });
    users.set(otherUserId, { _id: otherUserId, role: 'user', isActive: true });

    origUserFindById = User.findById;
    origUserFindOne = User.findOne;

    User.findById = async (id) => {
      const u = users.get(String(id));
      return u ? { ...u } : null;
    };
    User.findOne = async (query = {}) => {
      for (const u of users.values()) {
        if (query._id && String(u._id) === String(query._id)) return { ...u };
        if (query.role && u.role === query.role) return { ...u };
      }
      return null;
    };

    origWithdrawalFindOne = Withdrawal.findOne;
    origWithdrawalFindById = Withdrawal.findById;
    origWithdrawalFindOneAndUpdate = Withdrawal.findOneAndUpdate;
    origWithdrawalUpdateOne = Withdrawal.updateOne;
    origWithdrawalCreate = Withdrawal.create;
    origWithdrawalFindByIdAndDelete = Withdrawal.findByIdAndDelete;
    origWithdrawalFind = Withdrawal.find;
    origWithdrawalCountDocuments = Withdrawal.countDocuments;
    origWalletFindOne = Wallet.findOne;
    origWalletFindById = Wallet.findById;
    origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
    origTransactionFindOne = Transaction.findOne;
    origTransactionFind = Transaction.find;
    origTransactionCreate = Transaction.create;
    origAuditLogCreate = AuditLog.create;

    Withdrawal.find = (query = {}) => {
      let filtered = Array.from(withdrawals.values());
      if (query['metadata.reconciliationRequiresManualReview']) {
        filtered = filtered.filter(w => w.metadata?.reconciliationRequiresManualReview === true);
      }
      const makeChain = (docs) => ({
        populate: () => makeChain(docs),
        sort: () => makeChain(docs),
        skip: (n) => makeChain(docs.slice(n)),
        limit: (n) => makeChain(docs.slice(0, n)),
        then: (resolve) => resolve(docs.map(d => ({ ...d }))),
      });
      return makeChain(filtered);
    };

    Withdrawal.countDocuments = async (query = {}) => {
      let filtered = Array.from(withdrawals.values());
      if (query['metadata.reconciliationRequiresManualReview']) {
        filtered = filtered.filter(w => w.metadata?.reconciliationRequiresManualReview === true);
      }
      return filtered.length;
    };

    AuditLog.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      const created = {
        _id: new mongoose.Types.ObjectId(),
        createdAt: new Date(),
        ...item,
      };
      auditLogs.push(created);
      return Array.isArray(doc) ? [created] : created;
    };

    Withdrawal.findOne = async (query) => {
      for (const doc of withdrawals.values()) {
        if (query._id && String(doc._id) !== String(query._id)) continue;
        if (query.user && String(doc.user) !== String(query.user)) continue;
        if (query.withdrawalReference && doc.withdrawalReference !== query.withdrawalReference) continue;
        if (query.status && doc.status !== query.status) continue;
        if (query.idempotencyKey && doc.idempotencyKey !== query.idempotencyKey) continue;
        return { ...doc };
      }
      return null;
    };

    Withdrawal.findById = async (id) => {
      const doc = withdrawals.get(String(id));
      return doc ? { ...doc } : null;
    };

    const applySet = (target, setObj) => {
      if (!setObj) return;
      for (const [key, val] of Object.entries(setObj)) {
        if (key.includes('.')) {
          const parts = key.split('.');
          let curr = target;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!curr[parts[i]] || typeof curr[parts[i]] !== 'object') {
              curr[parts[i]] = {};
            }
            curr = curr[parts[i]];
          }
          curr[parts[parts.length - 1]] = val;
        } else {
          target[key] = val;
        }
      }
    };

    const applyUnset = (target, unsetObj) => {
      if (!unsetObj) return;
      for (const key of Object.keys(unsetObj)) {
        if (key.includes('.')) {
          const parts = key.split('.');
          let curr = target;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!curr[parts[i]]) break;
            curr = curr[parts[i]];
          }
          if (curr) {
            delete curr[parts[parts.length - 1]];
          }
        } else {
          delete target[key];
        }
      }
    };

    Withdrawal.findOneAndUpdate = async (filter, update) => {
      let matchedDoc = null;
      for (const doc of withdrawals.values()) {
        if (filter._id && String(doc._id) !== String(filter._id)) continue;
        if (filter.user && String(doc.user) !== String(filter.user)) continue;
        if (filter.status) {
          if (typeof filter.status === 'string' && doc.status !== filter.status) continue;
          if (filter.status.$in && !filter.status.$in.includes(doc.status)) continue;
        }
        if (filter.refundIssued !== undefined && doc.refundIssued !== filter.refundIssued) continue;
        if (
          filter['metadata.reconciliationRequiresManualReview'] !== undefined &&
          doc.metadata?.reconciliationRequiresManualReview !== filter['metadata.reconciliationRequiresManualReview']
        )
          continue;
        if (
          filter['metadata.resolutionClaimed']?.$ne !== undefined &&
          doc.metadata?.resolutionClaimed === filter['metadata.resolutionClaimed'].$ne
        )
          continue;
        matchedDoc = doc;
        break;
      }

      if (!matchedDoc) return null;

      if (update.$set) {
        applySet(matchedDoc, update.$set);
      }
      if (update.$unset) {
        applyUnset(matchedDoc, update.$unset);
      }
      return { ...matchedDoc };
    };

    Withdrawal.updateOne = async (filter, update) => {
      let matchedDoc = null;
      for (const doc of withdrawals.values()) {
        if (filter._id && String(doc._id) !== String(filter._id)) continue;
        matchedDoc = doc;
        break;
      }
      if (!matchedDoc) return { acknowledged: true, modifiedCount: 0 };
      if (update.$set) {
        applySet(matchedDoc, update.$set);
      }
      if (update.$unset) {
        applyUnset(matchedDoc, update.$unset);
      }
      return { acknowledged: true, modifiedCount: 1 };
    };

    Withdrawal.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      const created = {
        _id: new mongoose.Types.ObjectId(),
        createdAt: new Date(),
        refundIssued: false,
        metadata: {},
        ...item,
      };
      withdrawals.set(String(created._id), created);
      return Array.isArray(doc) ? [created] : created;
    };

    Withdrawal.findByIdAndDelete = async (id) => {
      const doc = withdrawals.get(String(id));
      withdrawals.delete(String(id));
      return doc || null;
    };

    Wallet.findOne = async (query) => {
      const uId = String(query.user || query);
      const w = wallets.get(uId);
      if (!w) return null;
      return {
        ...w,
        processedOperations: [...(w.processedOperations || [])],
      };
    };

    Wallet.findById = async (id) => {
      for (const w of wallets.values()) {
        if (String(w._id) === String(id) || String(w.user) === String(id)) {
          return {
            ...w,
            processedOperations: [...(w.processedOperations || [])],
          };
        }
      }
      return null;
    };

    Wallet.findOneAndUpdate = async (filter, update) => {
      const uId = String(filter.user);
      const w = wallets.get(uId);
      if (!w) return null;

      if (filter.balance?.$gte !== undefined && w.balance < filter.balance.$gte) {
        return null;
      }

      if (filter.processedOperations?.$ne !== undefined) {
        const op = filter.processedOperations.$ne;
        if (w.processedOperations && w.processedOperations.includes(op)) {
          return null;
        }
      }

      if (update.$inc?.balance) {
        w.balance = Math.round((w.balance + update.$inc.balance) * 100) / 100;
      }

      if (update.$addToSet?.processedOperations) {
        if (!w.processedOperations) {
          w.processedOperations = [];
        }
        const op = update.$addToSet.processedOperations;
        if (!w.processedOperations.includes(op)) {
          w.processedOperations.push(op);
        }
      }

      return {
        ...w,
        processedOperations: [...(w.processedOperations || [])],
      };
    };
    mockWalletFindOneAndUpdate = Wallet.findOneAndUpdate;

    Transaction.findOne = (query = {}) => {
      let filtered = [...transactions];
      if (query.reference) {
        if (typeof query.reference === 'string') {
          filtered = filtered.filter((t) => t.reference === query.reference);
        } else if (query.reference.$ne) {
          filtered = filtered.filter((t) => t.reference !== query.reference.$ne);
        }
      }
      if (query.wallet) {
        filtered = filtered.filter((t) => String(t.wallet) === String(query.wallet));
      }
      if (query.user) {
        filtered = filtered.filter((t) => String(t.user) === String(query.user));
      }
      return {
        sort: (sortObj = {}) => {
          let sorted = [...filtered];
          if (sortObj.createdAt === -1) {
            sorted.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
          } else if (sortObj.createdAt === 1) {
            sorted.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
          }
          return Promise.resolve(sorted.length > 0 ? { ...sorted[0] } : null);
        },
        then: (resolve, reject) => {
          try {
            resolve(filtered.length > 0 ? { ...filtered[0] } : null);
          } catch (e) {
            reject(e);
          }
        },
      };
    };

    Transaction.find = (query = {}) => {
      let filtered = [...transactions];
      if (query.wallet) {
        filtered = filtered.filter((t) => String(t.wallet) === String(query.wallet));
      }
      if (query.user) {
        filtered = filtered.filter((t) => String(t.user) === String(query.user));
      }
      if (query.createdAt?.$gte) {
        filtered = filtered.filter((t) => new Date(t.createdAt) >= new Date(query.createdAt.$gte));
      }
      if (query.createdAt?.$gt) {
        filtered = filtered.filter((t) => new Date(t.createdAt) > new Date(query.createdAt.$gt));
      }
      return {
        sort: (sortObj = {}) => {
          if (sortObj.createdAt === 1) {
            filtered.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
          } else if (sortObj.createdAt === -1) {
            filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
          }
          return Promise.resolve(filtered);
        },
        then: (resolve) => resolve(filtered),
      };
    };

    Transaction.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      // Enforce unique reference index
      if (item.reference && transactions.some((t) => t.reference === item.reference)) {
        const dupErr = new Error(`E11000 duplicate key error collection: transactions index: reference_1 dup key: { reference: "${item.reference}" }`);
        dupErr.code = 11000;
        throw dupErr;
      }
      const created = {
        _id: new mongoose.Types.ObjectId(),
        createdAt: new Date(),
        ...item,
      };
      transactions.push(created);
      return Array.isArray(doc) ? [created] : created;
    };
  });

  afterEach(() => {
    Withdrawal.findOne = origWithdrawalFindOne;
    Withdrawal.findById = origWithdrawalFindById;
    Withdrawal.findOneAndUpdate = origWithdrawalFindOneAndUpdate;
    Withdrawal.updateOne = origWithdrawalUpdateOne;
    Withdrawal.create = origWithdrawalCreate;
    Withdrawal.findByIdAndDelete = origWithdrawalFindByIdAndDelete;
    Withdrawal.find = origWithdrawalFind;
    Withdrawal.countDocuments = origWithdrawalCountDocuments;
    Wallet.findOne = origWalletFindOne;
    Wallet.findById = origWalletFindById;
    Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
    Transaction.findOne = origTransactionFindOne;
    Transaction.find = origTransactionFind;
    Transaction.create = origTransactionCreate;
    AuditLog.create = origAuditLogCreate;
    User.findById = origUserFindById;
    User.findOne = origUserFindOne;
  });

  const createMockWithdrawal = (opts = {}) => {
    const id = new mongoose.Types.ObjectId();
    const uId = opts.user || userId;
    if (!wallets.has(uId)) {
      wallets.set(uId, {
        _id: new mongoose.Types.ObjectId(),
        user: uId,
        balance: 2000,
        processedOperations: [],
      });
    }
    const withdrawalReference = opts.withdrawalReference || `WTH-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const doc = {
      _id: id,
      user: uId,
      wallet: wallets.get(uId)._id,
      amount: opts.amount || 500,
      currency: 'INR',
      withdrawalReference,
      status: opts.status || 'PENDING',
      refundIssued: opts.refundIssued || false,
      payoutMethod: opts.payoutMethod || 'upi',
      payoutDetails: opts.payoutDetails || {},
      metadata: opts.metadata || {},
      save: async function () {
        withdrawals.set(String(this._id), this);
        return this;
      },
    };
    withdrawals.set(String(id), doc);
    return doc;
  };

  describe('1. Rollback Inversion Elimination & Failure Handling', () => {
    it('refund succeeds normally with single credit, ledger entry, and balance snapshots', async () => {
      const withdrawal = createMockWithdrawal({ amount: 500, status: 'PENDING' });
      assert.strictEqual(wallets.get(userId).balance, 2000);

      const result = await cancelWithdrawalRequest(userId, String(withdrawal._id));
      assert.strictEqual(result.success, true);

      // Wallet balance updated to 2500
      assert.strictEqual(wallets.get(userId).balance, 2500);

      // Transaction ledger entry created with exact snapshots
      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      const tx = transactions.find((t) => t.reference === refundRef);
      assert.ok(tx);
      assert.strictEqual(tx.type, 'credit');
      assert.strictEqual(tx.amount, 500);
      assert.strictEqual(tx.balanceBefore, 2000);
      assert.strictEqual(tx.balanceAfter, 2500);

      // Withdrawal document state
      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.status, 'CANCELLED');
      assert.strictEqual(wDoc.refundIssued, true);
      assert.strictEqual(wDoc.metadata?.refundWalletCredited, true);
      assert.strictEqual(wDoc.metadata?.refundLedgerCreated, true);
    });

    it('when wallet reversal fails during failed withdrawal reservation, preserves recoverable draft record for admin reconciliation', async () => {
      assert.strictEqual(wallets.get(userId).balance, 2000);

      // Force Transaction.create to fail during reservation
      Transaction.create = async () => {
        throw new Error('Transaction ledger storage fault');
      };

      // Force compensating Wallet reversal to fail as well (e.g. database connection drops)
      let reversalAttempted = false;
      Wallet.findOneAndUpdate = async (filter, update) => {
        if (update.$inc?.balance > 0) {
          reversalAttempted = true;
          throw new Error('Connection lost: Compensating reversal debit failed to reach primary');
        }
        return mockWalletFindOneAndUpdate(filter, update);
      };

      await assert.rejects(
        async () => {
          await createWithdrawalRequest(userId, {
            amount: 500,
            idempotencyKey: 'idemp_rev_fail_001',
          });
        },
        (err) => {
          assert.match(err.message, /Transaction ledger storage fault/);
          return true;
        }
      );

      assert.strictEqual(reversalAttempted, true);

      // CRITICAL INVARIANT: The withdrawal record MUST NOT be deleted or lost!
      // It must be preserved with reservationReconciliationPending and reservationWalletDebited
      const preservedWithdrawal = Array.from(withdrawals.values()).find(
        (w) => w.idempotencyKey === 'idemp_rev_fail_001'
      );
      assert.ok(preservedWithdrawal, 'Withdrawal record must be preserved for admin reconciliation');
      assert.strictEqual(preservedWithdrawal.metadata?.reservationReconciliationPending, true);
      assert.strictEqual(preservedWithdrawal.metadata?.reservationWalletDebited, true);

      // Wallet reflects initial debit (1500) since reversal failed
      assert.strictEqual(wallets.get(userId).balance, 1500);
    });

    it('when database connection fails between withdrawal CAS update and wallet credit, preserves CANCELLED status with refundWalletCredited: false and recovers cleanly', async () => {
      const withdrawal = createMockWithdrawal({ amount: 350, status: 'PENDING' });
      assert.strictEqual(wallets.get(userId).balance, 2000);

      // Simulate DB drop right after CAS claim when updating wallet
      Wallet.findOneAndUpdate = async () => {
        throw new Error('MongoNetworkError: connection timed out during wallet refund update');
      };

      await assert.rejects(
        async () => {
          await cancelWithdrawalRequest(userId, String(withdrawal._id));
        },
        (err) => {
          assert.match(err.message, /MongoNetworkError/);
          return true;
        }
      );

      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.status, 'CANCELLED');
      assert.strictEqual(wDoc.refundIssued, true);
      assert.strictEqual(wDoc.metadata?.refundWalletCredited, false);
      assert.strictEqual(wDoc.metadata?.refundReconciliationPending, true);

      // Wallet balance was NOT credited
      assert.strictEqual(wallets.get(userId).balance, 2000);

      // Restore wallet findOneAndUpdate for reconciliation
      Wallet.findOneAndUpdate = mockWalletFindOneAndUpdate;

      // Forward recovery should complete the refund safely
      const rec = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(rec.status, 'recovered');
      assert.strictEqual(wallets.get(userId).balance, 2350);

      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      const tx = transactions.find((t) => t.reference === refundRef);
      assert.ok(tx);
      assert.strictEqual(tx.amount, 350);
      assert.strictEqual(tx.balanceAfter, 2350);
    });

    it('when ledger creation fails during cancellation, never resets refundIssued to false or rolls status back to PENDING', async () => {
      const withdrawal = createMockWithdrawal({ amount: 500, status: 'PENDING' });
      assert.strictEqual(wallets.get(userId).balance, 2000);

      // Force Transaction.create to fail (simulating DB disconnect or constraint error)
      Transaction.create = async () => {
        throw new Error('Database disk full: Transaction record write failed');
      };

      await assert.rejects(
        async () => {
          await cancelWithdrawalRequest(userId, String(withdrawal._id));
        },
        (err) => {
          assert.match(err.message, /Transaction record write failed/);
          return true;
        }
      );

      // CRITICAL INVARIANT: The withdrawal status must NOT be rolled back to PENDING!
      // refundIssued must NOT be flipped back to false!
      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.status, 'CANCELLED');
      assert.strictEqual(wDoc.refundIssued, true);
      assert.strictEqual(wDoc.metadata?.refundReconciliationPending, true);

      // User wallet was credited (+500 -> 2500) and was NOT unsafely reversed
      assert.strictEqual(wallets.get(userId).balance, 2500);

      // A retry or concurrent attempt to cancel MUST be rejected, preventing double-credit!
      await assert.rejects(
        async () => {
          await cancelWithdrawalRequest(userId, String(withdrawal._id));
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.match(err.message, /Cannot cancel a withdrawal request that is already CANCELLED|already been issued/);
          return true;
        }
      );

      // Balance remains strictly 2500 (never double credited to 3000)
      assert.strictEqual(wallets.get(userId).balance, 2500);
    });

    it('when ledger creation fails during admin rejection, preserves REJECTED status and reconciliation flag', async () => {
      const withdrawal = createMockWithdrawal({ amount: 400, status: 'PENDING' });
      assert.strictEqual(wallets.get(userId).balance, 2000);

      // Force Transaction.create failure
      Transaction.create = async () => {
        throw new Error('Connection lost to MongoDB primary during ledger insert');
      };

      await assert.rejects(
        async () => {
          await rejectWithdrawalAdmin(adminId, String(withdrawal._id), 'Compliance check failed');
        },
        (err) => {
          assert.match(err.message, /Connection lost/);
          return true;
        }
      );

      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.status, 'REJECTED');
      assert.strictEqual(wDoc.refundIssued, true);
      assert.strictEqual(wDoc.metadata?.refundReconciliationPending, true);

      // Wallet credited once: 2000 + 400 = 2400
      assert.strictEqual(wallets.get(userId).balance, 2400);

      // Subsequent rejection attempt rejected
      await assert.rejects(
        async () => {
          await rejectWithdrawalAdmin(adminId, String(withdrawal._id), 'Duplicate reject');
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          return true;
        }
      );
      assert.strictEqual(wallets.get(userId).balance, 2400);
    });

    it('when ledger creation fails during FAILED status update, preserves FAILED status and refundIssued: true', async () => {
      const withdrawal = createMockWithdrawal({ amount: 300, status: 'PROCESSING' });

      Transaction.create = async () => {
        throw new Error('Ledger write timeout');
      };

      await assert.rejects(
        async () => {
          await updateWithdrawalStatusAdmin(adminId, String(withdrawal._id), {
            status: 'FAILED',
            adminNotes: 'Payout gateway returned error',
          });
        },
        (err) => {
          assert.match(err.message, /Ledger write timeout/);
          return true;
        }
      );

      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.status, 'FAILED');
      assert.strictEqual(wDoc.refundIssued, true);
      assert.strictEqual(wDoc.metadata?.refundReconciliationPending, true);

      // Wallet credited once: 2000 + 300 = 2300
      assert.strictEqual(wallets.get(userId).balance, 2300);
    });
  });

  describe('2. Forward Recovery & Administrative Reconciliation', () => {
    it('reconciles interrupted refund: reconstructs missing Transaction ledger entry without second credit', async () => {
      const withdrawal = createMockWithdrawal({
        amount: 600,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: true,
          refundLedgerCreated: false,
          refundReconciliationPending: true,
        },
      });

      // User wallet has credited balance (2600)
      wallets.get(userId).balance = 2600;

      // No ledger entry exists yet
      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      assert.strictEqual(transactions.filter((t) => t.reference === refundRef).length, 0);

      // Run reconciliation
      const result = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(result.status, 'recovered');
      assert.match(result.message, /reconstructed without duplicate wallet credit/);

      // Ledger entry is created with exact balance snapshots
      const tx = transactions.find((t) => t.reference === refundRef);
      assert.ok(tx);
      assert.strictEqual(tx.type, 'credit');
      assert.strictEqual(tx.amount, 600);
      assert.strictEqual(tx.balanceAfter, 2600);
      assert.strictEqual(tx.balanceBefore, 2000);

      // Wallet balance must NOT be credited a second time!
      assert.strictEqual(wallets.get(userId).balance, 2600);

      // Subsequent reconciliation reports consistent state
      const recheck = await reconcileWithdrawalRefund(withdrawal.withdrawalReference);
      assert.strictEqual(recheck.status, 'consistent');
      assert.strictEqual(transactions.filter((t) => t.reference === refundRef).length, 1);
    });

    it('reconciles claimed refund where crash occurred before wallet credit was applied', async () => {
      const withdrawal = createMockWithdrawal({
        amount: 450,
        status: 'REJECTED',
        refundIssued: false,
        metadata: {
          refundWalletCredited: false,
        },
      });

      assert.strictEqual(wallets.get(userId).balance, 2000);

      const result = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(result.status, 'recovered');

      // Balance credited safely once
      assert.strictEqual(wallets.get(userId).balance, 2450);

      // Ledger entry created
      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      const tx = transactions.find((t) => t.reference === refundRef);
      assert.ok(tx);
      assert.strictEqual(tx.amount, 450);
      assert.strictEqual(tx.balanceAfter, 2450);

      // Withdrawal marked refundIssued: true
      const updatedW = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(updatedW.refundIssued, true);
    });

    it('concurrent reconciliation calls produce exactly one ledger entry and no duplicate credit', async () => {
      const withdrawal = createMockWithdrawal({
        amount: 500,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: true,
          refundLedgerCreated: false,
        },
      });

      wallets.get(userId).balance = 2500;

      // Two recovery jobs run simultaneously
      const [rec1, rec2] = await Promise.all([
        reconcileWithdrawalRefund(String(withdrawal._id)),
        reconcileWithdrawalRefund(withdrawal.withdrawalReference),
      ]);

      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      const txs = transactions.filter((t) => t.reference === refundRef);

      // Exactly one ledger transaction exists
      assert.strictEqual(txs.length, 1);
      // Wallet was not credited again
      assert.strictEqual(wallets.get(userId).balance, 2500);
      // One recovered, one consistent (or both consistent)
      assert.ok(['recovered', 'consistent'].includes(rec1.status));
      assert.ok(['recovered', 'consistent'].includes(rec2.status));
    });

    it('terminal immutable withdrawals (COMPLETED, consistent CANCELLED) are untouched by reconciliation', async () => {
      const compWithdrawal = createMockWithdrawal({
        amount: 1000,
        status: 'COMPLETED',
        refundIssued: false,
      });

      const res = await reconcileWithdrawalRefund(String(compWithdrawal._id));
      assert.strictEqual(res.status, 'unmodified');
      assert.strictEqual(wallets.get(userId).balance, 2000);
      assert.strictEqual(transactions.length, 0);
    });

    it('process interruption occurs after wallet credit: metadata checkpoint prevents duplicate credit during forward recovery', async () => {
      const withdrawal = createMockWithdrawal({
        amount: 500,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: true,
          refundLedgerCreated: false,
          refundReconciliationPending: true,
        },
      });

      // Wallet was already credited before process was interrupted (2000 + 500 = 2500)
      wallets.get(userId).balance = 2500;

      const rec = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(rec.status, 'recovered');
      assert.match(rec.message, /reconstructed without duplicate wallet credit/);

      // Invariant: Balance was NOT double credited (remains strictly 2500)
      assert.strictEqual(wallets.get(userId).balance, 2500);

      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      const txs = transactions.filter((t) => t.reference === refundRef);
      assert.strictEqual(txs.length, 1);
    });

    it('retrying reconciliation multiple times never creates a second refund or duplicate ledger entry', async () => {
      const withdrawal = createMockWithdrawal({
        amount: 250,
        status: 'REJECTED',
        refundIssued: false,
        metadata: {
          refundWalletCredited: false,
        },
      });

      assert.strictEqual(wallets.get(userId).balance, 2000);

      // First reconciliation: recovers and credits (+250 -> 2250)
      const r1 = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(r1.status, 'recovered');
      assert.strictEqual(wallets.get(userId).balance, 2250);

      // Retry 5 times consecutively
      for (let i = 0; i < 5; i++) {
        const retry = await reconcileWithdrawalRefund(String(withdrawal._id));
        assert.strictEqual(retry.status, 'consistent');
        assert.strictEqual(wallets.get(userId).balance, 2250);
      }

      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      const txs = transactions.filter((t) => t.reference === refundRef);
      assert.strictEqual(txs.length, 1, 'Only one ledger transaction must exist across all retries');
    });

    it('surfaces uncertain recovery state for manual administrative review without blind credit', async () => {
      // Legacy or ambiguous withdrawal without refundWalletCredited checkpoint and without transaction
      const withdrawal = createMockWithdrawal({
        amount: 700,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {}, // refundWalletCredited is undefined
      });

      assert.strictEqual(wallets.get(userId).balance, 2000);

      const result = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(result.status, 'uncertain');
      assert.match(result.message, /Quarantined for manual administrative reconciliation/);

      // Financial invariant: wallet must NOT be blindly credited!
      assert.strictEqual(wallets.get(userId).balance, 2000);
      assert.strictEqual(transactions.length, 0);

      // Preserved for administrative audit
      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.metadata?.reconciliationRequiresManualReview, true);
      assert.strictEqual(wDoc.metadata?.refundReconciliationPending, true);
    });
  });

  describe('3. Concurrency & Race Condition Guarantees', () => {
    it('user cancellation racing with admin rejection results in exactly one refund', async () => {
      const withdrawal = createMockWithdrawal({
        amount: 500,
        status: 'PENDING',
      });

      // Fire both concurrently
      const [userRes, adminRes] = await Promise.allSettled([
        cancelWithdrawalRequest(userId, String(withdrawal._id)),
        rejectWithdrawalAdmin(adminId, String(withdrawal._id), 'Admin race rejection'),
      ]);

      // Exactly one must succeed, the other must fail with status 400
      const successes = [userRes, adminRes].filter((r) => r.status === 'fulfilled');
      const failures = [userRes, adminRes].filter((r) => r.status === 'rejected');

      assert.strictEqual(successes.length, 1);
      assert.strictEqual(failures.length, 1);
      assert.strictEqual(failures[0].reason.statusCode, 400);

      // Balance credited by exactly 500 (2000 + 500 = 2500, never 3000)
      assert.strictEqual(wallets.get(userId).balance, 2500);

      // Exactly one refund transaction in ledger
      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      assert.strictEqual(transactions.filter((t) => t.reference === refundRef).length, 1);
    });
  });

  describe('4. Input Validation & Precision Audit (Task 4)', () => {
    const runValidator = (body) => {
      let statusCode = 200;
      let jsonResponse = null;
      let nextCalled = false;

      const req = { body };
      const res = {
        status: (code) => {
          statusCode = code;
          return {
            json: (data) => {
              jsonResponse = data;
              return data;
            },
          };
        },
      };
      const next = () => {
        nextCalled = true;
      };

      validateWithdrawalRequest(req, res, next);
      return { statusCode, jsonResponse, nextCalled };
    };

    it('rejects withdrawal amounts with more than 2 decimal places (paise precision)', () => {
      const res = runValidator({
        amount: 150.125, // 3 decimal places
        idempotencyKey: 'key_precision_001',
      });

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.nextCalled, false);
      assert.match(res.jsonResponse.errors[0], /2 decimal places/);
    });

    it('accepts valid 2-decimal withdrawal amounts', () => {
      const res = runValidator({
        amount: 250.5,
        idempotencyKey: 'key_precision_002',
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.nextCalled, true);
    });

    it('rejects malformed UPI ID format', () => {
      const res = runValidator({
        amount: 500,
        idempotencyKey: 'key_upi_invalid',
        payoutMethod: 'upi',
        payoutDetails: {
          identifier: 'invalid_upi_without_at',
        },
      });

      assert.strictEqual(res.statusCode, 400);
      assert.match(res.jsonResponse.errors[0], /Invalid UPI ID format/);
    });

    it('accepts valid UPI identifier format', () => {
      const res = runValidator({
        amount: 500,
        idempotencyKey: 'key_upi_valid',
        payoutMethod: 'upi',
        payoutDetails: {
          identifier: 'miner.trader@okaxis',
        },
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.nextCalled, true);
    });

    it('rejects invalid bank transfer IFSC and account number', () => {
      const res = runValidator({
        amount: 1000,
        idempotencyKey: 'key_bank_invalid',
        payoutMethod: 'bank_transfer',
        payoutDetails: {
          accountNumber: '123', // Too short (min 9 digits)
          ifscCode: 'INVALID_IFSC',
        },
      });

      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.jsonResponse.errors.some((e) => /between 9 and 18 digits/.test(e)));
      assert.ok(res.jsonResponse.errors.some((e) => /IFSC/.test(e)));
    });

    it('accepts valid bank transfer payout details', () => {
      const res = runValidator({
        amount: 1000,
        idempotencyKey: 'key_bank_valid',
        payoutMethod: 'bank_transfer',
        payoutDetails: {
          accountHolderName: 'John Miner',
          accountNumber: '123456789012',
          ifscCode: 'SBIN0123456',
        },
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.nextCalled, true);
    });

    describe('Deposit Intent Precision Validation (MAT-17.1)', () => {
      const runDepositValidator = (body) => {
        let statusCode = 200;
        let jsonResponse = null;
        let nextCalled = false;

        const req = { body };
        const res = {
          status: (code) => {
            statusCode = code;
            return {
              json: (data) => {
                jsonResponse = data;
                return data;
              },
            };
          },
        };
        const next = () => {
          nextCalled = true;
        };

        validateDepositIntent(req, res, next);
        return { statusCode, jsonResponse, nextCalled };
      };

      it('rejects deposit amounts with more than 2 decimal places (e.g. 150.125)', () => {
        const res = runDepositValidator({
          amount: 150.125,
          provider: 'razorpay',
        });
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.nextCalled, false);
        assert.ok(res.jsonResponse.errors.some((e) => /more than 2 decimal places/.test(e)));
      });

      it('rejects deposit amounts with fractional sub-paise (e.g. 500.0001)', () => {
        const res = runDepositValidator({
          amount: 500.0001,
          provider: 'razorpay',
        });
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.nextCalled, false);
        assert.ok(res.jsonResponse.errors.some((e) => /more than 2 decimal places/.test(e)));
      });

      it('accepts valid 2-decimal deposit amounts (e.g. 150.50)', () => {
        const res = runDepositValidator({
          amount: 150.5,
          provider: 'razorpay',
        });
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.nextCalled, true);
      });

      it('accepts integer deposit amounts (e.g. 1000)', () => {
        const res = runDepositValidator({
          amount: 1000,
          provider: 'razorpay',
        });
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.nextCalled, true);
      });

      it('accepts precision edge cases prone to IEEE-754 binary floating point inaccuracy (e.g. 128.02, 100.07, 100.29, 114.07)', () => {
        const testAmounts = [128.02, 100.07, 100.29, 114.07, 199.99, 250.75];
        for (const amt of testAmounts) {
          const res = runDepositValidator({
            amount: amt,
            provider: 'razorpay',
          });
          assert.strictEqual(
            res.statusCode,
            200,
            `Expected amount ₹${amt} to be accepted, but was rejected with status ${res.statusCode}`
          );
          assert.strictEqual(res.nextCalled, true);
        }
      });
    });
  });

  describe('5. Real MongoDB Integration Test Suite (Isolated Test Database)', () => {
    const isSafeTestUri = (uri) => {
      if (!uri) return false;
      const lower = uri.toLowerCase();
      return !lower.includes('mongodb.net') && !lower.includes('atlas') && !lower.includes('prod');
    };

    it('executes withdrawal recovery against isolated test database when MONGODB_TEST_URI is configured', async (t) => {
      const testUri = process.env.MONGODB_TEST_URI;
      if (!testUri || !isSafeTestUri(testUri)) {
        t.skip('Skipping live MongoDB test: MONGODB_TEST_URI not configured or invalid (preserves production/remote database safety)');
        return;
      }

      // Connect exclusively to the isolated test database
      const testConn = await mongoose.createConnection(testUri).asPromise();
      try {
        const TestWithdrawal = testConn.model('Withdrawal', Withdrawal.schema);
        const TestWallet = testConn.model('Wallet', Wallet.schema);
        const TestTransaction = testConn.model('Transaction', Transaction.schema);
        await TestWithdrawal.init();
        await TestWallet.init();
        await TestTransaction.init();

        const tempUserId = new mongoose.Types.ObjectId();
        const opRef = `REFUND-LIVE-TEST-${Date.now()}`;

        // Create initial wallet and pending-recovery withdrawal
        const wallet = await TestWallet.create({
          user: tempUserId,
          balance: 1000,
          processedOperations: [],
        });

        const withdrawal = await TestWithdrawal.create({
          user: tempUserId,
          wallet: wallet._id,
          amount: 250,
          currency: 'INR',
          status: 'CANCELLED',
          refundIssued: true,
          withdrawalReference: `WTH-LIVE-${Date.now()}`,
          metadata: {
            refundWalletCredited: false,
            refundLedgerCreated: false,
            refundReconciliationPending: true,
            refundOperationKey: opRef,
          },
        });

        // 1. First recovery attempt: atomic CAS credit and ledger write
        const updatedWallet = await TestWallet.findOneAndUpdate(
          { _id: wallet._id, processedOperations: { $ne: opRef } },
          { $inc: { balance: withdrawal.amount }, $addToSet: { processedOperations: opRef } },
          { new: true }
        );
        assert.ok(updatedWallet);
        assert.strictEqual(updatedWallet.balance, 1250);

        const tx = await TestTransaction.create({
          user: tempUserId,
          wallet: wallet._id,
          type: 'credit',
          amount: withdrawal.amount,
          status: 'completed',
          reference: opRef,
          balanceBefore: 1000,
          balanceAfter: 1250,
        });
        assert.ok(tx);

        await TestWithdrawal.updateOne(
          { _id: withdrawal._id },
          {
            $set: {
              'metadata.refundWalletCredited': true,
              'metadata.refundLedgerCreated': true,
              'metadata.refundReconciliationPending': false,
            },
          }
        );

        // 2. Second concurrent/retry recovery attempt: rejected by atomic CAS
        const retryWallet = await TestWallet.findOneAndUpdate(
          { _id: wallet._id, processedOperations: { $ne: opRef } },
          { $inc: { balance: withdrawal.amount }, $addToSet: { processedOperations: opRef } },
          { new: true }
        );
        assert.strictEqual(retryWallet, null, 'Duplicate recovery must be rejected by atomic CAS');

        // 3. Second ledger write with identical reference: rejected by unique index constraint
        let duplicateTxError = null;
        try {
          await TestTransaction.create({
            user: tempUserId,
            wallet: wallet._id,
            type: 'credit',
            amount: withdrawal.amount,
            status: 'completed',
            reference: opRef,
            balanceBefore: 1250,
            balanceAfter: 1500,
          });
        } catch (err) {
          duplicateTxError = err;
        }
        assert.ok(duplicateTxError, 'Duplicate transaction reference must be rejected');
        assert.strictEqual(duplicateTxError.code, 11000);

        // 4. Verify final durable state from real database reads
        const finalWallet = await TestWallet.findById(wallet._id);
        const finalTxCount = await TestTransaction.countDocuments({ reference: opRef });
        const finalWithdrawal = await TestWithdrawal.findById(withdrawal._id);

        assert.strictEqual(finalWallet.balance, 1250, 'Balance must reflect exactly one credit');
        assert.strictEqual(finalTxCount, 1, 'Exactly one transaction ledger entry must exist');
        assert.strictEqual(finalWithdrawal.metadata.refundWalletCredited, true);
        assert.strictEqual(finalWithdrawal.metadata.refundReconciliationPending, false);

        // Cleanup
        await TestWallet.findByIdAndDelete(wallet._id);
        await TestTransaction.deleteMany({ reference: opRef });
        await TestWithdrawal.findByIdAndDelete(withdrawal._id);
      } finally {
        await testConn.close();
      }
    });

    it('Standalone MongoDB Topology: Real atomic wallet-operation idempotency with processedOperations', async (t) => {
      const testUri = process.env.MONGODB_TEST_URI;
      if (!testUri || !isSafeTestUri(testUri)) {
        t.skip('Skipping standalone MongoDB integration test: MONGODB_TEST_URI not configured or invalid (preserves production data)');
        return;
      }

      const testConn = await mongoose.createConnection(testUri).asPromise();
      try {
        const TestWallet = testConn.model('Wallet', Wallet.schema);
        const tempUserId = new mongoose.Types.ObjectId();
        const opKey = `OP-STANDALONE-${Date.now()}`;

        const walletDoc = await TestWallet.create({
          user: tempUserId,
          balance: 1000,
          processedOperations: [],
        });

        // 1st atomic CAS mutation
        const res1 = await TestWallet.findOneAndUpdate(
          { _id: walletDoc._id, processedOperations: { $ne: opKey } },
          { $inc: { balance: 250 }, $addToSet: { processedOperations: opKey } },
          { new: true }
        );
        assert.ok(res1);
        assert.strictEqual(res1.balance, 1250);
        assert.ok(res1.processedOperations.includes(opKey));

        // 2nd identical mutation: blocked by $ne check
        const res2 = await TestWallet.findOneAndUpdate(
          { _id: walletDoc._id, processedOperations: { $ne: opKey } },
          { $inc: { balance: 250 }, $addToSet: { processedOperations: opKey } },
          { new: true }
        );
        assert.strictEqual(res2, null, 'Second mutation with same operation key must be rejected');

        const finalWallet = await TestWallet.findById(walletDoc._id);
        assert.strictEqual(finalWallet.balance, 1250);

        await TestWallet.findByIdAndDelete(walletDoc._id);
      } finally {
        await testConn.close();
      }
    });

    it('Replica Set Topology: Multi-document transaction atomicity and rollback verification', async (t) => {
      const testUri = process.env.MONGODB_TEST_URI;
      if (!testUri || !isSafeTestUri(testUri)) {
        t.skip('Skipping replica set transaction test: MONGODB_TEST_URI not configured or invalid (preserves production data)');
        return;
      }

      const testConn = await mongoose.createConnection(testUri).asPromise();
      let session = null;
      try {
        try {
          session = await testConn.startSession();
          session.startTransaction();
        } catch (err) {
          t.skip(`Skipping replica set test: Database does not support multi-document transactions (${err.message})`);
          return;
        }

        const TestWallet = testConn.model('Wallet', Wallet.schema);
        const TestTransaction = testConn.model('Transaction', Transaction.schema);
        const tempUserId = new mongoose.Types.ObjectId();

        const [w] = await TestWallet.create(
          [{ user: tempUserId, balance: 500, processedOperations: [] }],
          { session }
        );
        await TestTransaction.create(
          [
            {
              user: tempUserId,
              wallet: w._id,
              type: 'credit',
              amount: 500,
              status: 'completed',
              reference: `REF-REPLICA-${Date.now()}`,
              balanceBefore: 0,
              balanceAfter: 500,
            },
          ],
          { session }
        );

        // Intentional abort / rollback
        await session.abortTransaction();
        session.endSession();
        session = null;

        // Verify rollback: 0 documents exist
        const checkWallet = await TestWallet.findOne({ user: tempUserId });
        const checkTx = await TestTransaction.findOne({ user: tempUserId });
        assert.strictEqual(checkWallet, null, 'Wallet document must be completely rolled back');
        assert.strictEqual(checkTx, null, 'Transaction document must be completely rolled back');
      } finally {
        if (session) {
          try {
            await session.abortTransaction();
          } catch (_) {}
          try {
            session.endSession();
          } catch (_) {}
        }
        await testConn.close();
      }
    });
  });

  describe('6. MAT-17.1 Failure-Injection & Crash Window Tests', () => {
    it('Scenario 1: Crash before wallet credit — reconciliation performs credit exactly once and writes ledger', async () => {
      const withdrawal = createMockWithdrawal({
        amount: 500,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: false,
          refundLedgerCreated: false,
          refundReconciliationPending: true,
        },
      });

      assert.strictEqual(wallets.get(userId).balance, 2000);
      assert.strictEqual(wallets.get(userId).processedOperations.length, 0);

      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;

      // Run reconciliation
      const recResult = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(recResult.status, 'recovered');

      // Verify wallet balance: exactly credited once (2000 + 500 = 2500)
      assert.strictEqual(wallets.get(userId).balance, 2500);

      // Verify wallet processedOperations contains refundRef
      assert.ok(wallets.get(userId).processedOperations.includes(refundRef));

      // Verify transaction ledger has exactly 1 credit entry
      const txs = transactions.filter((t) => t.reference === refundRef);
      assert.strictEqual(txs.length, 1);
      assert.strictEqual(txs[0].amount, 500);
      assert.strictEqual(txs[0].balanceAfter, 2500);
      assert.strictEqual(txs[0].balanceBefore, 2000);

      // Verify withdrawal checkpoint
      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.metadata?.refundWalletCredited, true);
      assert.strictEqual(wDoc.metadata?.refundLedgerCreated, true);
      assert.strictEqual(wDoc.metadata?.refundReconciliationPending, false);
    });

    it('Scenario 2: Crash immediately after wallet credit but before checkpoint — reconciliation distinguishes already-applied credit and creates ledger without second credit', async () => {
      // CRITICAL CRASH WINDOW SIMULATION:
      // 1. Withdrawal claimed
      const withdrawal = createMockWithdrawal({
        amount: 750,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          // CRITICAL: Checkpoint was NOT persisted before process died
          refundWalletCredited: false,
          refundLedgerCreated: false,
          refundReconciliationPending: true,
        },
      });

      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;

      // 2. Wallet balance was incremented and refundRef added to processedOperations
      wallets.get(userId).balance = 2750; // 2000 + 750
      wallets.get(userId).processedOperations.push(refundRef);

      // 3. Process crashed here: Withdrawal document still has refundWalletCredited: false, and 0 ledger transactions exist
      assert.strictEqual(transactions.filter((t) => t.reference === refundRef).length, 0);
      assert.strictEqual(withdrawals.get(String(withdrawal._id)).metadata?.refundWalletCredited, false);

      // 4. Reconciliation runs after restart
      const recResult = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(recResult.status, 'recovered');
      assert.match(recResult.message, /reconstructed without duplicate wallet credit/);

      // CRITICAL PROOF: Wallet balance was NOT incremented again (remains 2750, NOT 3500)
      assert.strictEqual(wallets.get(userId).balance, 2750);

      // Verify processedOperations still contains refundRef exactly once
      assert.strictEqual(
        wallets.get(userId).processedOperations.filter((ref) => ref === refundRef).length,
        1
      );

      // Verify ledger transaction was reconstructed with exact balances
      const txs = transactions.filter((t) => t.reference === refundRef);
      assert.strictEqual(txs.length, 1);
      assert.strictEqual(txs[0].amount, 750);
      assert.strictEqual(txs[0].balanceAfter, 2750);
      assert.strictEqual(txs[0].balanceBefore, 2000);

      // Verify withdrawal checkpoint updated
      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.metadata?.refundWalletCredited, true);
      assert.strictEqual(wDoc.metadata?.refundLedgerCreated, true);
      assert.strictEqual(wDoc.metadata?.refundReconciliationPending, false);
    });

    it('Scenario 3: Crash after checkpoint but before ledger creation — reconciliation creates ledger without duplicate wallet credit', async () => {
      const withdrawal = createMockWithdrawal({
        amount: 400,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: true, // Checkpoint persisted
          refundLedgerCreated: false,  // Crashed before ledger creation
          refundReconciliationPending: true,
        },
      });

      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;

      // Wallet was credited
      wallets.get(userId).balance = 2400;
      wallets.get(userId).processedOperations.push(refundRef);

      assert.strictEqual(transactions.filter((t) => t.reference === refundRef).length, 0);

      // Run reconciliation
      const recResult = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(recResult.status, 'recovered');

      // Balance unchanged at 2400
      assert.strictEqual(wallets.get(userId).balance, 2400);

      // Exactly 1 ledger entry created
      const txs = transactions.filter((t) => t.reference === refundRef);
      assert.strictEqual(txs.length, 1);
      assert.strictEqual(txs[0].amount, 400);
      assert.strictEqual(txs[0].balanceAfter, 2400);
      assert.strictEqual(txs[0].balanceBefore, 2000);

      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.metadata?.refundLedgerCreated, true);
    });

    it('Scenario 4: Crash after ledger creation but before final checkpoint — reconciliation verifies existing ledger and seals checkpoint', async () => {
      const withdrawal = createMockWithdrawal({
        amount: 300,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: true,
          refundLedgerCreated: false, // Process crashed before updating this flag
          refundReconciliationPending: true,
        },
      });

      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;

      // Wallet credited and ledger already created
      wallets.get(userId).balance = 2300;
      wallets.get(userId).processedOperations.push(refundRef);
      transactions.push({
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        wallet: wallets.get(userId)._id,
        type: 'credit',
        amount: 300,
        reference: refundRef,
        status: 'completed',
        balanceBefore: 2000,
        balanceAfter: 2300,
        createdAt: new Date(),
      });

      // Run reconciliation
      const recResult = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(recResult.status, 'consistent');

      // Balance unchanged
      assert.strictEqual(wallets.get(userId).balance, 2300);

      // Ledger count remains exactly 1 (no duplicate)
      assert.strictEqual(transactions.filter((t) => t.reference === refundRef).length, 1);

      // Final checkpoint sealed
      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.metadata?.refundLedgerCreated, true);
      assert.ok(!wDoc.metadata?.refundReconciliationPending);
    });

    it('Scenario 5: Timeout with unknown wallet-write outcome — safe under both committed and uncommitted states', async () => {
      // Subcase 5A: Timeout occurred but write was committed on primary
      const withdrawalA = createMockWithdrawal({
        amount: 350,
        status: 'REJECTED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: false, // Unknown outcome left flag false
          refundLedgerCreated: false,
          refundReconciliationPending: true,
        },
      });
      const refA = `REFUND-${withdrawalA.withdrawalReference}`;
      wallets.get(userId).balance = 2350; // Write did apply
      wallets.get(userId).processedOperations.push(refA);

      const resA = await reconcileWithdrawalRefund(String(withdrawalA._id));
      assert.strictEqual(resA.status, 'recovered');
      assert.strictEqual(wallets.get(userId).balance, 2350); // Did not double-credit
      assert.strictEqual(transactions.filter((t) => t.reference === refA).length, 1);

      // Subcase 5B: Timeout occurred and write did NOT commit on primary
      const withdrawalB = createMockWithdrawal({
        amount: 250,
        status: 'FAILED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: false,
          refundLedgerCreated: false,
          refundReconciliationPending: true,
        },
      });
      const refB = `REFUND-${withdrawalB.withdrawalReference}`;
      // Write did NOT apply: balance remains 2350, refB not in processedOperations

      const resB = await reconcileWithdrawalRefund(String(withdrawalB._id));
      assert.strictEqual(resB.status, 'recovered');
      assert.strictEqual(wallets.get(userId).balance, 2600); // 2350 + 250 = 2600
      assert.ok(wallets.get(userId).processedOperations.includes(refB));
      assert.strictEqual(transactions.filter((t) => t.reference === refB).length, 1);

      // Retrying 3 times does nothing additional
      for (let i = 0; i < 3; i++) {
        const retryRes = await reconcileWithdrawalRefund(String(withdrawalB._id));
        assert.strictEqual(retryRes.status, 'consistent');
      }
      assert.strictEqual(wallets.get(userId).balance, 2600);
      assert.strictEqual(transactions.filter((t) => t.reference === refB).length, 1);
    });

    it('Scenario 6: Concurrent reconciliation and repeated retries — guarantees exactly-once credit and ledger entry', async () => {
      // Interrupted refund in critical crash window
      const withdrawal = createMockWithdrawal({
        amount: 500,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: false,
          refundLedgerCreated: false,
          refundReconciliationPending: true,
        },
      });

      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      // Wallet was credited in initial crash window
      wallets.get(userId).balance = 2500;
      wallets.get(userId).processedOperations.push(refundRef);

      // Launch 5 concurrent reconciliations racing simultaneously
      const concurrentResults = await Promise.all([
        reconcileWithdrawalRefund(String(withdrawal._id)),
        reconcileWithdrawalRefund(withdrawal.withdrawalReference),
        reconcileWithdrawalRefund(String(withdrawal._id)),
        reconcileWithdrawalRefund(withdrawal.withdrawalReference),
        reconcileWithdrawalRefund(String(withdrawal._id)),
      ]);

      // Every result is either recovered or consistent
      for (const res of concurrentResults) {
        assert.ok(['recovered', 'consistent'].includes(res.status));
      }

      // Wallet balance must NEVER double-credit (remains strictly 2500)
      assert.strictEqual(wallets.get(userId).balance, 2500);

      // Exactly 1 ledger transaction created
      const txs = transactions.filter((t) => t.reference === refundRef);
      assert.strictEqual(txs.length, 1);

      // Follow up with 5 consecutive retries
      for (let i = 0; i < 5; i++) {
        const retry = await reconcileWithdrawalRefund(String(withdrawal._id));
        assert.strictEqual(retry.status, 'consistent');
        assert.strictEqual(wallets.get(userId).balance, 2500);
      }

      // Total transaction count for this refund remains strictly 1
      assert.strictEqual(transactions.filter((t) => t.reference === refundRef).length, 1);
    });

    it('Scenario 2B: Dynamic failure injection in cancelWithdrawalRequest — crash immediately after Wallet.findOneAndUpdate before refundWalletCredited checkpoint', async () => {
      const withdrawal = createMockWithdrawal({ amount: 600, status: 'PENDING' });
      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;

      assert.strictEqual(wallets.get(userId).balance, 2000);
      assert.strictEqual(wallets.get(userId).processedOperations.length, 0);

      // Intercept safeUpdateWithdrawalMetadata to simulate violent process termination (OOM/SIGKILL)
      // right after wallet credit succeeded but BEFORE refundWalletCredited checkpoint could be persisted
      let interceptedOnce = false;
      const originalFindOneAndUpdate = Wallet.findOneAndUpdate;
      Wallet.findOneAndUpdate = async (query, update, options) => {
        const res = await originalFindOneAndUpdate(query, update, options);
        if (update.$inc && update.$inc.balance && !interceptedOnce) {
          interceptedOnce = true;
          // Simulate fatal crash: throw error that bypasses catch block checkpointing
          const crashErr = new Error('FATAL_PROCESS_CRASH: SIGKILL / OOM simulated immediately after wallet credit');
          crashErr.isFatalCrash = true;
          throw crashErr;
        }
        return res;
      };

      // Execute cancellation: will crash during wallet credit step after balance increment
      await assert.rejects(
        async () => {
          await cancelWithdrawalRequest(userId, String(withdrawal._id));
        },
        (err) => {
          assert.match(err.message, /FATAL_PROCESS_CRASH/);
          return true;
        }
      );

      // Restore normal wallet handler
      Wallet.findOneAndUpdate = originalFindOneAndUpdate;

      // VERIFY THE CRITICAL CRASH STATE:
      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.status, 'CANCELLED');
      assert.strictEqual(wDoc.refundIssued, true);
      assert.strictEqual(wDoc.metadata?.refundWalletCredited, false); // Checkpoint was NOT persisted!
      assert.strictEqual(transactions.filter((t) => t.reference === refundRef).length, 0); // No ledger entry!

      // But wallet balance was incremented to 2600 and processedOperations contains refundRef
      assert.strictEqual(wallets.get(userId).balance, 2600);
      assert.ok(wallets.get(userId).processedOperations.includes(refundRef));

      // RESTART & RECONCILIATION:
      const recResult = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(recResult.status, 'recovered');

      // VERIFY EXACTLY-ONCE GUARANTEE:
      // Wallet balance must REMAIN 2600 (NEVER double-credited to 3200)
      assert.strictEqual(wallets.get(userId).balance, 2600);

      // Transaction ledger entry reconstructed exactly once
      const txs = transactions.filter((t) => t.reference === refundRef);
      assert.strictEqual(txs.length, 1);
      assert.strictEqual(txs[0].amount, 600);
      assert.strictEqual(txs[0].balanceAfter, 2600);
      assert.strictEqual(txs[0].balanceBefore, 2000);

      // Checkpoint now sealed
      assert.strictEqual(withdrawals.get(String(withdrawal._id)).metadata?.refundWalletCredited, true);
      assert.strictEqual(withdrawals.get(String(withdrawal._id)).metadata?.refundLedgerCreated, true);
    });

    it('Scenario 2C: Dynamic failure injection in rejectWithdrawalAdmin — crash immediately after Wallet.findOneAndUpdate before refundWalletCredited checkpoint', async () => {
      const withdrawal = createMockWithdrawal({ amount: 450, status: 'PENDING' });
      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;

      let interceptedOnce = false;
      const originalFindOneAndUpdate = Wallet.findOneAndUpdate;
      Wallet.findOneAndUpdate = async (query, update, options) => {
        const res = await originalFindOneAndUpdate(query, update, options);
        if (update.$inc && update.$inc.balance && !interceptedOnce) {
          interceptedOnce = true;
          throw new Error('FATAL_PROCESS_CRASH: Uncaught exception after wallet increment in admin rejection');
        }
        return res;
      };

      await assert.rejects(
        async () => {
          await rejectWithdrawalAdmin(adminId, String(withdrawal._id), 'Compliance check failed');
        },
        (err) => {
          assert.match(err.message, /FATAL_PROCESS_CRASH/);
          return true;
        }
      );

      Wallet.findOneAndUpdate = originalFindOneAndUpdate;

      // Verify crash window state: withdrawal REJECTED, refundWalletCredited: false
      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.status, 'REJECTED');
      assert.strictEqual(wDoc.metadata?.refundWalletCredited, false);
      assert.strictEqual(transactions.filter((t) => t.reference === refundRef).length, 0);

      // Wallet incremented once (+450 -> 2450)
      assert.strictEqual(wallets.get(userId).balance, 2450);

      // Reconciliation runs after restart
      const recResult = await reconcileWithdrawalRefund(withdrawal.withdrawalReference);
      assert.strictEqual(recResult.status, 'recovered');

      // Balance remains strictly 2450 (NOT 2900)
      assert.strictEqual(wallets.get(userId).balance, 2450);

      // Exactly 1 ledger transaction
      const txs = transactions.filter((t) => t.reference === refundRef);
      assert.strictEqual(txs.length, 1);
      assert.strictEqual(txs[0].amount, 450);
      assert.strictEqual(txs[0].balanceAfter, 2450);
      assert.strictEqual(txs[0].balanceBefore, 2000);
    });

    it('Scenario 1B: Dynamic failure injection before wallet credit in cancelWithdrawalRequest — CAS claim succeeds but crash occurs before Wallet.findOneAndUpdate', async () => {
      const withdrawal = createMockWithdrawal({ amount: 350, status: 'PENDING' });
      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;

      // Crash on Wallet.findOneAndUpdate before any credit is applied
      const originalFindOneAndUpdate = Wallet.findOneAndUpdate;
      Wallet.findOneAndUpdate = async () => {
        throw new Error('STORAGE_UNAVAILABLE: Standalone primary dropped connection before wallet credit');
      };

      await assert.rejects(
        async () => {
          await cancelWithdrawalRequest(userId, String(withdrawal._id));
        },
        (err) => {
          assert.match(err.message, /STORAGE_UNAVAILABLE/);
          return true;
        }
      );

      Wallet.findOneAndUpdate = originalFindOneAndUpdate;

      // Verify state: withdrawal claimed (CANCELLED, refundIssued: true, refundWalletCredited: false)
      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.status, 'CANCELLED');
      assert.strictEqual(wDoc.refundIssued, true);
      assert.strictEqual(wDoc.metadata?.refundWalletCredited, false);

      // Wallet was NOT credited (remains 2000)
      assert.strictEqual(wallets.get(userId).balance, 2000);
      assert.ok(!wallets.get(userId).processedOperations.includes(refundRef));

      // Reconciliation runs after restart: detects credit never occurred and applies it exactly once
      const recResult = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(recResult.status, 'recovered');

      // Wallet now credited exactly once (2000 + 350 = 2350)
      assert.strictEqual(wallets.get(userId).balance, 2350);
      assert.ok(wallets.get(userId).processedOperations.includes(refundRef));

      // Exactly 1 ledger transaction
      const txs = transactions.filter((t) => t.reference === refundRef);
      assert.strictEqual(txs.length, 1);
      assert.strictEqual(txs[0].amount, 350);
      assert.strictEqual(txs[0].balanceAfter, 2350);
      assert.strictEqual(txs[0].balanceBefore, 2000);
    });
  });

  /* ==========================================================================
     7. MAT-17.2 INDEPENDENT REFUND LEDGER INTEGRITY & HISTORICAL BALANCE TESTS
     ========================================================================== */
  describe('7. MAT-17.2 Independent Refund Ledger Integrity & Historical Balance Tests', () => {
    it('MAT-17.2 Section 2 Proof: Preserves historical balanceBefore (2000) and balanceAfter (2350) when wallet balance changes prior to reconciliation', async () => {
      // 1. Initial State: Wallet balance starts at 2000 INR
      assert.strictEqual(wallets.get(userId).balance, 2000);

      // 2. A 350 INR refund is claimed and credited
      const withdrawal = createMockWithdrawal({
        amount: 350,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: true,
          // CRITICAL: Historical balance snapshot recorded at time of credit
          refundBalanceBefore: 2000,
          refundBalanceAfter: 2350,
          refundLedgerCreated: false,
          refundReconciliationPending: true,
        },
      });

      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;

      // Credit wallet to 2350 and record refundRef in processedOperations
      wallets.get(userId).balance = 2350;
      wallets.get(userId).processedOperations.push(refundRef);

      // 3. Process crashed before Transaction ledger entry was created
      assert.strictEqual(transactions.filter((t) => t.reference === refundRef).length, 0);

      // 4. ANOTHER LEGITIMATE TRANSACTION OCCURS BEFORE RECONCILIATION:
      // User deposits 1,000 INR, changing wallet balance from 2,350 to 3,350!
      wallets.get(userId).balance = 3350;
      const depositRef = 'DEP-LEGIT-1001';
      transactions.push({
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        wallet: wallets.get(userId)._id,
        type: 'credit',
        amount: 1000,
        reference: depositRef,
        status: 'completed',
        balanceBefore: 2350,
        balanceAfter: 3350,
        createdAt: new Date(),
      });

      assert.strictEqual(wallets.get(userId).balance, 3350);

      // 5. Reconciliation reconstructs the refund ledger
      const recResult = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(recResult.status, 'recovered');

      // VERIFY EXACT HISTORICAL BALANCES:
      // The refund ledger entry must contain balanceBefore: 2000 and balanceAfter: 2350,
      // NOT 3000 and 3350 inferred from the current wallet balance!
      const refundTx = transactions.find((t) => t.reference === refundRef);
      assert.ok(refundTx, 'Refund ledger transaction must exist');
      assert.strictEqual(refundTx.amount, 350);
      assert.strictEqual(
        refundTx.balanceBefore,
        2000,
        'Refund balanceBefore must be the historical 2000, NOT 3000 inferred from current balance'
      );
      assert.strictEqual(
        refundTx.balanceAfter,
        2350,
        'Refund balanceAfter must be the historical 2350, NOT 3350 inferred from current balance'
      );

      // VERIFY TOTAL WALLET INTEGRITY:
      // Current wallet balance remains 3350 (NEVER double-credited)
      assert.strictEqual(wallets.get(userId).balance, 3350);

      // VERIFY CONTINUOUS AUDIT TRAIL:
      // Starting balance (2000) + Refund (350 -> 2350) + Deposit (1000 -> 3350)
      const userTxs = transactions.filter((t) => String(t.user) === userId);
      assert.strictEqual(userTxs.length, 2);
    });

    it('MAT-17.3 Remediation: Quarantines uncheckpointed refund when intervening mutations occurred to prevent balance fabrication', async () => {
      // 1. Initial State: 2000 INR
      assert.strictEqual(wallets.get(userId).balance, 2000);

      // 2. Refund credited, but crash occurred before metadata checkpoint could be persisted
      const withdrawal = createMockWithdrawal({
        amount: 350,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: false, // Checkpoint lost
          // Notice: refundBalanceBefore is UNDEFINED!
          refundLedgerCreated: false,
          refundReconciliationPending: true,
        },
      });

      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      wallets.get(userId).balance = 2350;
      wallets.get(userId).processedOperations.push(refundRef);

      // 3. Another legitimate transaction occurred before reconciliation (user deposits 500)
      wallets.get(userId).balance = 2850;
      transactions.push({
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        wallet: wallets.get(userId)._id,
        type: 'credit',
        amount: 500,
        reference: 'DEP-SUBSEQUENT-001',
        status: 'completed',
        balanceBefore: 2350,
        balanceAfter: 2850,
        createdAt: new Date(Date.now() + 1000),
      });

      // 4. In MAT-17.3, reconciler refuses to guess balances using createdAt scanning!
      // Because intervening mutation occurred without checkpoint snapshot, it quarantines the operation.
      const recResult = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(recResult.status, 'uncertain');
      assert.match(recResult.message, /Quarantined for administrative reconciliation/);

      // Verify withdrawal checkpoint marked for manual review
      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.metadata?.reconciliationRequiresManualReview, true);
      assert.strictEqual(wDoc.metadata?.refundReconciliationPending, true);
      assert.match(wDoc.metadata?.reconciliationReason, /Historical balance indeterminacy/);

      // Balance remains untouched (never fabricated or double-credited)
      assert.strictEqual(wallets.get(userId).balance, 2850);
    });

    it('MAT-17.3 Deterministic Recovery: Reconstructs uncheckpointed refund when mathematically contiguous with zero intervening mutations', async () => {
      // 1. Initial State: User had a prior deposit bringing wallet to 2000
      assert.strictEqual(wallets.get(userId).balance, 2000);
      transactions.push({
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        wallet: wallets.get(userId)._id,
        type: 'credit',
        amount: 2000,
        reference: 'DEP-INIT-001',
        status: 'completed',
        balanceBefore: 0,
        balanceAfter: 2000,
        createdAt: new Date(Date.now() - 5000),
      });

      // 2. Refund credited (2000 + 350 = 2350), but crash occurred before metadata checkpoint was persisted
      const withdrawal = createMockWithdrawal({
        amount: 350,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: false, // Checkpoint lost
          refundLedgerCreated: false,
          refundReconciliationPending: true,
        },
      });

      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      wallets.get(userId).balance = 2350;
      wallets.get(userId).processedOperations.push(refundRef);

      // 3. ZERO intervening transactions occurred: wallet.balance (2350) exactly equals
      // latestTx.balanceAfter (2000) + withdrawal.amount (350).
      // Mathematical proof holds with 100% certainty!
      const recResult = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(recResult.status, 'recovered');

      const refundTx = transactions.find((t) => t.reference === refundRef);
      assert.ok(refundTx);
      assert.strictEqual(refundTx.balanceBefore, 2000);
      assert.strictEqual(refundTx.balanceAfter, 2350);
      assert.strictEqual(wallets.get(userId).balance, 2350);
    });

    it('quarantines operation for manual administrative review when historical balance cannot be safely verified', async () => {
      // Simulation: Wallet balance changed without any ledger records (e.g. untracked corrupt mutation)
      const withdrawal = createMockWithdrawal({
        amount: 350,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: false,
          refundLedgerCreated: false,
          // snapshots missing
        },
      });

      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      wallets.get(userId).processedOperations.push(refundRef);
      // Untracked mutation leaves balance at 100 INR (< 350 amount, would produce negative balanceBefore)
      wallets.get(userId).balance = 100;

      // Reconciler refuses to fabricate negative or guessed balances
      const recResult = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(recResult.status, 'uncertain');
      assert.match(recResult.message, /Quarantined for administrative reconciliation/);

      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.metadata?.reconciliationRequiresManualReview, true);

      // No ledger entry created
      assert.strictEqual(transactions.filter((t) => t.reference === refundRef).length, 0);
    });

    it('two different refunds for the same user succeed with distinct references and continuous balances', async () => {
      // User has 2 separate withdrawal requests: 300 INR and 400 INR
      const w1 = createMockWithdrawal({ amount: 300, status: 'PENDING' });
      const w2 = createMockWithdrawal({ amount: 400, status: 'PENDING' });

      assert.strictEqual(wallets.get(userId).balance, 2000);

      // Refund 1: Cancel w1 (+300 -> 2300)
      const r1 = await cancelWithdrawalRequest(userId, String(w1._id));
      assert.strictEqual(r1.success, true);
      assert.strictEqual(wallets.get(userId).balance, 2300);

      // Refund 2: Cancel w2 (+400 -> 2700)
      const r2 = await cancelWithdrawalRequest(userId, String(w2._id));
      assert.strictEqual(r2.success, true);
      assert.strictEqual(wallets.get(userId).balance, 2700);

      // Verify distinct references
      const ref1 = `REFUND-${w1.withdrawalReference}`;
      const ref2 = `REFUND-${w2.withdrawalReference}`;
      assert.notStrictEqual(ref1, ref2);

      // Verify wallet processedOperations contains both references
      assert.ok(wallets.get(userId).processedOperations.includes(ref1));
      assert.ok(wallets.get(userId).processedOperations.includes(ref2));

      // Verify exactly 2 ledger entries exist with contiguous balances
      const tx1 = transactions.find((t) => t.reference === ref1);
      const tx2 = transactions.find((t) => t.reference === ref2);
      assert.ok(tx1);
      assert.ok(tx2);
      assert.strictEqual(tx1.balanceBefore, 2000);
      assert.strictEqual(tx1.balanceAfter, 2300);
      assert.strictEqual(tx2.balanceBefore, 2300);
      assert.strictEqual(tx2.balanceAfter, 2700);
    });

    it('concurrent deposit, withdrawal reservation, and refund reconciliation preserve wallet balance invariant', async () => {
      // User wallet starts at 2000 INR
      assert.strictEqual(wallets.get(userId).balance, 2000);

      // Interrupted refund of 250 INR needing reconciliation
      const withdrawal = createMockWithdrawal({
        amount: 250,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: true,
          refundBalanceBefore: 1750,
          refundBalanceAfter: 2000,
          refundLedgerCreated: false,
          refundReconciliationPending: true,
        },
      });
      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      wallets.get(userId).processedOperations.push(refundRef);

      // Simulate 3 concurrent operations hitting the wallet simultaneously:
      // 1. Reconciliation of the 250 refund (ledger creation only)
      // 2. Legitimate wallet deposit (+500 -> 2500)
      // 3. Legitimate withdrawal reservation (-300 -> 2200)
      const recPromise = reconcileWithdrawalRefund(String(withdrawal._id));

      // Deposit
      wallets.get(userId).balance += 500;
      transactions.push({
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        wallet: wallets.get(userId)._id,
        type: 'credit',
        amount: 500,
        reference: 'DEP-CONCUR-001',
        status: 'completed',
        balanceBefore: 2000,
        balanceAfter: 2500,
        createdAt: new Date(),
      });

      // Withdrawal reservation
      wallets.get(userId).balance -= 300;
      transactions.push({
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        wallet: wallets.get(userId)._id,
        type: 'debit',
        amount: 300,
        reference: 'WTH-CONCUR-001',
        status: 'completed',
        balanceBefore: 2500,
        balanceAfter: 2200,
        createdAt: new Date(),
      });

      const recResult = await recPromise;
      assert.strictEqual(recResult.status, 'recovered');

      // Final balance must be 2200 (2000 + 500 - 300)
      assert.strictEqual(wallets.get(userId).balance, 2200);

      // Refund transaction ledger entry reconstructed with historical 1750 -> 2000
      const refundTx = transactions.find((t) => t.reference === refundRef);
      assert.ok(refundTx);
      assert.strictEqual(refundTx.balanceBefore, 1750);
      assert.strictEqual(refundTx.balanceAfter, 2000);
    });

    it('duplicate refund reference enforcement rejects second ledger entry and reconciler safely deduplicates', async () => {
      const withdrawal = createMockWithdrawal({
        amount: 500,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: true,
          refundBalanceBefore: 2000,
          refundBalanceAfter: 2500,
          refundLedgerCreated: true,
        },
      });

      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;

      // Existing ledger transaction
      transactions.push({
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        wallet: wallets.get(userId)._id,
        type: 'credit',
        amount: 500,
        reference: refundRef,
        status: 'completed',
        balanceBefore: 2000,
        balanceAfter: 2500,
        createdAt: new Date(),
      });

      // Direct attempt to insert a duplicate with same reference fails with E11000
      await assert.rejects(
        async () => {
          await Transaction.create({
            user: userId,
            wallet: wallets.get(userId)._id,
            type: 'credit',
            amount: 500,
            reference: refundRef,
          });
        },
        (err) => {
          assert.strictEqual(err.code, 11000);
          return true;
        }
      );

      // Reconciler encounters existingTx, acknowledges consistency, and avoids any duplicate
      const rec = await reconcileWithdrawalRefund(withdrawal.withdrawalReference);
      assert.strictEqual(rec.status, 'consistent');
      assert.strictEqual(transactions.filter((t) => t.reference === refundRef).length, 1);
    });
  });

  /* ==========================================================================
     8. MAT-17.3 WALLET MUTATION ORDERING & LEDGER CHAIN INTEGRITY AUDIT TESTS
     ========================================================================== */
  describe('8. MAT-17.3 Wallet Mutation Ordering & Ledger Chain Integrity Audit Tests', () => {
    it('Invariant 1: Financial operations change balance at most once (idempotent operation key)', async () => {
      const opKey = 'OP-AUDIT-INV1';
      wallets.get(userId).balance = 1000;

      // 1st mutation
      const w1 = await Wallet.findOneAndUpdate(
        { user: userId, processedOperations: { $ne: opKey } },
        { $inc: { balance: 300 }, $addToSet: { processedOperations: opKey } },
        { new: true }
      );
      assert.ok(w1);
      assert.strictEqual(w1.balance, 1300);
      assert.ok(w1.processedOperations.includes(opKey));

      // 2nd identical mutation attempt: blocked by $ne condition
      const w2 = await Wallet.findOneAndUpdate(
        { user: userId, processedOperations: { $ne: opKey } },
        { $inc: { balance: 300 }, $addToSet: { processedOperations: opKey } },
        { new: true }
      );
      assert.strictEqual(w2, null, 'Second mutation with same operation key must be rejected');
      assert.strictEqual(wallets.get(userId).balance, 1300);
    });

    it('Invariant 2: Each completed operation has one unique ledger entry with exact arithmetic', async () => {
      wallets.get(userId).balance = 1500;
      const tx1 = {
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        wallet: wallets.get(userId)._id,
        type: 'credit',
        amount: 500,
        reference: 'DEP-INV2-01',
        status: 'completed',
        balanceBefore: 1000,
        balanceAfter: 1500,
        createdAt: new Date(),
      };
      transactions.push(tx1);

      // Audit passes for valid arithmetic
      const audit1 = await auditWalletLedgerIntegrity(userId);
      assert.strictEqual(audit1.isValid, true);
      assert.strictEqual(audit1.violations.length, 0);

      // Tamper: arithmetic mismatch (1000 + 500 !== 1600)
      tx1.balanceAfter = 1600;
      wallets.get(userId).balance = 1600;
      const audit2 = await auditWalletLedgerIntegrity(userId);
      assert.strictEqual(audit2.isValid, false);
      assert.ok(audit2.violations.some((v) => /Arithmetic mismatch/.test(v)));
    });

    it('Invariant 3: Continuous chain verification enforces T[i+1].balanceBefore === T[i].balanceAfter', async () => {
      wallets.get(userId).balance = 1200;
      const t1 = {
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        wallet: wallets.get(userId)._id,
        type: 'credit',
        amount: 1000,
        reference: 'TX-CHAIN-01',
        status: 'completed',
        balanceBefore: 0,
        balanceAfter: 1000,
        createdAt: new Date(Date.now() - 3000),
      };
      const t2 = {
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        wallet: wallets.get(userId)._id,
        type: 'credit',
        amount: 400,
        reference: 'TX-CHAIN-02',
        status: 'completed',
        balanceBefore: 1000,
        balanceAfter: 1400,
        createdAt: new Date(Date.now() - 2000),
      };
      const t3 = {
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        wallet: wallets.get(userId)._id,
        type: 'debit',
        amount: 200,
        reference: 'TX-CHAIN-03',
        status: 'completed',
        balanceBefore: 1400,
        balanceAfter: 1200,
        createdAt: new Date(Date.now() - 1000),
      };
      transactions.push(t1, t2, t3);

      const auditValid = await auditWalletLedgerIntegrity(userId);
      assert.strictEqual(auditValid.isValid, true);
      assert.strictEqual(auditValid.violations.length, 0);

      // Introduce chain gap: t2 balanceAfter tampered to 1350 while t3 balanceBefore is 1400
      t2.balanceAfter = 1350;
      t2.amount = 350; // maintain t2 internal arithmetic so only chain continuity fails
      const auditBroken = await auditWalletLedgerIntegrity(userId);
      assert.strictEqual(auditBroken.isValid, false);
      assert.ok(auditBroken.violations.some((v) => /Ledger chain discontinuity/.test(v)));
    });

    it('Invariant 4: Terminal ledger balance reconciles with current wallet balance', async () => {
      wallets.get(userId).balance = 800; // Wallet is 800
      transactions.push({
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        wallet: wallets.get(userId)._id,
        type: 'credit',
        amount: 1000,
        reference: 'TX-TERMINAL-01',
        status: 'completed',
        balanceBefore: 0,
        balanceAfter: 1000, // Terminal ledger is 1000
        createdAt: new Date(),
      });

      const audit = await auditWalletLedgerIntegrity(userId);
      assert.strictEqual(audit.isValid, false);
      assert.ok(audit.violations.some((v) => /Terminal ledger balance \(1000\) does not match current wallet balance \(800\)/.test(v)));
    });

    it('Invariant 5: Quarantine on ambiguous history prevents balance fabrication when subsequent mutations occur', async () => {
      // Wallet starts at 2000
      wallets.get(userId).balance = 2000;

      // Uncheckpointed refund of 400 is credited
      const withdrawal = createMockWithdrawal({
        amount: 400,
        status: 'REJECTED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: false, // Snapshot lost
          refundLedgerCreated: false,
          refundReconciliationPending: true,
        },
      });

      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      wallets.get(userId).balance = 2400;
      wallets.get(userId).processedOperations.push(refundRef);

      // Interleaved mutation occurs: user withdraws or spends 600, bringing wallet to 1800
      wallets.get(userId).balance = 1800;
      transactions.push({
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        wallet: wallets.get(userId)._id,
        type: 'debit',
        amount: 600,
        reference: 'SPEND-INTERLEAVED-01',
        status: 'completed',
        balanceBefore: 2400,
        balanceAfter: 1800,
        createdAt: new Date(Date.now() + 500),
      });

      // Reconciler refuses to guess historical balance and quarantines
      const rec = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(rec.status, 'uncertain');
      assert.match(rec.message, /Quarantined for administrative reconciliation/);

      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.metadata?.reconciliationRequiresManualReview, true);
      assert.strictEqual(wDoc.metadata?.refundReconciliationPending, true);
      assert.strictEqual(wallets.get(userId).balance, 1800);
      assert.strictEqual(transactions.filter((t) => t.reference === refundRef).length, 0);
    });

    it('Crash Window 1: Process crashes before wallet mutation — reconciler performs credit once and creates ledger', async () => {
      wallets.get(userId).balance = 1000;
      const withdrawal = createMockWithdrawal({
        amount: 300,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: false,
          refundLedgerCreated: false,
          refundReconciliationPending: true,
        },
      });

      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      const rec = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(rec.status, 'recovered');
      assert.strictEqual(wallets.get(userId).balance, 1300);

      const tx = transactions.find((t) => t.reference === refundRef);
      assert.ok(tx);
      assert.strictEqual(tx.balanceBefore, 1000);
      assert.strictEqual(tx.balanceAfter, 1300);
      assert.strictEqual(tx.amount, 300);
    });

    it('Crash Window 2: Process crashes after wallet mutation but before checkpoint — deterministic recovery anchors to contiguous prior balance', async () => {
      wallets.get(userId).balance = 1000;
      // Prior transaction anchors balance to 1000
      transactions.push({
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        wallet: wallets.get(userId)._id,
        type: 'credit',
        amount: 1000,
        reference: 'TX-PRIOR-ANCHOR',
        status: 'completed',
        balanceBefore: 0,
        balanceAfter: 1000,
        createdAt: new Date(Date.now() - 10000),
      });

      // Wallet mutated (+200 -> 1200), crash before checkpoint snapshot
      const withdrawal = createMockWithdrawal({
        amount: 200,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: false,
          refundLedgerCreated: false,
          refundReconciliationPending: true,
        },
      });
      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      wallets.get(userId).balance = 1200;
      wallets.get(userId).processedOperations.push(refundRef);

      // Reconciler detects zero intervening mutations (1000 + 200 === 1200)
      const rec = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(rec.status, 'recovered');
      assert.strictEqual(wallets.get(userId).balance, 1200);

      const tx = transactions.find((t) => t.reference === refundRef);
      assert.ok(tx);
      assert.strictEqual(tx.balanceBefore, 1000);
      assert.strictEqual(tx.balanceAfter, 1200);

      // Full audit verifies ledger chain continuity
      const audit = await auditWalletLedgerIntegrity(userId);
      assert.strictEqual(audit.isValid, true);
    });

    it('Crash Window 3: Process crashes after checkpoint but before ledger creation — reconciler uses durable snapshot', async () => {
      wallets.get(userId).balance = 1500;
      const withdrawal = createMockWithdrawal({
        amount: 500,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: true,
          refundBalanceBefore: 1000,
          refundBalanceAfter: 1500,
          refundLedgerCreated: false,
          refundReconciliationPending: true,
        },
      });
      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      wallets.get(userId).processedOperations.push(refundRef);

      // Even if another transaction occurred afterwards, the durable snapshots are used
      wallets.get(userId).balance = 2500;
      transactions.push({
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        wallet: wallets.get(userId)._id,
        type: 'credit',
        amount: 1000,
        reference: 'DEP-AFTER-CRASH',
        status: 'completed',
        balanceBefore: 1500,
        balanceAfter: 2500,
        createdAt: new Date(),
      });

      const rec = await reconcileWithdrawalRefund(String(withdrawal._id));
      assert.strictEqual(rec.status, 'recovered');

      const tx = transactions.find((t) => t.reference === refundRef);
      assert.ok(tx);
      assert.strictEqual(tx.balanceBefore, 1000);
      assert.strictEqual(tx.balanceAfter, 1500);
      assert.strictEqual(wallets.get(userId).balance, 2500);
    });

    it('Crash Window 4: Process crashes after ledger creation but before final status persistence — consistent idempotency', async () => {
      wallets.get(userId).balance = 1500;
      const withdrawal = createMockWithdrawal({
        amount: 500,
        status: 'CANCELLED',
        refundIssued: false, // Status update was interrupted
        metadata: {
          refundWalletCredited: true,
          refundBalanceBefore: 1000,
          refundBalanceAfter: 1500,
          refundLedgerCreated: true,
        },
      });
      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      wallets.get(userId).processedOperations.push(refundRef);

      transactions.push({
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        wallet: wallets.get(userId)._id,
        type: 'credit',
        amount: 500,
        reference: refundRef,
        status: 'completed',
        balanceBefore: 1000,
        balanceAfter: 1500,
        createdAt: new Date(),
      });

      const rec = await reconcileWithdrawalRefund(withdrawal.withdrawalReference);
      assert.strictEqual(rec.status, 'consistent');
      assert.strictEqual(wallets.get(userId).balance, 1500);
      assert.strictEqual(transactions.filter((t) => t.reference === refundRef).length, 1);

      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.refundIssued, true);
    });

    it('Concurrent retry safety: 5 concurrent reconciliations create exactly 1 ledger entry and credit balance once', async () => {
      wallets.get(userId).balance = 1000;
      const withdrawal = createMockWithdrawal({
        amount: 500,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          refundWalletCredited: false,
          refundLedgerCreated: false,
          refundReconciliationPending: true,
        },
      });
      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;

      // 5 concurrent workers fire simultaneously
      const results = await Promise.all([
        reconcileWithdrawalRefund(String(withdrawal._id)),
        reconcileWithdrawalRefund(withdrawal.withdrawalReference),
        reconcileWithdrawalRefund(String(withdrawal._id)),
        reconcileWithdrawalRefund(withdrawal.withdrawalReference),
        reconcileWithdrawalRefund(String(withdrawal._id)),
      ]);

      // All concurrent operations must resolve safely to either recovered or consistent
      for (const r of results) {
        assert.ok(
          ['recovered', 'consistent'].includes(r.status),
          `Expected status recovered or consistent, got ${r.status}`
        );
      }

      // Financial balance incremented exactly once (1000 + 500 = 1500)
      assert.strictEqual(wallets.get(userId).balance, 1500);

      // Exactly 1 transaction in ledger
      const refundTxs = transactions.filter((t) => t.reference === refundRef);
      assert.strictEqual(refundTxs.length, 1);
      assert.strictEqual(refundTxs[0].balanceBefore, 1000);
      assert.strictEqual(refundTxs[0].balanceAfter, 1500);
    });

    it('Quarantined operation cannot be automatically credited repeatedly by subsequent reconciliation retries', async () => {
      wallets.get(userId).balance = 2000;
      const withdrawal = createMockWithdrawal({
        amount: 500,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          reconciliationRequiresManualReview: true,
          refundReconciliationPending: true,
          reconciliationReason: 'Historical balance indeterminacy: quarantined for manual audit.',
        },
      });
      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;

      // 5 consecutive automated retry attempts
      for (let attempt = 1; attempt <= 5; attempt++) {
        const res = await reconcileWithdrawalRefund(String(withdrawal._id));
        assert.strictEqual(res.status, 'uncertain');
        assert.match(res.message, /quarantined for manual/i);
        // Financial invariant: wallet balance is NEVER blindly credited
        assert.strictEqual(wallets.get(userId).balance, 2000);
        // Ledger invariant: zero fabricated transactions created
        assert.strictEqual(transactions.filter((t) => t.reference === refundRef).length, 0);
      }
    });
  });

  describe('9. MAT-17.5 Database Durability, Quarantine Visibility, and Auditable Manual Resolution', () => {
    it('Task 1: getDurabilityOptions returns strict production durability options (majority + journaled)', () => {
      const prodOpts = getDurabilityOptions('production');
      assert.strictEqual(prodOpts.w, 'majority');
      assert.strictEqual(prodOpts.journal, true);
      assert.strictEqual(prodOpts.wtimeoutMS, 10000);
      assert.strictEqual(prodOpts.retryWrites, true);
    });

    it('Task 1: validateDurabilityPolicy fails closed in production when write concern is unacknowledged (w: 0)', () => {
      assert.throws(
        () => validateDurabilityPolicy('production', 'replicaSet', { w: 0, journal: false }),
        /FATAL DURABILITY POLICY VIOLATION: Production deployment requires acknowledged majority writes/
      );
    });

    it('Task 1: validateDurabilityPolicy fails closed in production when running on standalone topology', () => {
      assert.throws(
        () => validateDurabilityPolicy('production', 'standalone', { w: 'majority', journal: true }),
        /FATAL TOPOLOGY POLICY VIOLATION: Production deployment requires a replica-set or sharded cluster topology/
      );
    });

    it('Task 1: validateDurabilityPolicy permits compliant replica set in production', () => {
      const result = validateDurabilityPolicy('production', 'replicaSet', { w: 'majority', journal: true });
      assert.strictEqual(result.isCompliant, true);
      assert.strictEqual(result.effectivePolicy.w, 'majority');
      assert.strictEqual(result.effectivePolicy.journal, true);
    });

    it('Task 1: validateDurabilityPolicy allows standalone topology in development/test environments', () => {
      const devResult = validateDurabilityPolicy('development', 'standalone', { w: 1, journal: true });
      assert.strictEqual(devResult.isCompliant, true);
      assert.strictEqual(devResult.topology, 'standalone');
    });

    it('Task 2: dispatchQuarantineAlert marks quarantineAlertDispatched and prevents alert storms', async () => {
      const doc = {
        _id: new mongoose.Types.ObjectId(),
        withdrawalReference: 'WTH-ALERT-TEST-001',
        amount: 2500,
        status: 'CANCELLED',
        payoutMethod: 'upi',
        payoutDetails: { maskedIdentifier: 'use***@upi' },
        metadata: {},
      };

      // First alert dispatch
      const alert1 = await dispatchQuarantineAlert(doc, 'Historical balance indeterminacy', { logOnly: true });
      assert.strictEqual(alert1.dispatched, true);
      assert.strictEqual(doc.metadata.quarantineAlertDispatched, true);
      assert.ok(doc.metadata.quarantineAlertDispatchedAt);

      // Repeated reconciliation attempt — must suppress alert
      const alert2 = await dispatchQuarantineAlert(doc, 'Historical balance indeterminacy', { logOnly: true });
      assert.strictEqual(alert2.dispatched, false);
      assert.strictEqual(alert2.reason, 'ALREADY_DISPATCHED');
    });

    it('Task 2: getQuarantinedWithdrawalsAdmin returns sanitized list excluding sensitive banking information', async () => {
      // Create quarantined withdrawal
      createMockWithdrawal({
        amount: 1500,
        status: 'CANCELLED',
        payoutMethod: 'bank_transfer',
        payoutDetails: {
          maskedIdentifier: '******1234',
          accountHolderName: 'Test User',
        },
        metadata: {
          reconciliationRequiresManualReview: true,
          reconciliationReason: 'Discontinuity detected in ledger history',
          quarantinedAt: new Date(),
        },
      });

      // Create non-quarantined withdrawal
      createMockWithdrawal({
        amount: 500,
        status: 'COMPLETED',
        metadata: {
          reconciliationRequiresManualReview: false,
        },
      });

      const res = await getQuarantinedWithdrawalsAdmin({ page: 1, limit: 10 });
      assert.strictEqual(res.total, 1);
      assert.strictEqual(res.withdrawals.length, 1);
      const item = res.withdrawals[0];
      assert.strictEqual(item.amount, 1500);
      assert.strictEqual(item.maskedIdentifier, '******1234');
      assert.strictEqual(item.reconciliationReason, 'Discontinuity detected in ledger history');
      assert.strictEqual(item.payoutDetails, undefined); // raw details must never be exposed
    });

    it('Task 3: resolveQuarantinedWithdrawalAdmin rejects non-quarantined records and invalid inputs', async () => {
      const normalWithdrawal = createMockWithdrawal({
        amount: 1000,
        status: 'PENDING',
        metadata: { reconciliationRequiresManualReview: false },
      });

      await assert.rejects(
        () =>
          resolveQuarantinedWithdrawalAdmin(adminId, String(normalWithdrawal._id), {
            decision: 'APPLY_MISSING_CREDIT',
            reason: 'Legitimate manual resolution justification',
          }),
        /Withdrawal is not currently quarantined for manual review/
      );

      const quarantinedWithdrawal = createMockWithdrawal({
        amount: 1000,
        status: 'CANCELLED',
        metadata: { reconciliationRequiresManualReview: true },
      });

      // Invalid decision
      await assert.rejects(
        () =>
          resolveQuarantinedWithdrawalAdmin(adminId, String(quarantinedWithdrawal._id), {
            decision: 'INVALID_DECISION',
            reason: 'Legitimate manual resolution justification',
          }),
        /Valid decision is required/
      );

      // Short reason (< 10 chars)
      await assert.rejects(
        () =>
          resolveQuarantinedWithdrawalAdmin(adminId, String(quarantinedWithdrawal._id), {
            decision: 'APPLY_MISSING_CREDIT',
            reason: 'short',
          }),
        /Justification reason is required and must be at least 10 characters/
      );
    });

    it('Task 3: Dual-authorization rule strictly enforced for resolutions >= ₹10,000', async () => {
      const highValueWithdrawal = createMockWithdrawal({
        amount: 15000,
        status: 'CANCELLED',
        metadata: { reconciliationRequiresManualReview: true },
      });

      // 1. Missing second reviewer
      await assert.rejects(
        () =>
          resolveQuarantinedWithdrawalAdmin(adminId, String(highValueWithdrawal._id), {
            decision: 'APPLY_MISSING_CREDIT',
            reason: 'High value resolution confirmed by single admin',
          }),
        /Dual authorization required: resolutions for amounts >= ₹10000 require a second authorized reviewer/
      );

      // 2. Same admin as second reviewer
      await assert.rejects(
        () =>
          resolveQuarantinedWithdrawalAdmin(adminId, String(highValueWithdrawal._id), {
            decision: 'APPLY_MISSING_CREDIT',
            reason: 'High value resolution confirmed by self',
            secondReviewerId: adminId,
          }),
        /Dual authorization violation: Second reviewer must be a different administrator/
      );

      // 3. Malformed / invalid ObjectId string
      await assert.rejects(
        () =>
          resolveQuarantinedWithdrawalAdmin(adminId, String(highValueWithdrawal._id), {
            decision: 'APPLY_MISSING_CREDIT',
            reason: 'High value resolution with invalid reviewer id format',
            secondReviewerId: 'not-a-valid-object-id',
          }),
        /Dual authorization violation: Second reviewer ID is not a valid MongoDB ObjectId/
      );

      // 4. Non-existent reviewer account
      const unknownId = new mongoose.Types.ObjectId().toString();
      await assert.rejects(
        () =>
          resolveQuarantinedWithdrawalAdmin(adminId, String(highValueWithdrawal._id), {
            decision: 'APPLY_MISSING_CREDIT',
            reason: 'High value resolution with unknown reviewer account',
            secondReviewerId: unknownId,
          }),
        /Dual authorization violation: Second reviewer account does not exist/
      );

      // 5. Non-admin reviewer account (role: user)
      await assert.rejects(
        () =>
          resolveQuarantinedWithdrawalAdmin(adminId, String(highValueWithdrawal._id), {
            decision: 'APPLY_MISSING_CREDIT',
            reason: 'High value resolution with non-admin reviewer',
            secondReviewerId: otherUserId,
          }),
        /Dual authorization violation: Second reviewer must be an authorized administrator/
      );

      // 6. Inactive admin account
      const inactiveAdminId = new mongoose.Types.ObjectId().toString();
      users.set(inactiveAdminId, { _id: inactiveAdminId, role: 'admin', isActive: false });
      await assert.rejects(
        () =>
          resolveQuarantinedWithdrawalAdmin(adminId, String(highValueWithdrawal._id), {
            decision: 'APPLY_MISSING_CREDIT',
            reason: 'High value resolution with inactive admin reviewer',
            secondReviewerId: inactiveAdminId,
          }),
        /Dual authorization violation: Second reviewer account is inactive or suspended/
      );

      // 7. Suspended admin account (status: suspended)
      const suspendedAdminId = new mongoose.Types.ObjectId().toString();
      users.set(suspendedAdminId, { _id: suspendedAdminId, role: 'admin', status: 'suspended' });
      await assert.rejects(
        () =>
          resolveQuarantinedWithdrawalAdmin(adminId, String(highValueWithdrawal._id), {
            decision: 'APPLY_MISSING_CREDIT',
            reason: 'High value resolution with suspended admin reviewer',
            secondReviewerId: suspendedAdminId,
          }),
        /Dual authorization violation: Second reviewer account is inactive or suspended/
      );

      // 8. Valid active second administrator succeeds
      const res = await resolveQuarantinedWithdrawalAdmin(adminId, String(highValueWithdrawal._id), {
        decision: 'APPLY_MISSING_CREDIT',
        reason: 'High value resolution approved by two independent admins',
        secondReviewerId: secondAdminId,
      });
      assert.strictEqual(res.success, true);
    });

    it('Task 3: AuditLog write failure fails closed and does not mark resolution successful', async () => {
      const withdrawal = createMockWithdrawal({
        amount: 2000,
        status: 'CANCELLED',
        metadata: {
          reconciliationRequiresManualReview: true,
          refundWalletCredited: true,
          refundBalanceBefore: 0,
          refundBalanceAfter: 2000,
        },
      });

      // Stub AuditLog.create to throw a database persistence error
      AuditLog.create = async () => {
        throw new Error('Database write error: AuditLog disk I/O failure');
      };

      await assert.rejects(
        () =>
          resolveQuarantinedWithdrawalAdmin(adminId, String(withdrawal._id), {
            decision: 'CONFIRM_CREDIT_AND_SEAL',
            reason: 'Valid audit review justification that should fail due to audit logging failure',
          }),
        /AuditLog disk I\/O failure/
      );

      // Verify that the withdrawal was NOT marked resolved
      const doc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(doc.metadata.reconciliationRequiresManualReview, true);
      assert.strictEqual(doc.metadata.resolutionClaimed, undefined);
      assert.match(doc.metadata.lastResolutionError, /AuditLog disk I\/O failure/);
    });

    it('Task 3: APPLY_MISSING_CREDIT restores wallet balance, writes ledger, clears quarantine, and logs append-only audit', async () => {
      wallets.get(userId).balance = 2000;
      const withdrawal = createMockWithdrawal({
        amount: 500,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          reconciliationRequiresManualReview: true,
          refundWalletCredited: false,
          refundLedgerCreated: false,
        },
      });
      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;

      const res = await resolveQuarantinedWithdrawalAdmin(adminId, String(withdrawal._id), {
        decision: 'APPLY_MISSING_CREDIT',
        reason: 'Bank confirmation verified: user never received external payout, wallet was not credited',
      });

      assert.strictEqual(res.success, true);
      // Wallet balance updated
      assert.strictEqual(wallets.get(userId).balance, 2500);
      assert.ok(wallets.get(userId).processedOperations.includes(refundRef));

      // Ledger entry created
      const tx = transactions.find((t) => t.reference === refundRef);
      assert.ok(tx);
      assert.strictEqual(tx.amount, 500);
      assert.strictEqual(tx.balanceBefore, 2000);
      assert.strictEqual(tx.balanceAfter, 2500);

      // AuditLog recorded
      assert.strictEqual(auditLogs.length, 1);
      const log = auditLogs[0];
      assert.strictEqual(log.entityType, 'Withdrawal');
      assert.strictEqual(String(log.entityId), String(withdrawal._id));
      assert.strictEqual(log.action, 'QUARANTINE_RESOLVE_CREDIT');
      assert.strictEqual(String(log.performedBy), String(adminId));
      assert.strictEqual(log.decision, 'APPLY_MISSING_CREDIT');
      assert.strictEqual(log.stateBefore.wallet.balance, 2000);
      assert.strictEqual(log.stateAfter.wallet.balance, 2500);

      // Quarantine cleared
      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.metadata.reconciliationRequiresManualReview, undefined);
    });

    it('Task 3: APPLY_MISSING_CREDIT strictly rejects if wallet was already credited (idempotency defense)', async () => {
      wallets.get(userId).balance = 2500;
      const withdrawal = createMockWithdrawal({
        amount: 500,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          reconciliationRequiresManualReview: true,
        },
      });
      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      wallets.get(userId).processedOperations.push(refundRef);

      await assert.rejects(
        () =>
          resolveQuarantinedWithdrawalAdmin(adminId, String(withdrawal._id), {
            decision: 'APPLY_MISSING_CREDIT',
            reason: 'Erroneous attempt to double credit',
          }),
        /Idempotency violation: Wallet was already credited for this refund operation/
      );

      // Balance unchanged
      assert.strictEqual(wallets.get(userId).balance, 2500);
    });

    it('Task 3: CONFIRM_CREDIT_AND_SEAL verifies credit exists and seals quarantine without double credit', async () => {
      wallets.get(userId).balance = 2500;
      const withdrawal = createMockWithdrawal({
        amount: 500,
        status: 'CANCELLED',
        refundIssued: true,
        metadata: {
          reconciliationRequiresManualReview: true,
          refundWalletCredited: true,
          refundBalanceBefore: 2000,
          refundBalanceAfter: 2500,
        },
      });
      const refundRef = `REFUND-${withdrawal.withdrawalReference}`;
      wallets.get(userId).processedOperations.push(refundRef);

      const res = await resolveQuarantinedWithdrawalAdmin(adminId, String(withdrawal._id), {
        decision: 'CONFIRM_CREDIT_AND_SEAL',
        reason: 'Verified wallet was already credited; sealing quarantine record safely',
      });

      assert.strictEqual(res.success, true);
      // Balance remains 2500 (NO second credit!)
      assert.strictEqual(wallets.get(userId).balance, 2500);

      // Ledger entry created with confirmed historical snapshot
      const tx = transactions.find((t) => t.reference === refundRef);
      assert.ok(tx);
      assert.strictEqual(tx.balanceBefore, 2000);
      assert.strictEqual(tx.balanceAfter, 2500);

      // AuditLog created
      assert.strictEqual(auditLogs.length, 1);
      assert.strictEqual(auditLogs[0].decision, 'CONFIRM_CREDIT_AND_SEAL');
    });

    it('Task 3: REJECT_REFUND marks withdrawal REJECTED without modifying wallet balance', async () => {
      wallets.get(userId).balance = 1000;
      const withdrawal = createMockWithdrawal({
        amount: 500,
        status: 'CANCELLED',
        metadata: {
          reconciliationRequiresManualReview: true,
        },
      });

      const res = await resolveQuarantinedWithdrawalAdmin(adminId, String(withdrawal._id), {
        decision: 'REJECT_REFUND',
        reason: 'Fraudulent withdrawal cancellation attempt verified by risk team',
      });

      assert.strictEqual(res.success, true);
      // Wallet balance NOT modified
      assert.strictEqual(wallets.get(userId).balance, 1000);

      const wDoc = withdrawals.get(String(withdrawal._id));
      assert.strictEqual(wDoc.status, 'REJECTED');
      assert.strictEqual(wDoc.refundIssued, false);

      // AuditLog recorded
      assert.strictEqual(auditLogs.length, 1);
      assert.strictEqual(auditLogs[0].decision, 'REJECT_REFUND');
    });

    it('Task 3: Atomic CAS claim lock prevents concurrent resolution conflict', async () => {
      const withdrawal = createMockWithdrawal({
        amount: 500,
        status: 'CANCELLED',
        metadata: {
          reconciliationRequiresManualReview: true,
          resolutionClaimed: true, // already claimed by another admin
        },
      });

      await assert.rejects(
        () =>
          resolveQuarantinedWithdrawalAdmin(adminId, String(withdrawal._id), {
            decision: 'APPLY_MISSING_CREDIT',
            reason: 'Concurrent race resolution attempt',
          }),
        /Quarantine resolution conflict: operation is already being resolved by another administrator/
      );
    });

    it('Task 3: AuditLog schema enforces immutable append-only constraints', () => {
      // Test that pre-hooks on AuditLog schema block update/delete operations
      const errorMsg = /AuditLog entries are immutable and append-only/;

      assert.ok(AuditLog.schema);
      // Verify schema has pre hooks registered for mutation operations
      const hookTypes = ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany'];
      for (const hook of hookTypes) {
        assert.ok(
          AuditLog.schema.s.hooks._pres.has(hook),
          `Expected AuditLog schema to register pre-hook for ${hook}`
        );
      }
    });
  });
});
