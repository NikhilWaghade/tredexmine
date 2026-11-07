import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Withdrawal } from '../src/models/Withdrawal.js';
import { Wallet } from '../src/models/Wallet.js';
import { Transaction } from '../src/models/Transaction.js';
import {
  cancelWithdrawalRequest,
  rejectWithdrawalAdmin,
  updateWithdrawalStatusAdmin,
  createWithdrawalRequest,
} from '../src/services/walletService.js';

describe('Task B — Withdrawal Refund Concurrency & CAS Protection Tests', () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const adminId = new mongoose.Types.ObjectId().toString();

  // In-memory isolated storage
  let withdrawals = new Map();
  let wallets = new Map();
  let transactions = [];

  // Original methods
  let origWithdrawalFindOneAndUpdate;
  let origWithdrawalFindOne;
  let origWithdrawalFindById;
  let origWithdrawalUpdateOne;
  let origWalletFindOne;
  let origWalletFindOneAndUpdate;
  let origTransactionFindOne;
  let origTransactionCreate;

  beforeEach(() => {
    withdrawals = new Map();
    wallets = new Map();
    transactions = [];

    // Initialize mock user wallet
    wallets.set(userId, {
      _id: new mongoose.Types.ObjectId(),
      user: userId,
      balance: 1000,
    });

    origWithdrawalFindOneAndUpdate = Withdrawal.findOneAndUpdate;
    origWithdrawalFindOne = Withdrawal.findOne;
    origWithdrawalFindById = Withdrawal.findById;
    origWithdrawalUpdateOne = Withdrawal.updateOne;
    origWalletFindOne = Wallet.findOne;
    origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
    origTransactionFindOne = Transaction.findOne;
    origTransactionCreate = Transaction.create;

    Withdrawal.updateOne = async (filter, update) => {
      const doc = await Withdrawal.findOne(filter);
      if (!doc) return { acknowledged: true, modifiedCount: 0 };
      if (update.$set) Object.assign(doc, update.$set);
      return { acknowledged: true, modifiedCount: 1 };
    };

    // Atomic CAS mock for Withdrawal.findOneAndUpdate
    Withdrawal.findOneAndUpdate = async (filter, update, options = {}) => {
      let matchedDoc = null;

      for (const doc of withdrawals.values()) {
        const idMatches = filter._id
          ? String(doc._id) === String(filter._id)
          : true;
        const userMatches = filter.user
          ? String(doc.user) === String(filter.user)
          : true;

        let statusMatches = true;
        if (filter.status) {
          if (typeof filter.status === 'string') {
            statusMatches = doc.status === filter.status;
          } else if (filter.status.$in) {
            statusMatches = filter.status.$in.includes(doc.status);
          }
        }

        const refundMatches =
          filter.refundIssued !== undefined
            ? doc.refundIssued === filter.refundIssued
            : true;

        if (idMatches && userMatches && statusMatches && refundMatches) {
          matchedDoc = doc;
          break;
        }
      }

      if (!matchedDoc) {
        return null;
      }

      // Apply $set updates atomically
      if (update.$set) {
        Object.assign(matchedDoc, update.$set);
      }

      return { ...matchedDoc };
    };

    Withdrawal.findOne = async (query) => {
      for (const doc of withdrawals.values()) {
        const idMatches = query._id
          ? String(doc._id) === String(query._id)
          : true;
        const userMatches = query.user
          ? String(doc.user) === String(query.user)
          : true;
        const statusMatches = query.status ? doc.status === query.status : true;
        const keyMatches = query.idempotencyKey
          ? doc.idempotencyKey === query.idempotencyKey
          : true;

        if (idMatches && userMatches && statusMatches && keyMatches) {
          return { ...doc };
        }
      }
      return null;
    };

    Withdrawal.findById = async (id) => {
      const doc = withdrawals.get(String(id));
      return doc ? { ...doc } : null;
    };

    Wallet.findOne = async (query) => {
      const uId = String(query.user || query);
      const w = wallets.get(uId);
      return w ? { ...w } : null;
    };

    Wallet.findOneAndUpdate = async (query, update, options = {}) => {
      const uId = String(query.user);
      const w = wallets.get(uId);
      if (!w) return null;

      if (query.balance && query.balance.$gte !== undefined) {
        if (w.balance < query.balance.$gte) {
          return null; // Insufficient balance
        }
      }

      if (update.$inc && update.$inc.balance !== undefined) {
        w.balance += update.$inc.balance;
        w.balance = Math.round(w.balance * 100) / 100;
      }

      return { ...w };
    };

    Transaction.findOne = async (query) => {
      for (const t of transactions) {
        if (query.reference && t.reference === query.reference) {
          return { ...t };
        }
      }
      return null;
    };

    Transaction.create = async (doc) => {
      const items = Array.isArray(doc) ? doc : [doc];
      for (const item of items) {
        transactions.push({ ...item, _id: new mongoose.Types.ObjectId() });
      }
      return Array.isArray(doc) ? items : items[0];
    };
  });

  afterEach(() => {
    Withdrawal.findOneAndUpdate = origWithdrawalFindOneAndUpdate;
    Withdrawal.findOne = origWithdrawalFindOne;
    Withdrawal.findById = origWithdrawalFindById;
    Withdrawal.updateOne = origWithdrawalUpdateOne;
    Wallet.findOne = origWalletFindOne;
    Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
    Transaction.findOne = origTransactionFindOne;
    Transaction.create = origTransactionCreate;
  });

  /* ==========================================================================
     1. TWO SIMULTANEOUS CANCELLATION REQUESTS
     ========================================================================== */
  it('prevents double refund on two simultaneous user cancellation requests', async () => {
    const withdrawalId = new mongoose.Types.ObjectId().toString();
    const withdrawalRef = 'WTH-RACE-CANCEL-001';

    // Seed PENDING withdrawal for 300 INR
    withdrawals.set(withdrawalId, {
      _id: withdrawalId,
      user: userId,
      amount: 300,
      status: 'PENDING',
      withdrawalReference: withdrawalRef,
      refundIssued: false,
    });

    // Wallet balance before refund is 700
    wallets.get(userId).balance = 700;

    // Fire two cancellation requests concurrently
    const [result1, result2] = await Promise.allSettled([
      cancelWithdrawalRequest(userId, withdrawalId),
      cancelWithdrawalRequest(userId, withdrawalId),
    ]);

    const fulfilled = [result1, result2].filter((r) => r.status === 'fulfilled');
    const rejected = [result1, result2].filter((r) => r.status === 'rejected');

    // Exactly one request must succeed
    assert.strictEqual(fulfilled.length, 1, 'Exactly one cancellation must succeed');
    assert.strictEqual(rejected.length, 1, 'The concurrent cancellation must be safely rejected');

    assert.strictEqual(fulfilled[0].value.success, true);
    assert.match(
      rejected[0].reason.message,
      /(already CANCELLED|already been issued)/
    );

    // Verify wallet balance was credited EXACTLY ONCE (+300 => 1000, NOT +600 => 1300)
    assert.strictEqual(wallets.get(userId).balance, 1000);

    // Verify exactly one refund ledger entry was created with unique reference
    const refundTxs = transactions.filter(
      (tx) => tx.reference === `REFUND-${withdrawalRef}`
    );
    assert.strictEqual(refundTxs.length, 1, 'Exactly one refund transaction ledger entry must exist');
    assert.strictEqual(refundTxs[0].amount, 300);
    assert.strictEqual(refundTxs[0].type, 'credit');
    assert.strictEqual(refundTxs[0].balanceBefore, 700);
    assert.strictEqual(refundTxs[0].balanceAfter, 1000);

    // Verify withdrawal document state
    const finalWithdrawal = withdrawals.get(withdrawalId);
    assert.strictEqual(finalWithdrawal.status, 'CANCELLED');
    assert.strictEqual(finalWithdrawal.refundIssued, true);
  });

  /* ==========================================================================
     2. SIMULTANEOUS USER CANCELLATION AND ADMIN REJECTION
     ========================================================================== */
  it('prevents double refund when user cancellation and admin rejection race concurrently', async () => {
    const withdrawalId = new mongoose.Types.ObjectId().toString();
    const withdrawalRef = 'WTH-RACE-USER-ADMIN-002';

    withdrawals.set(withdrawalId, {
      _id: withdrawalId,
      user: userId,
      amount: 400,
      status: 'PENDING',
      withdrawalReference: withdrawalRef,
      refundIssued: false,
    });

    wallets.get(userId).balance = 500;

    // Concurrently fire user cancellation and admin rejection
    const [userRes, adminRes] = await Promise.allSettled([
      cancelWithdrawalRequest(userId, withdrawalId),
      rejectWithdrawalAdmin(adminId, withdrawalId, 'Administrative review rejection'),
    ]);

    const fulfilled = [userRes, adminRes].filter((r) => r.status === 'fulfilled');
    const rejected = [userRes, adminRes].filter((r) => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1, 'Only one operation can claim the refund');
    assert.strictEqual(rejected.length, 1, 'The losing operation must fail with 400');

    // Balance must be credited exactly once (+400 => 900)
    assert.strictEqual(wallets.get(userId).balance, 900);

    // Exactly one ledger transaction
    const refundTxs = transactions.filter(
      (tx) => tx.reference === `REFUND-${withdrawalRef}`
    );
    assert.strictEqual(refundTxs.length, 1);
    assert.strictEqual(refundTxs[0].amount, 400);

    // Final withdrawal state must have refundIssued: true
    const finalWithdrawal = withdrawals.get(withdrawalId);
    assert.strictEqual(finalWithdrawal.refundIssued, true);
    assert.ok(['CANCELLED', 'REJECTED'].includes(finalWithdrawal.status));
  });

  /* ==========================================================================
     3. DUPLICATE ADMIN REJECTION REQUESTS
     ========================================================================== */
  it('prevents double refund on duplicate or concurrent admin rejection requests', async () => {
    const withdrawalId = new mongoose.Types.ObjectId().toString();
    const withdrawalRef = 'WTH-RACE-ADMIN-REJ-003';

    withdrawals.set(withdrawalId, {
      _id: withdrawalId,
      user: userId,
      amount: 250,
      status: 'PENDING',
      withdrawalReference: withdrawalRef,
      refundIssued: false,
    });

    wallets.get(userId).balance = 600;

    const [rej1, rej2] = await Promise.allSettled([
      rejectWithdrawalAdmin(adminId, withdrawalId, 'Duplicate reason 1'),
      rejectWithdrawalAdmin(adminId, withdrawalId, 'Duplicate reason 2'),
    ]);

    const fulfilled = [rej1, rej2].filter((r) => r.status === 'fulfilled');
    const rejected = [rej1, rej2].filter((r) => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1);
    assert.strictEqual(rejected.length, 1);

    assert.strictEqual(wallets.get(userId).balance, 850);

    const refundTxs = transactions.filter(
      (tx) => tx.reference === `REFUND-${withdrawalRef}`
    );
    assert.strictEqual(refundTxs.length, 1);
    assert.strictEqual(refundTxs[0].amount, 250);

    const finalWithdrawal = withdrawals.get(withdrawalId);
    assert.strictEqual(finalWithdrawal.status, 'REJECTED');
    assert.strictEqual(finalWithdrawal.refundIssued, true);
  });

  /* ==========================================================================
     4. CONCURRENT FAILED-WITHDRAWAL RECOVERY
     ========================================================================== */
  it('prevents double refund on concurrent failed-withdrawal recovery in PROCESSING state', async () => {
    const withdrawalId = new mongoose.Types.ObjectId().toString();
    const withdrawalRef = 'WTH-RACE-PROC-FAIL-004';

    // Status is PROCESSING
    withdrawals.set(withdrawalId, {
      _id: withdrawalId,
      user: userId,
      amount: 500,
      status: 'PROCESSING',
      withdrawalReference: withdrawalRef,
      refundIssued: false,
    });

    wallets.get(userId).balance = 200;

    const [failRes1, failRes2] = await Promise.allSettled([
      updateWithdrawalStatusAdmin(adminId, withdrawalId, {
        status: 'FAILED',
        adminNotes: 'Network timeout during payout execution',
      }),
      updateWithdrawalStatusAdmin(adminId, withdrawalId, {
        status: 'FAILED',
        adminNotes: 'Concurrent retry of failed payout',
      }),
    ]);

    const fulfilled = [failRes1, failRes2].filter((r) => r.status === 'fulfilled');
    const rejected = [failRes1, failRes2].filter((r) => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1, 'Exactly one status update to FAILED must succeed');
    assert.strictEqual(rejected.length, 1, 'Concurrent update to FAILED must be rejected');

    assert.strictEqual(wallets.get(userId).balance, 700);

    const refundTxs = transactions.filter(
      (tx) => tx.reference === `REFUND-${withdrawalRef}`
    );
    assert.strictEqual(refundTxs.length, 1);
    assert.strictEqual(refundTxs[0].amount, 500);

    const finalWithdrawal = withdrawals.get(withdrawalId);
    assert.strictEqual(finalWithdrawal.status, 'FAILED');
    assert.strictEqual(finalWithdrawal.refundIssued, true);
  });

  it('rejects failed-withdrawal status update if withdrawal was already CANCELLED or REJECTED', async () => {
    const cancelledId = new mongoose.Types.ObjectId().toString();
    const rejectedId = new mongoose.Types.ObjectId().toString();

    withdrawals.set(cancelledId, {
      _id: cancelledId,
      user: userId,
      amount: 150,
      status: 'CANCELLED',
      withdrawalReference: 'WTH-ALREADY-CANCELLED',
      refundIssued: true,
    });

    withdrawals.set(rejectedId, {
      _id: rejectedId,
      user: userId,
      amount: 200,
      status: 'REJECTED',
      withdrawalReference: 'WTH-ALREADY-REJECTED',
      refundIssued: true,
    });

    wallets.get(userId).balance = 800;

    // Attempting FAILED on CANCELLED record
    await assert.rejects(
      async () => {
        await updateWithdrawalStatusAdmin(adminId, cancelledId, { status: 'FAILED' });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /Cannot change status from CANCELLED to FAILED/);
        return true;
      }
    );

    // Attempting FAILED on REJECTED record
    await assert.rejects(
      async () => {
        await updateWithdrawalStatusAdmin(adminId, rejectedId, { status: 'FAILED' });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /Cannot change status from REJECTED to FAILED/);
        return true;
      }
    );

    // Balance must be completely unchanged
    assert.strictEqual(wallets.get(userId).balance, 800);
    assert.strictEqual(transactions.length, 0);
  });

  /* ==========================================================================
     5. EXISTING COMPLETED, REJECTED, AND CANCELLED RECORDS REMAIN UNTOUCHED
     ========================================================================== */
  it('ensures existing COMPLETED, REJECTED, and CANCELLED records cannot be refunded or cancelled', async () => {
    const completedId = new mongoose.Types.ObjectId().toString();
    withdrawals.set(completedId, {
      _id: completedId,
      user: userId,
      amount: 600,
      status: 'COMPLETED',
      withdrawalReference: 'WTH-COMPLETED-001',
      refundIssued: false,
    });

    wallets.get(userId).balance = 400;

    // 1. User cancel on COMPLETED must fail
    await assert.rejects(
      async () => cancelWithdrawalRequest(userId, completedId),
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /already COMPLETED/);
        return true;
      }
    );

    // 2. Admin reject on COMPLETED must fail
    await assert.rejects(
      async () => rejectWithdrawalAdmin(adminId, completedId, 'Cannot reject completed'),
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /Cannot reject a withdrawal request with status COMPLETED/);
        return true;
      }
    );

    // Balance and ledger must not change
    assert.strictEqual(wallets.get(userId).balance, 400);
    assert.strictEqual(transactions.length, 0);
    assert.strictEqual(withdrawals.get(completedId).status, 'COMPLETED');
    assert.strictEqual(withdrawals.get(completedId).refundIssued, false);
  });

  /* ==========================================================================
     6. NO NEGATIVE WALLET BALANCE INVARIANT
     ========================================================================== */
  it('enforces that wallet balance can never drop below zero on withdrawal reservation', async () => {
    wallets.get(userId).balance = 100;

    await assert.rejects(
      async () => {
        await createWithdrawalRequest(userId, {
          amount: 250,
          idempotencyKey: 'idemp-insufficient-001',
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /Insufficient withdrawable wallet balance/);
        return true;
      }
    );

    assert.strictEqual(wallets.get(userId).balance, 100);
    assert.strictEqual(withdrawals.size, 0);
  });
});
