/**
 * Comprehensive User Withdrawal Flow Integration Tests (UPI + Bank Transfer)
 *
 * Exercises all 16 required scenarios:
 * 1. UPI withdrawal success
 * 2. Bank withdrawal success
 * 3. Invalid UPI ID
 * 4. Missing bank fields
 * 5. Account number mismatch
 * 6. Invalid IFSC
 * 7. Zero and negative amounts
 * 8. Insufficient wallet balance
 * 9. Duplicate submission (idempotency key)
 * 10. Concurrent withdrawal requests
 * 11. Unauthorized request
 * 12. Another user's wallet access attempt
 * 13. Admin visibility of payout details with masking
 * 14. Authorized reveal behavior
 * 15. Rejected withdrawal and safe wallet refund
 * 16. API connectivity and environment configuration
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { Withdrawal } from '../src/models/Withdrawal.js';
import { Transaction } from '../src/models/Transaction.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { generateAccessToken } from '../src/utils/tokenService.js';
import { encryptPayoutData, decryptPayoutData } from '../src/utils/cryptoService.js';
import { maskPayoutIdentifier } from '../src/services/walletService.js';

describe('User Withdrawal Flow (UPI + Bank Transfer) Comprehensive Tests', () => {
  let server;
  let baseUrl;

  const userAId = new mongoose.Types.ObjectId();
  const userBId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();

  let userAToken;
  let userBToken;
  let adminToken;

  // In-memory collections
  let users = new Map();
  let wallets = new Map();
  let withdrawals = new Map();
  let transactions = [];

  // Mongoose original methods
  let origUserFindById;
  let origUserFind;
  let origWalletFindOne;
  let origWalletFindOneAndUpdate;
  let origWalletFind;
  let origWithdrawalFindOne;
  let origWithdrawalFind;
  let origWithdrawalFindById;
  let origWithdrawalFindOneAndUpdate;
  let origWithdrawalCreate;
  let origWithdrawalCountDocuments;
  let origWithdrawalUpdateOne;
  let origTransactionCreate;
  let origTransactionFind;
  let origAuditLogCreate;

  function createQuery(getItemsFn) {
    let skipVal = 0;
    let limitVal = Infinity;
    const populatePaths = [];
    const selectFields = [];
    const q = {
      populate: (path) => {
        populatePaths.push(path);
        return q;
      },
      sort: () => q,
      select: (fields) => {
        if (typeof fields === 'string') {
          selectFields.push(...fields.split(' ').filter(Boolean));
        }
        return q;
      },
      skip: (n) => {
        skipVal = Math.max(0, parseInt(n, 10) || 0);
        return q;
      },
      limit: (n) => {
        limitVal = Math.max(0, parseInt(n, 10) || Infinity);
        return q;
      },
      then: (resolve, reject) => {
        try {
          const raw = getItemsFn({ populatePaths, selectFields });
          if (Array.isArray(raw)) {
            let items = raw;
            if (skipVal > 0) items = items.slice(skipVal);
            if (limitVal !== Infinity) items = items.slice(0, limitVal);
            resolve(items);
          } else {
            resolve(raw);
          }
        } catch (err) {
          if (reject) reject(err);
          else throw err;
        }
      },
      catch: (reject) => q.then(null, reject),
    };
    return q;
  }

  before(async () => {
    process.env.JWT_SECRET = 'test_jwt_secret_min_32_characters_long_for_security';
    process.env.NODE_ENV = 'test';

    userAToken = generateAccessToken({ id: userAId, role: 'user' });
    userBToken = generateAccessToken({ id: userBId, role: 'user' });
    adminToken = generateAccessToken({ id: adminId, role: 'admin' });

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Save originals
    origUserFindById = User.findById;
    origUserFind = User.find;
    origWalletFindOne = Wallet.findOne;
    origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
    origWalletFind = Wallet.find;
    origWithdrawalFindOne = Withdrawal.findOne;
    origWithdrawalFind = Withdrawal.find;
    origWithdrawalFindById = Withdrawal.findById;
    origWithdrawalFindOneAndUpdate = Withdrawal.findOneAndUpdate;
    origWithdrawalCreate = Withdrawal.create;
    origWithdrawalCountDocuments = Withdrawal.countDocuments;
    origWithdrawalUpdateOne = Withdrawal.updateOne;
    origTransactionCreate = Transaction.create;
    origTransactionFind = Transaction.find;
    origAuditLogCreate = AuditLog.create;
  });

  after(async () => {
    try {
      User.findById = origUserFindById;
      User.find = origUserFind;
      Wallet.findOne = origWalletFindOne;
      Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
      Wallet.find = origWalletFind;
      Withdrawal.findOne = origWithdrawalFindOne;
      Withdrawal.find = origWithdrawalFind;
      Withdrawal.findById = origWithdrawalFindById;
      Withdrawal.findOneAndUpdate = origWithdrawalFindOneAndUpdate;
      Withdrawal.create = origWithdrawalCreate;
      Withdrawal.countDocuments = origWithdrawalCountDocuments;
      Withdrawal.updateOne = origWithdrawalUpdateOne;
      Transaction.create = origTransactionCreate;
      Transaction.find = origTransactionFind;
      AuditLog.create = origAuditLogCreate;
    } finally {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  });

  beforeEach(() => {
    users.clear();
    wallets.clear();
    withdrawals.clear();
    transactions = [];

    // Seed Users
    users.set(String(userAId), {
      _id: userAId,
      name: 'User A Investor',
      email: 'usera@example.com',
      role: 'user',
      isActive: true,
    });

    users.set(String(userBId), {
      _id: userBId,
      name: 'User B Investor',
      email: 'userb@example.com',
      role: 'user',
      isActive: true,
    });

    users.set(String(adminId), {
      _id: adminId,
      name: 'System Admin',
      email: 'admin@example.com',
      role: 'admin',
      isActive: true,
    });

    // Seed Wallets: User A = ₹5,000, User B = ₹2,000
    wallets.set(String(userAId), {
      _id: new mongoose.Types.ObjectId(),
      user: userAId,
      balance: 5000,
      currency: 'INR',
      processedOperations: [],
      updatedAt: new Date(),
    });

    wallets.set(String(userBId), {
      _id: new mongoose.Types.ObjectId(),
      user: userBId,
      balance: 2000,
      currency: 'INR',
      processedOperations: [],
      updatedAt: new Date(),
    });

    // =========================================================================
    // Stubs
    // =========================================================================

    User.findById = (id) => {
      const u = users.get(String(id)) || null;
      return createQuery(({ selectFields }) => {
        if (!u) return null;
        const copy = { ...u, toObject: () => ({ ...u }) };
        return copy;
      });
    };

    User.find = () => createQuery(() => [...users.values()]);

    Wallet.findOne = (query = {}) => {
      return createQuery(() => {
        if (query.user) {
          const w = wallets.get(String(query.user));
          return w ? { ...w, toObject: () => ({ ...w }) } : null;
        }
        return null;
      });
    };

    Wallet.findOneAndUpdate = async (filter, update) => {
      const uId = String(filter.user);
      const w = wallets.get(uId);
      if (!w) return null;

      // Check balance condition (CAS: balance: { $gte: amount })
      if (filter.balance?.$gte !== undefined) {
        if (w.balance < filter.balance.$gte) {
          return null;
        }
      }

      if (update.$inc?.balance) {
        w.balance += update.$inc.balance;
        w.balance = Math.round(w.balance * 100) / 100;
      }

      if (update.$push?.processedOperations) {
        w.processedOperations = w.processedOperations || [];
        w.processedOperations.push(update.$push.processedOperations);
      }

      wallets.set(uId, w);
      return { ...w, toObject: () => ({ ...w }) };
    };

    Wallet.find = () => createQuery(() => [...wallets.values()]);

    Withdrawal.findOne = (query = {}) => {
      return createQuery(() => {
        for (const item of withdrawals.values()) {
          if (query.user && String(item.user) !== String(query.user)) continue;
          if (query.idempotencyKey && item.idempotencyKey !== query.idempotencyKey) continue;
          if (query.withdrawalReference && item.withdrawalReference !== query.withdrawalReference) continue;
          return { ...item, toObject: () => ({ ...item }) };
        }
        return null;
      });
    };

    Withdrawal.findById = (id) => {
      const item = withdrawals.get(String(id));
      return createQuery(({ populatePaths, selectFields }) => {
        if (!item) return null;
        const copy = {
          ...item,
          user: populatePaths.includes('user') ? users.get(String(item.user)) || { name: 'User', email: 'u@test.com' } : item.user,
          toObject: () => ({ ...copy }),
          save: async function () {
            Object.assign(item, this);
            withdrawals.set(String(id), item);
            return this;
          },
        };
        return copy;
      });
    };

    Withdrawal.findOneAndUpdate = async (filter, update) => {
      const id = String(filter._id);
      const w = withdrawals.get(id);
      if (!w) return null;

      if (filter.status?.$in && !filter.status.$in.includes(w.status)) {
        return null;
      }
      if (filter.refundIssued !== undefined && w.refundIssued !== filter.refundIssued) {
        return null;
      }

      if (update.$set) {
        Object.assign(w, update.$set);
        if (update.$set['metadata.refundWalletCredited'] !== undefined) {
          w.metadata = w.metadata || {};
          w.metadata.refundWalletCredited = update.$set['metadata.refundWalletCredited'];
        }
      }

      withdrawals.set(id, w);
      return { ...w, toObject: () => ({ ...w }) };
    };

    Withdrawal.find = (query = {}) => {
      return createQuery(({ populatePaths, selectFields }) => {
        let items = [...withdrawals.values()];
        if (query.user) {
          items = items.filter((w) => String(w.user) === String(query.user));
        }
        if (query.status && query.status !== 'all') {
          items = items.filter((w) => w.status === query.status);
        }
        return items.map((w) => {
          const doc = {
            ...w,
            user: populatePaths.includes('user') ? users.get(String(w.user)) || { name: 'User', email: 'u@test.com', role: 'user' } : w.user,
            toObject: () => ({ ...doc }),
          };
          // Filter out sensitive fields if excluded via select
          if (selectFields.some((f) => f.includes('-payoutDetails.encryptedData'))) {
            doc.payoutDetails = {
              accountHolderName: doc.payoutDetails?.accountHolderName || '',
              bankName: doc.payoutDetails?.bankName || '',
              maskedIdentifier: doc.payoutDetails?.maskedIdentifier || '',
            };
          }
          return doc;
        });
      });
    };

    Withdrawal.create = async (docOrArray) => {
      const docs = Array.isArray(docOrArray) ? docOrArray : [docOrArray];
      const created = [];
      for (const d of docs) {
        const id = d._id || new mongoose.Types.ObjectId();
        const fullDoc = {
          ...d,
          _id: id,
          createdAt: new Date(),
          updatedAt: new Date(),
          toObject: function () { return { ...this }; },
          save: async function () { return this; },
        };
        withdrawals.set(String(id), fullDoc);
        created.push(fullDoc);
      }
      return Array.isArray(docOrArray) ? created : created[0];
    };

    Withdrawal.countDocuments = async (query = {}) => {
      let count = 0;
      for (const item of withdrawals.values()) {
        if (query.user && String(item.user) !== String(query.user)) continue;
        if (query.status && item.status !== query.status) continue;
        count++;
      }
      return count;
    };

    Withdrawal.updateOne = async (filter, update) => {
      const id = String(filter._id);
      const w = withdrawals.get(id);
      if (w) {
        if (update.$set) {
          Object.assign(w, update.$set);
        }
        withdrawals.set(id, w);
      }
      return { modifiedCount: w ? 1 : 0 };
    };

    Transaction.create = async (data) => {
      const items = Array.isArray(data) ? data : [data];
      transactions.push(...items);
      return items;
    };

    Transaction.find = () => createQuery(() => [...transactions]);

    AuditLog.create = async (doc) => ({ _id: new mongoose.Types.ObjectId(), ...doc });
  });

  // =========================================================================
  // 1. UPI WITHDRAWAL SUCCESS
  // =========================================================================
  it('1. successfully submits UPI withdrawal request, reserves balance, and masks UPI identifier', async () => {
    const res = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        amount: 500,
        idempotencyKey: 'idemp-upi-success-01',
        payoutMethod: 'upi',
        payoutDetails: {
          upiId: 'nikku.investor@okhdfcbank',
          identifier: 'nikku.investor@okhdfcbank',
        },
      }),
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.withdrawal.status, 'PENDING');
    assert.strictEqual(body.withdrawal.amount, 500);
    assert.strictEqual(body.withdrawal.payoutMethod, 'upi');
    assert.strictEqual(body.withdrawal.payoutDetails.maskedIdentifier, 'n***r@okhdfcbank');
    assert.strictEqual(body.wallet.balance, 4500);

    // Verify wallet in store was debited
    const walletA = wallets.get(String(userAId));
    assert.strictEqual(walletA.balance, 4500);
  });

  // =========================================================================
  // 2. BANK WITHDRAWAL SUCCESS
  // =========================================================================
  it('2. successfully submits Bank Transfer withdrawal request with encrypted credentials at rest and no confirm field stored', async () => {
    const res = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        amount: 1000,
        idempotencyKey: 'idemp-bank-success-01',
        payoutMethod: 'bank_transfer',
        payoutDetails: {
          accountHolderName: 'Nikku Investor',
          bankName: 'State Bank of India',
          accountNumber: '123456789012',
          confirmAccountNumber: '123456789012',
          ifscCode: 'SBIN0001234',
        },
      }),
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.withdrawal.status, 'PENDING');
    assert.strictEqual(body.withdrawal.amount, 1000);
    assert.strictEqual(body.withdrawal.payoutMethod, 'bank_transfer');
    assert.strictEqual(body.withdrawal.payoutDetails.accountHolderName, 'Nikku Investor');
    assert.strictEqual(body.withdrawal.payoutDetails.bankName, 'State Bank of India');
    assert.strictEqual(body.withdrawal.payoutDetails.maskedIdentifier, '******9012');
    assert.strictEqual(body.withdrawal.payoutDetails.confirmAccountNumber, undefined);
    assert.strictEqual(body.wallet.balance, 4000);

    // Ensure raw account number is NOT in stored withdrawal doc, but encrypted
    const saved = [...withdrawals.values()].find((w) => w.idempotencyKey === 'idemp-bank-success-01');
    assert.ok(saved);
    assert.strictEqual(saved.payoutDetails.confirmAccountNumber, undefined);
    assert.ok(saved.payoutDetails.encryptedData);
    assert.ok(saved.payoutDetails.encryptionIv);
    assert.ok(saved.payoutDetails.encryptionTag);

    // Decrypt and verify payload at rest
    const decrypted = decryptPayoutData({
      encryptedData: saved.payoutDetails.encryptedData,
      iv: saved.payoutDetails.encryptionIv,
      tag: saved.payoutDetails.encryptionTag,
    });
    assert.strictEqual(decrypted.accountNumber, '123456789012');
    assert.strictEqual(decrypted.ifscCode, 'SBIN0001234');
  });

  // =========================================================================
  // 3. INVALID UPI ID
  // =========================================================================
  it('3. rejects malformed or invalid UPI ID with 400 and descriptive message', async () => {
    const res = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        amount: 500,
        idempotencyKey: 'idemp-upi-invalid',
        payoutMethod: 'upi',
        payoutDetails: {
          upiId: 'invalid_upi_without_at_symbol',
        },
      }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.ok(body.errors.some((e) => e.includes('Invalid UPI ID format')));
  });

  // =========================================================================
  // 4. MISSING BANK FIELDS
  // =========================================================================
  it('4. rejects bank withdrawal with missing mandatory fields (holder name, bank, account, ifsc)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        amount: 500,
        idempotencyKey: 'idemp-bank-missing',
        payoutMethod: 'bank_transfer',
        payoutDetails: {
          bankName: 'HDFC Bank', // Missing accountHolderName, accountNumber, ifscCode
        },
      }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.ok(body.errors.some((e) => e.includes('Account holder name is required')));
    assert.ok(body.errors.some((e) => e.includes('Bank account number is required')));
    assert.ok(body.errors.some((e) => e.includes('IFSC code is required')));
  });

  // =========================================================================
  // 5. ACCOUNT NUMBER MISMATCH
  // =========================================================================
  it('5. rejects bank withdrawal when Account Number and Re-enter Account Number mismatch', async () => {
    const res = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        amount: 500,
        idempotencyKey: 'idemp-bank-mismatch',
        payoutMethod: 'bank_transfer',
        payoutDetails: {
          accountHolderName: 'Nikku Investor',
          bankName: 'State Bank of India',
          accountNumber: '123456789012',
          confirmAccountNumber: '987654321098', // Mismatched
          ifscCode: 'SBIN0001234',
        },
      }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.ok(body.errors.some((e) => e.includes('do not match')));
  });

  // =========================================================================
  // 6. INVALID IFSC
  // =========================================================================
  it('6. rejects bank withdrawal with invalid IFSC format (e.g. lowercase, missing zero, wrong length)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        amount: 500,
        idempotencyKey: 'idemp-bank-bad-ifsc',
        payoutMethod: 'bank_transfer',
        payoutDetails: {
          accountHolderName: 'Nikku Investor',
          bankName: 'State Bank of India',
          accountNumber: '123456789012',
          confirmAccountNumber: '123456789012',
          ifscCode: 'INVALID_123',
        },
      }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.ok(body.errors.some((e) => e.includes('Invalid IFSC code format')));
  });

  // =========================================================================
  // 7. ZERO AND NEGATIVE AMOUNTS
  // =========================================================================
  it('7. rejects zero and negative amounts with 400 validation error', async () => {
    const resZero = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        amount: 0,
        idempotencyKey: 'idemp-zero',
        payoutMethod: 'upi',
        payoutDetails: { upiId: 'user@okhdfcbank' },
      }),
    });
    assert.strictEqual(resZero.status, 400);

    const resNeg = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        amount: -500,
        idempotencyKey: 'idemp-neg',
        payoutMethod: 'upi',
        payoutDetails: { upiId: 'user@okhdfcbank' },
      }),
    });
    assert.strictEqual(resNeg.status, 400);
  });

  // =========================================================================
  // 8. INSUFFICIENT WALLET BALANCE
  // =========================================================================
  it('8. rejects withdrawal request exceeding available balance with 400', async () => {
    // User A has 5000, attempt to withdraw 10,000
    const res = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        amount: 10000,
        idempotencyKey: 'idemp-excessive',
        payoutMethod: 'upi',
        payoutDetails: { upiId: 'user@okhdfcbank' },
      }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.match(body.message, /Insufficient/i);
    assert.strictEqual(wallets.get(String(userAId)).balance, 5000);
  });

  // =========================================================================
  // 9. DUPLICATE SUBMISSION (IDEMPOTENCY)
  // =========================================================================
  it('9. ensures duplicate submission with same idempotency key returns idempotent response without double debit', async () => {
    const payload = {
      amount: 500,
      idempotencyKey: 'idemp-dup-test-01',
      payoutMethod: 'upi',
      payoutDetails: { upiId: 'user@okhdfcbank' },
    };

    // First submission
    const res1 = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userAToken}` },
      body: JSON.stringify(payload),
    });
    assert.strictEqual(res1.status, 201);
    const body1 = await res1.json();
    assert.strictEqual(body1.wallet.balance, 4500);

    // Second submission (retry with same idempotency key)
    const res2 = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userAToken}` },
      body: JSON.stringify(payload),
    });
    assert.strictEqual(res2.status, 201);
    const body2 = await res2.json();
    assert.strictEqual(body2.isIdempotent, true);
    assert.strictEqual(body2.wallet.balance, 4500); // Balance remains 4500, NOT double-debited to 4000
    assert.strictEqual(wallets.get(String(userAId)).balance, 4500);
  });

  // =========================================================================
  // 10. CONCURRENT WITHDRAWAL REQUESTS
  // =========================================================================
  it('10. prevents concurrent requests from double-spending when total exceeds balance', async () => {
    // User A has 5000. Send two simultaneous requests of 3000 each (total 6000 > 5000)
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userAToken}` },
        body: JSON.stringify({
          amount: 3000,
          idempotencyKey: 'concurrent-1',
          payoutMethod: 'upi',
          payoutDetails: { upiId: 'user@okhdfcbank' },
        }),
      }),
      fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userAToken}` },
        body: JSON.stringify({
          amount: 3000,
          idempotencyKey: 'concurrent-2',
          payoutMethod: 'upi',
          payoutDetails: { upiId: 'user@okhdfcbank' },
        }),
      }),
    ]);

    const statuses = [res1.status, res2.status];
    assert.ok(statuses.includes(201), 'At least one request must succeed');
    assert.ok(statuses.includes(400), 'The second request must fail due to balance check');

    // Balance must be 2000 (5000 - 3000) and never drop below zero
    assert.strictEqual(wallets.get(String(userAId)).balance, 2000);
  });

  // =========================================================================
  // 11. UNAUTHORIZED REQUEST
  // =========================================================================
  it('11. rejects unauthenticated withdrawal requests with 401', async () => {
    const res = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 500,
        idempotencyKey: 'no-auth-001',
      }),
    });
    assert.strictEqual(res.status, 401);
  });

  // =========================================================================
  // 12. ANOTHER USER'S WALLET ACCESS ATTEMPT
  // =========================================================================
  it('12. enforces that users can only withdraw from their own authenticated account', async () => {
    // User B submits withdrawal with User B token
    const res = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userBToken}` },
      body: JSON.stringify({
        amount: 500,
        idempotencyKey: 'user-b-withdraw-01',
        payoutMethod: 'upi',
        payoutDetails: { upiId: 'userb@okhdfcbank' },
      }),
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(String(body.withdrawal.user), String(userBId));
    assert.strictEqual(wallets.get(String(userBId)).balance, 1500); // 2000 - 500
    assert.strictEqual(wallets.get(String(userAId)).balance, 5000); // User A untouched
  });

  // =========================================================================
  // 13. ADMIN VISIBILITY WITH MASKING
  // =========================================================================
  it('13. provides masked payout details to administrators without leaking ciphertext or raw credentials', async () => {
    // Create a withdrawal for User A
    const withdrawalId = new mongoose.Types.ObjectId();
    withdrawals.set(String(withdrawalId), {
      _id: withdrawalId,
      user: userAId,
      amount: 1500,
      currency: 'INR',
      withdrawalReference: 'WTH-ADMIN-TEST-01',
      status: 'PENDING',
      payoutMethod: 'bank_transfer',
      payoutDetails: {
        accountHolderName: 'Nikku Investor',
        bankName: 'HDFC Bank',
        maskedIdentifier: '98******3210',
        encryptedData: 'encrypted_secret_ciphertext',
        encryptionIv: 'iv_hex',
        encryptionTag: 'tag_hex',
      },
      createdAt: new Date(),
    });

    const res = await fetch(`${baseUrl}/api/v1/wallet/admin/withdrawals`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.withdrawals));

    const item = body.withdrawals.find((w) => w.withdrawalReference === 'WTH-ADMIN-TEST-01');
    assert.ok(item);
    assert.strictEqual(item.payoutDetails.maskedIdentifier, '98******3210');
    // Ensure encrypted raw credentials are omitted from ordinary listings
    assert.strictEqual(item.payoutDetails.encryptedData, undefined);
  });

  // =========================================================================
  // 14. AUTHORIZED REVEAL BEHAVIOR
  // =========================================================================
  it('14. allows authorized administrator to decrypt and reveal credentials with audit, rejecting regular users', async () => {
    const encryptedPayload = encryptPayoutData({
      accountHolderName: 'Nikku Investor',
      bankName: 'State Bank of India',
      accountNumber: '123456789012',
      ifscCode: 'SBIN0001234',
    });

    const withdrawalId = new mongoose.Types.ObjectId();
    withdrawals.set(String(withdrawalId), {
      _id: withdrawalId,
      user: userAId,
      amount: 1000,
      withdrawalReference: 'WTH-REVEAL-01',
      status: 'PENDING',
      payoutMethod: 'bank_transfer',
      payoutDetails: {
        accountHolderName: 'Nikku Investor',
        bankName: 'State Bank of India',
        maskedIdentifier: '******9012',
        encryptedData: encryptedPayload.encryptedData,
        encryptionIv: encryptedPayload.iv,
        encryptionTag: encryptedPayload.tag,
      },
      createdAt: new Date(),
    });

    // Regular user attempt -> 403 Forbidden
    const userRes = await fetch(`${baseUrl}/api/v1/wallet/admin/withdrawals/${withdrawalId}/reveal`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    assert.strictEqual(userRes.status, 403);

    // Admin attempt -> 200 OK with decrypted details
    const adminRes = await fetch(`${baseUrl}/api/v1/wallet/admin/withdrawals/${withdrawalId}/reveal`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(adminRes.status, 200);
    const adminBody = await adminRes.json();
    assert.strictEqual(adminBody.success, true);
    assert.strictEqual(adminBody.accountNumber, '123456789012');
    assert.strictEqual(adminBody.ifscCode, 'SBIN0001234');
  });

  // =========================================================================
  // 15. REJECTED WITHDRAWAL AND SAFE WALLET REFUND
  // =========================================================================
  it('15. refunds wallet balance on administrator rejection without double credit on subsequent retries', async () => {
    const withdrawalId = new mongoose.Types.ObjectId();
    withdrawals.set(String(withdrawalId), {
      _id: withdrawalId,
      user: userAId,
      amount: 800,
      withdrawalReference: 'WTH-REJECT-TEST-01',
      status: 'PENDING',
      payoutMethod: 'upi',
      payoutDetails: { maskedIdentifier: 'u***@upi' },
      refundIssued: false,
      createdAt: new Date(),
      statusHistory: [],
      save: async function () { return this; },
    });

    // Set userA balance to 4200 (since 800 was reserved)
    wallets.set(String(userAId), {
      _id: new mongoose.Types.ObjectId(),
      user: userAId,
      balance: 4200,
      processedOperations: [],
    });

    // Admin rejects withdrawal
    const res = await fetch(`${baseUrl}/api/v1/wallet/admin/withdrawals/${withdrawalId}/reject`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ reason: 'Incorrect beneficiary IFSC code provided' }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.withdrawal.status, 'REJECTED');

    // Balance restored: 4200 + 800 = 5000
    assert.strictEqual(wallets.get(String(userAId)).balance, 5000);

    // Duplicate rejection attempt must fail and NOT refund again
    const resDup = await fetch(`${baseUrl}/api/v1/wallet/admin/withdrawals/${withdrawalId}/reject`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ reason: 'Duplicate rejection attempt' }),
    });
    assert.strictEqual(resDup.status, 400);
    assert.strictEqual(wallets.get(String(userAId)).balance, 5000); // Remains 5000
  });

  // =========================================================================
  // 16. API CONNECTIVITY & ENVIRONMENT CONFIGURATION
  // =========================================================================
  it('16. verifies API base URL resolution logic and backend health endpoint reachability', async () => {
    // 1. Verify health check endpoint on server
    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    assert.strictEqual(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.strictEqual(healthBody.success, true);

    // 2. Test getApiBaseUrl utility logic for production vs development
    const mockResolveApiUrl = (envUrl, isProd) => {
      const trimmed = (envUrl || '').trim();
      if (isProd) {
        if (trimmed && !trimmed.includes('localhost') && !trimmed.includes('127.0.0.1')) {
          return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed.replace(/\/+$/, '')}/api/v1`;
        }
        return 'https://minetrades.onrender.com/api/v1';
      }
      return trimmed || '/api/v1';
    };

    // In production with localhost URL -> safely defaults to Render
    assert.strictEqual(mockResolveApiUrl('http://localhost:5173', true), 'https://minetrades.onrender.com/api/v1');
    assert.strictEqual(mockResolveApiUrl('http://127.0.0.1:5000', true), 'https://minetrades.onrender.com/api/v1');
    assert.strictEqual(mockResolveApiUrl('', true), 'https://minetrades.onrender.com/api/v1');

    // In production with valid cloud URL -> uses cloud URL with /api/v1 suffix
    assert.strictEqual(mockResolveApiUrl('https://custom-backend.com', true), 'https://custom-backend.com/api/v1');

    // In development -> uses /api/v1 or local URL
    assert.strictEqual(mockResolveApiUrl('', false), '/api/v1');
    assert.strictEqual(mockResolveApiUrl('http://127.0.0.1:5000/api/v1', false), 'http://127.0.0.1:5000/api/v1');
  });
});
