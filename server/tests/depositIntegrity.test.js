import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Deposit } from '../src/models/Deposit.js';
import { Wallet } from '../src/models/Wallet.js';
import { Transaction } from '../src/models/Transaction.js';
import { Payment } from '../src/models/Payment.js';
import { UserPlan } from '../src/models/UserPlan.js';
import { Plan } from '../src/models/Plan.js';
import { WebhookEvent } from '../src/models/WebhookEvent.js';
import {
  verifyDeposit,
  processDepositCredit,
  reconcileDepositRecord,
  generateMockDepositSignature,
  verifyMockDepositSignature,
} from '../src/services/walletService.js';
import { handleWebhookEvent } from '../src/services/paymentService.js';
import { verifyWebhookSignature } from '../src/config/razorpay.js';

describe('MAT-16 — Wallet Deposit Integrity, Concurrency & Webhook Tests', () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const otherUserId = new mongoose.Types.ObjectId().toString();
  const walletId = new mongoose.Types.ObjectId();

  let deposits = new Map();
  let wallets = new Map();
  let transactions = [];
  let payments = new Map();
  let userPlans = [];
  let webhookEvents = new Map();

  // Method stubs
  let origDepositFindOne;
  let origDepositFindById;
  let origDepositFindOneAndUpdate;
  let origDepositUpdateOne;
  let origWalletFindOne;
  let origWalletFindOneAndUpdate;
  let origWalletUpdateOne;
  let origTransactionFindOne;
  let origTransactionFind;
  let origTransactionCreate;
  let origPaymentFindOne;
  let origUserPlanFindOne;
  let origUserPlanCreate;
  let origPlanFindById;
  let origWebhookEventCreate;
  let origWebhookEventFindOne;
  let origWebhookEventFindOneAndUpdate;
  let origWebhookEventUpdateOne;

  const testWebhookSecret = 'test_webhook_secret_key_1234567890';

  beforeEach(() => {
    deposits = new Map();
    wallets = new Map();
    transactions = [];
    payments = new Map();
    userPlans = [];
    webhookEvents = new Map();

    process.env.RAZORPAY_WEBHOOK_SECRET = testWebhookSecret;
    process.env.JWT_SECRET = 'test_jwt_secret_minimum_32_characters_here';

    // Initialize user wallet
    wallets.set(userId, {
      _id: walletId,
      user: userId,
      balance: 1000,
      processedOperations: [],
    });

    // Save originals
    origDepositFindOne = Deposit.findOne;
    origDepositFindById = Deposit.findById;
    origDepositFindOneAndUpdate = Deposit.findOneAndUpdate;
    origDepositUpdateOne = Deposit.updateOne;
    origWalletFindOne = Wallet.findOne;
    origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
    origWalletUpdateOne = Wallet.updateOne;
    origTransactionFindOne = Transaction.findOne;
    origTransactionFind = Transaction.find;
    origTransactionCreate = Transaction.create;
    origPaymentFindOne = Payment.findOne;
    origUserPlanFindOne = UserPlan.findOne;
    origUserPlanCreate = UserPlan.create;
    origPlanFindById = Plan.findById;
    origWebhookEventCreate = WebhookEvent.create;
    origWebhookEventFindOne = WebhookEvent.findOne;
    origWebhookEventFindOneAndUpdate = WebhookEvent.findOneAndUpdate;
    origWebhookEventUpdateOne = WebhookEvent.updateOne;

    WebhookEvent.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      const key = `${item.provider || 'razorpay'}:${item.eventId}`;
      if (webhookEvents.has(key)) {
        const dupErr = new Error(`E11000 duplicate key error collection: webhookevents index: provider_1_eventId_1 dup key: { provider: "${item.provider}", eventId: "${item.eventId}" }`);
        dupErr.code = 11000;
        throw dupErr;
      }
      const created = {
        _id: new mongoose.Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...item,
      };
      webhookEvents.set(key, created);
      return created;
    };

    WebhookEvent.findOne = async (query) => {
      const key = `${query.provider || 'razorpay'}:${query.eventId}`;
      return webhookEvents.get(key) || null;
    };

    WebhookEvent.findOneAndUpdate = async (filter, update) => {
      const key = `${filter.provider || 'razorpay'}:${filter.eventId}`;
      const doc = webhookEvents.get(key);
      if (!doc) return null;
      if (filter.status && doc.status !== filter.status) return null;
      if (update.$set) {
        Object.assign(doc, update.$set);
      }
      if (update.$inc?.attempts) {
        doc.attempts = (doc.attempts || 1) + update.$inc.attempts;
      }
      return { ...doc };
    };

    WebhookEvent.updateOne = async (filter, update) => {
      const key = `${filter.provider || 'razorpay'}:${filter.eventId}`;
      const doc = webhookEvents.get(key);
      if (!doc) return { acknowledged: true, modifiedCount: 0 };
      if (update.$set) {
        Object.assign(doc, update.$set);
      }
      return { acknowledged: true, modifiedCount: 1 };
    };

    // Database simulation with atomic CAS guarantees
    Deposit.findOne = async (query) => {
      for (const doc of deposits.values()) {
        if (query.depositReference && doc.depositReference === query.depositReference) {
          return doc;
        }
        if (query.orderId && doc.orderId === query.orderId) {
          return doc;
        }
        if (query._id && String(doc._id) === String(query._id)) {
          return doc;
        }
      }
      return null;
    };

    Deposit.findById = async (id) => {
      return deposits.get(String(id)) || null;
    };

    Deposit.findOneAndUpdate = async (filter, update) => {
      let matchedDoc = null;
      for (const doc of deposits.values()) {
        if (filter._id && String(doc._id) !== String(filter._id)) continue;
        if (filter.status?.$in && !filter.status.$in.includes(doc.status)) continue;
        matchedDoc = doc;
        break;
      }

      if (!matchedDoc) return null;

      if (update.$set) {
        Object.assign(matchedDoc, update.$set);
        if (update.$set.status) matchedDoc.status = update.$set.status;
        if (update.$set.paymentId) matchedDoc.paymentId = update.$set.paymentId;
        if (update.$set.creditedAt) matchedDoc.creditedAt = update.$set.creditedAt;
        if (update.$set['metadata.walletCredited'] !== undefined) {
          matchedDoc.metadata = { ...matchedDoc.metadata, walletCredited: update.$set['metadata.walletCredited'] };
        }
        if (update.$set['metadata.ledgerCreated'] !== undefined) {
          matchedDoc.metadata = { ...matchedDoc.metadata, ledgerCreated: update.$set['metadata.ledgerCreated'] };
        }
      }
      return matchedDoc;
    };

    Deposit.updateOne = async (filter, update) => {
      const doc = await Deposit.findOne(filter);
      if (!doc) return { acknowledged: true, modifiedCount: 0 };
      if (update.$set) {
        for (const [k, v] of Object.entries(update.$set)) {
          if (k.startsWith('metadata.')) {
            doc.metadata = { ...(doc.metadata || {}), [k.slice(9)]: v };
          } else {
            doc[k] = v;
          }
        }
      }
      return { acknowledged: true, modifiedCount: 1 };
    };

    Wallet.findOne = async (query) => {
      const uId = query.user ? String(query.user) : null;
      return wallets.get(uId) || null;
    };

    Wallet.findOneAndUpdate = async (filter, update) => {
      const uId = filter.user ? String(filter.user) : null;
      const wallet = wallets.get(uId);
      if (!wallet) return null;

      // Atomic CAS filter on processedOperations
      if (filter.processedOperations?.$ne) {
        const op = filter.processedOperations.$ne;
        if (wallet.processedOperations && wallet.processedOperations.includes(op)) {
          return null; // Atomic duplicate rejection
        }
      }

      if (update.$inc?.balance) {
        wallet.balance = Math.round((wallet.balance + update.$inc.balance) * 100) / 100;
      }
      if (update.$addToSet?.processedOperations) {
        wallet.processedOperations = wallet.processedOperations || [];
        if (!wallet.processedOperations.includes(update.$addToSet.processedOperations)) {
          wallet.processedOperations.push(update.$addToSet.processedOperations);
        }
      }
      return { ...wallet };
    };

    Wallet.updateOne = async (filter, update) => {
      const uId = filter.user ? String(filter.user) : null;
      const wallet = wallets.get(uId);
      if (!wallet) return { acknowledged: true, modifiedCount: 0 };
      if (update.$addToSet?.processedOperations) {
        wallet.processedOperations = wallet.processedOperations || [];
        if (!wallet.processedOperations.includes(update.$addToSet.processedOperations)) {
          wallet.processedOperations.push(update.$addToSet.processedOperations);
        }
      }
      return { acknowledged: true, modifiedCount: 1 };
    };

    Transaction.findOne = (query = {}) => {
      let filtered = [...transactions];
      if (query.reference && typeof query.reference === 'string') {
        filtered = filtered.filter((t) => t.reference === query.reference);
      } else if (query.reference?.$ne) {
        filtered = filtered.filter((t) => t.reference !== query.reference.$ne);
      }
      if (query.wallet) {
        filtered = filtered.filter((t) => String(t.wallet) === String(query.wallet));
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
      return {
        sort: (sortObj = {}) => {
          let sorted = [...filtered];
          if (sortObj.createdAt === 1) {
            sorted.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
          } else if (sortObj.createdAt === -1) {
            sorted.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
          }
          return Promise.resolve(sorted);
        },
        then: (resolve) => resolve(filtered),
      };
    };

    Transaction.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      // Enforce unique sparse index on reference
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
      return created;
    };

    Payment.findOne = (query) => {
      let found = null;
      for (const p of payments.values()) {
        if (query.orderId && p.orderId === query.orderId) {
          found = {
            ...p,
            save: async function () {
              payments.set(p.orderId, this);
              return this;
            },
          };
          break;
        }
      }
      return {
        populate: () => Promise.resolve(found),
        then: (resolve, reject) => Promise.resolve(found).then(resolve, reject),
      };
    };

    UserPlan.findOne = async (query) => {
      for (const up of userPlans) {
        if (query.idempotencyKey && up.idempotencyKey === query.idempotencyKey) {
          return up;
        }
      }
      return null;
    };

    UserPlan.create = async (doc) => {
      const up = { _id: new mongoose.Types.ObjectId(), ...doc };
      userPlans.push(up);
      return up;
    };

    Plan.findById = async () => ({
      _id: new mongoose.Types.ObjectId(),
      name: 'Starter Plan',
      price: 500,
      durationDays: 30,
      dailyRoiRate: 1.5,
      hashRate: 100,
      features: ['24/7 Monitoring'],
    });
  });

  afterEach(() => {
    Deposit.findOne = origDepositFindOne;
    Deposit.findById = origDepositFindById;
    Deposit.findOneAndUpdate = origDepositFindOneAndUpdate;
    Deposit.updateOne = origDepositUpdateOne;
    Wallet.findOne = origWalletFindOne;
    Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
    Wallet.updateOne = origWalletUpdateOne;
    Transaction.findOne = origTransactionFindOne;
    Transaction.find = origTransactionFind;
    Transaction.create = origTransactionCreate;
    Payment.findOne = origPaymentFindOne;
    UserPlan.findOne = origUserPlanFindOne;
    UserPlan.create = origUserPlanCreate;
    Plan.findById = origPlanFindById;
    WebhookEvent.create = origWebhookEventCreate;
    WebhookEvent.findOne = origWebhookEventFindOne;
    WebhookEvent.findOneAndUpdate = origWebhookEventFindOneAndUpdate;
    WebhookEvent.updateOne = origWebhookEventUpdateOne;
  });

  // Helper to create a valid deposit
  const createMockDepositDoc = (opts = {}) => {
    const depositId = new mongoose.Types.ObjectId();
    const depositReference = opts.depositReference || `DEP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const orderId = opts.orderId || `mock_ord_${Date.now()}`;
    const amount = opts.amount || 500;
    const provider = opts.provider || 'mock';

    const doc = {
      _id: depositId,
      user: new mongoose.Types.ObjectId(opts.userId || userId),
      wallet: walletId,
      amount,
      currency: opts.currency || 'INR',
      depositReference,
      provider,
      orderId,
      status: opts.status || 'created',
      metadata: opts.metadata || {},
      save: async function () {
        deposits.set(String(this._id), this);
        return this;
      },
    };
    deposits.set(String(depositId), doc);
    return doc;
  };

  // Helper to generate webhook HMAC-SHA256 signature
  const signWebhookPayload = (rawBody, secret = testWebhookSecret) => {
    return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  };

  describe('1. Concurrency & Single-Winner Claim Protection', () => {
    it('prevents double-credit on two simultaneous user verification requests', async () => {
      const deposit = createMockDepositDoc({ amount: 500 });
      const signature = generateMockDepositSignature(deposit.depositReference, deposit.orderId);

      // Launch two concurrent verification calls for the identical deposit
      const [res1, res2] = await Promise.all([
        verifyDeposit(userId, {
          depositReference: deposit.depositReference,
          orderId: deposit.orderId,
          signature,
        }),
        verifyDeposit(userId, {
          depositReference: deposit.depositReference,
          orderId: deposit.orderId,
          signature,
        }),
      ]);

      // Exactly one was the new verifier, the other received idempotent success
      const newVerifications = [res1, res2].filter((r) => r.isAlreadyVerified === false);
      const idempotentVerifications = [res1, res2].filter((r) => r.isAlreadyVerified === true);

      assert.strictEqual(newVerifications.length, 1);
      assert.strictEqual(idempotentVerifications.length, 1);

      // Verify wallet was credited exactly once (1000 + 500 = 1500, never 2000)
      const wallet = wallets.get(userId);
      assert.strictEqual(wallet.balance, 1500);

      // Verify exactly one ledger transaction was recorded
      const txs = transactions.filter((t) => t.reference === deposit.depositReference);
      assert.strictEqual(txs.length, 1);
      assert.strictEqual(txs[0].amount, 500);
      assert.strictEqual(txs[0].type, 'credit');
      assert.strictEqual(txs[0].balanceBefore, 1000);
      assert.strictEqual(txs[0].balanceAfter, 1500);
    });

    it('repeated verification after successful credit returns idempotent response without second credit', async () => {
      const deposit = createMockDepositDoc({ amount: 300 });
      const signature = generateMockDepositSignature(deposit.depositReference, deposit.orderId);

      // First verification
      const res1 = await verifyDeposit(userId, {
        depositReference: deposit.depositReference,
        orderId: deposit.orderId,
        signature,
      });
      assert.strictEqual(res1.success, true);
      assert.strictEqual(res1.isAlreadyVerified, false);
      assert.strictEqual(res1.wallet.balance, 1300);
      assert.strictEqual(res1.deposit.metadata?.walletCredited, true);
      assert.strictEqual(res1.deposit.metadata?.ledgerCreated, true);

      // Repeated verification
      const res2 = await verifyDeposit(userId, {
        depositReference: deposit.depositReference,
        orderId: deposit.orderId,
        signature,
      });
      assert.strictEqual(res2.success, true);
      assert.strictEqual(res2.isAlreadyVerified, true);
      assert.strictEqual(res2.wallet.balance, 1300);
      assert.strictEqual(res2.deposit.metadata?.walletCredited, true);
      assert.strictEqual(res2.deposit.metadata?.ledgerCreated, true);

      // Balance remains strictly 1300
      assert.strictEqual(wallets.get(userId).balance, 1300);
      assert.strictEqual(transactions.filter((t) => t.reference === deposit.depositReference).length, 1);
    });

    it('rejects verification if deposit belongs to a different authenticated user', async () => {
      const deposit = createMockDepositDoc({ amount: 500, userId: otherUserId });
      const signature = generateMockDepositSignature(deposit.depositReference, deposit.orderId);

      await assert.rejects(
        async () => {
          await verifyDeposit(userId, {
            depositReference: deposit.depositReference,
            orderId: deposit.orderId,
            signature,
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 403);
          assert.match(err.message, /Forbidden/);
          return true;
        }
      );

      // Ensure no balance change
      assert.strictEqual(wallets.get(userId).balance, 1000);
    });
  });

  describe('2. Provider Webhook Handling & Isolation', () => {
    it('successfully processes wallet-deposit webhook event and credits wallet exactly once', async () => {
      const orderId = 'order_rzp_dep_101';
      const deposit = createMockDepositDoc({
        amount: 250,
        orderId,
        provider: 'razorpay',
      });

      const eventPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_rzp_dep_001',
              order_id: orderId,
              amount: 25000, // 250 INR in paise
              currency: 'INR',
              notes: {
                userId,
                type: 'wallet_deposit',
              },
            },
          },
        },
      };

      const rawBody = JSON.stringify(eventPayload);
      const signature = signWebhookPayload(rawBody);

      const result = await handleWebhookEvent(rawBody, signature, eventPayload);

      assert.strictEqual(result.status, 'processed');
      assert.strictEqual(result.type, 'wallet_deposit');
      assert.strictEqual(result.depositReference, deposit.depositReference);

      // Wallet incremented by 250
      assert.strictEqual(wallets.get(userId).balance, 1250);

      // Exactly one ledger transaction
      const txs = transactions.filter((t) => t.reference === deposit.depositReference);
      assert.strictEqual(txs.length, 1);
      assert.strictEqual(txs[0].amount, 250);
      assert.strictEqual(txs[0].type, 'credit');
    });

    it('handles duplicate webhook delivery idempotently without double-crediting', async () => {
      const orderId = 'order_rzp_dep_dup_102';
      const deposit = createMockDepositDoc({
        amount: 400,
        orderId,
        provider: 'razorpay',
      });

      const eventPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_rzp_dep_dup_002',
              order_id: orderId,
              amount: 40000,
              currency: 'INR',
            },
          },
        },
      };

      const rawBody = JSON.stringify(eventPayload);
      const signature = signWebhookPayload(rawBody);

      // First delivery
      const res1 = await handleWebhookEvent(rawBody, signature, eventPayload);
      assert.strictEqual(res1.status, 'processed');
      assert.strictEqual(wallets.get(userId).balance, 1400);

      // Second delivery (duplicate retry)
      const res2 = await handleWebhookEvent(rawBody, signature, eventPayload);
      assert.strictEqual(res2.status, 'already_processed');

      // Balance remains strictly 1400
      assert.strictEqual(wallets.get(userId).balance, 1400);
      assert.strictEqual(transactions.filter((t) => t.reference === deposit.depositReference).length, 1);
    });

    it('resolves concurrent race between user-verification and gateway webhook to exactly one credit', async () => {
      const orderId = 'order_rzp_race_103';
      const deposit = createMockDepositDoc({
        amount: 600,
        orderId,
        provider: 'mock',
      });

      const userSig = generateMockDepositSignature(deposit.depositReference, orderId);

      const webhookPayload = {
        event: 'order.paid',
        payload: {
          payment: {
            entity: {
              id: 'pay_rzp_race_003',
              order_id: orderId,
              amount: 60000,
              currency: 'INR',
            },
          },
        },
      };
      const rawBody = JSON.stringify(webhookPayload);
      const webhookSig = signWebhookPayload(rawBody);

      // Fire user verification and webhook concurrently
      const [userRes, webhookRes] = await Promise.all([
        verifyDeposit(userId, {
          depositReference: deposit.depositReference,
          orderId,
          signature: userSig,
        }),
        handleWebhookEvent(rawBody, webhookSig, webhookPayload),
      ]);

      // One is newly processed, the other is already_processed / isAlreadyVerified
      const userProcessed = !userRes.isAlreadyVerified;
      const webhookProcessed = webhookRes.status === 'processed';

      assert.strictEqual(userProcessed || webhookProcessed, true);
      assert.strictEqual(userProcessed && webhookProcessed, false); // Exactly one winner!

      // Total balance 1000 + 600 = 1600 (NEVER 2200)
      assert.strictEqual(wallets.get(userId).balance, 1600);
      assert.strictEqual(transactions.filter((t) => t.reference === deposit.depositReference).length, 1);
    });

    it('rejects invalid or tampered webhook signatures with 400', async () => {
      const eventPayload = { event: 'payment.captured', payload: {} };
      const rawBody = JSON.stringify(eventPayload);
      const forgedSig = 'forged_invalid_signature_hex_deadbeef';

      await assert.rejects(
        async () => {
          await handleWebhookEvent(rawBody, forgedSig, eventPayload);
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.match(err.message, /Invalid webhook signature/);
          return true;
        }
      );
    });

    it('rejects webhook event with mismatched amount and marks deposit failed', async () => {
      const orderId = 'order_mismatch_amt_104';
      const deposit = createMockDepositDoc({
        amount: 1000, // 1000 INR = 100,000 paise
        orderId,
      });

      const eventPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_tampered_004',
              order_id: orderId,
              amount: 50000, // Tampered: 500 INR in paise instead of 1000
              currency: 'INR',
            },
          },
        },
      };

      const rawBody = JSON.stringify(eventPayload);
      const signature = signWebhookPayload(rawBody);

      const result = await handleWebhookEvent(rawBody, signature, eventPayload);
      assert.strictEqual(result.status, 'rejected');
      assert.match(result.reason, /Amount mismatch/);

      // Verify deposit was marked failed
      const updatedDeposit = deposits.get(String(deposit._id));
      assert.strictEqual(updatedDeposit.status, 'failed');

      // Verify wallet was NOT credited
      assert.strictEqual(wallets.get(userId).balance, 1000);
    });

    it('rejects webhook event with mismatched currency and marks deposit failed', async () => {
      const orderId = 'order_mismatch_curr_105';
      const deposit = createMockDepositDoc({
        amount: 500,
        currency: 'INR',
        orderId,
      });

      const eventPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_usd_005',
              order_id: orderId,
              amount: 50000,
              currency: 'USD', // Mismatched currency
            },
          },
        },
      };

      const rawBody = JSON.stringify(eventPayload);
      const signature = signWebhookPayload(rawBody);

      const result = await handleWebhookEvent(rawBody, signature, eventPayload);
      assert.strictEqual(result.status, 'rejected');
      assert.match(result.reason, /Currency mismatch/);

      const updatedDeposit = deposits.get(String(deposit._id));
      assert.strictEqual(updatedDeposit.status, 'failed');
      assert.strictEqual(wallets.get(userId).balance, 1000);
    });

    it('rejects webhook event with mismatched user association in notes and marks deposit failed', async () => {
      const orderId = 'order_mismatch_user_106';
      const deposit = createMockDepositDoc({
        amount: 500,
        orderId,
        userId,
      });

      const eventPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_wrong_user_006',
              order_id: orderId,
              amount: 50000,
              currency: 'INR',
              notes: {
                userId: otherUserId, // Wrong user in gateway metadata
              },
            },
          },
        },
      };

      const rawBody = JSON.stringify(eventPayload);
      const signature = signWebhookPayload(rawBody);

      const result = await handleWebhookEvent(rawBody, signature, eventPayload);
      assert.strictEqual(result.status, 'rejected');
      assert.match(result.reason, /User mismatch/);

      const updatedDeposit = deposits.get(String(deposit._id));
      assert.strictEqual(updatedDeposit.status, 'failed');
      assert.strictEqual(wallets.get(userId).balance, 1000);
    });
  });

  describe('3. Strict Separation of Plan Purchases and Wallet Deposits', () => {
    it('a plan-purchase event activates UserPlan and NEVER credits the wallet', async () => {
      const orderId = 'order_plan_purchase_201';
      const planId = new mongoose.Types.ObjectId();

      payments.set(orderId, {
        _id: new mongoose.Types.ObjectId(),
        orderId,
        user: userId,
        plan: planId,
        amount: 500,
        amountInPaise: 50000,
        currency: 'INR',
        status: 'created',
      });

      const eventPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_plan_001',
              order_id: orderId,
              amount: 50000,
              currency: 'INR',
            },
          },
        },
      };

      const rawBody = JSON.stringify(eventPayload);
      const signature = signWebhookPayload(rawBody);

      const result = await handleWebhookEvent(rawBody, signature, eventPayload);
      assert.strictEqual(result.status, 'processed');
      assert.strictEqual(result.type, 'plan_purchase');

      // UserPlan activated
      assert.strictEqual(userPlans.length, 1);
      assert.strictEqual(userPlans[0].idempotencyKey, `pay_${orderId}`);

      // Wallet balance must NOT be credited!
      assert.strictEqual(wallets.get(userId).balance, 1000);

      // Ledger must NOT contain any wallet credit transaction!
      assert.strictEqual(transactions.length, 0);
    });

    it('a wallet-deposit event credits the wallet and NEVER activates a plan', async () => {
      const orderId = 'order_wallet_dep_202';
      createMockDepositDoc({
        amount: 700,
        orderId,
      });

      const eventPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_wallet_002',
              order_id: orderId,
              amount: 70000,
              currency: 'INR',
            },
          },
        },
      };

      const rawBody = JSON.stringify(eventPayload);
      const signature = signWebhookPayload(rawBody);

      const result = await handleWebhookEvent(rawBody, signature, eventPayload);
      assert.strictEqual(result.status, 'processed');
      assert.strictEqual(result.type, 'wallet_deposit');

      // UserPlan must NOT be created!
      assert.strictEqual(userPlans.length, 0);

      // Wallet MUST be credited
      assert.strictEqual(wallets.get(userId).balance, 1700);
      assert.strictEqual(transactions.length, 1);
    });
  });

  describe('4. Failure Recovery & Reconciliation', () => {
    it('reconciles interrupted deposit where wallet was credited but Transaction creation crashed', async () => {
      // Simulate crash: Deposit is completed, wallet was credited (+500), but Transaction was not created
      const depRef = 'DEP-RECONCILE-MISSING-TX';
      const deposit = createMockDepositDoc({
        depositReference: depRef,
        amount: 500,
        status: 'completed',
        metadata: {
          walletCredited: true,
          ledgerCreated: false,
        },
      });

      // Wallet already has credited balance (1500)
      wallets.get(userId).balance = 1500;

      // Ensure no transaction exists yet
      assert.strictEqual(transactions.filter((t) => t.reference === depRef).length, 0);

      // Run reconciliation
      const result = await reconcileDepositRecord(depRef);
      assert.strictEqual(result.status, 'recovered');
      assert.match(result.message, /reconstructed without duplicate credit/);

      // Ledger entry is reconstructed with correct balance snapshots
      const tx = transactions.find((t) => t.reference === depRef);
      assert.ok(tx);
      assert.strictEqual(tx.type, 'credit');
      assert.strictEqual(tx.amount, 500);
      assert.strictEqual(tx.balanceAfter, 1500);
      assert.strictEqual(tx.balanceBefore, 1000);

      // Wallet balance must NEVER be credited a second time!
      assert.strictEqual(wallets.get(userId).balance, 1500);

      // Subsequent reconciliation reports consistent state
      const recheck = await reconcileDepositRecord(depRef);
      assert.strictEqual(recheck.status, 'consistent');
      assert.strictEqual(transactions.filter((t) => t.reference === depRef).length, 1);
    });

    it('reconciles pending deposit where crash happened before wallet credit', async () => {
      const depRef = 'DEP-RECONCILE-PENDING';
      const deposit = createMockDepositDoc({
        depositReference: depRef,
        amount: 350,
        status: 'pending',
        metadata: {
          walletCredited: false,
          ledgerCreated: false,
        },
      });

      assert.strictEqual(wallets.get(userId).balance, 1000);

      const result = await reconcileDepositRecord(depRef);
      assert.strictEqual(result.status, 'recovered');

      // Balance credited safely once
      assert.strictEqual(wallets.get(userId).balance, 1350);

      // Ledger entry created
      const tx = transactions.find((t) => t.reference === depRef);
      assert.ok(tx);
      assert.strictEqual(tx.amount, 350);
      assert.strictEqual(tx.balanceAfter, 1350);

      // Deposit marked completed
      const updatedDeposit = deposits.get(String(deposit._id));
      assert.strictEqual(updatedDeposit.status, 'completed');
    });

    it('returns unmodified for failed deposits', async () => {
      const depRef = 'DEP-FAILED-NO-RECONCILE';
      createMockDepositDoc({
        depositReference: depRef,
        amount: 500,
        status: 'failed',
      });

      const result = await reconcileDepositRecord(depRef);
      assert.strictEqual(result.status, 'unmodified');
      assert.strictEqual(wallets.get(userId).balance, 1000);
      assert.strictEqual(transactions.length, 0);
    });

    it('concurrent processDepositCredit requests for the same deposit credit wallet exactly once', async () => {
      const deposit = createMockDepositDoc({ amount: 500, status: 'pending' });

      // Run two concurrent processDepositCredit requests for the same deposit
      const [res1, res2] = await Promise.all([
        processDepositCredit({ deposit }),
        processDepositCredit({ deposit }),
      ]);

      // Exactly one was the new verifier/credit, the other received idempotent success
      const newCredits = [res1, res2].filter((r) => r.isAlreadyVerified === false);
      const idempotentReturns = [res1, res2].filter((r) => r.isAlreadyVerified === true);

      assert.strictEqual(newCredits.length, 1);
      assert.strictEqual(idempotentReturns.length, 1);

      // Wallet balance was credited exactly once (1000 + 500 = 1500, never 2000)
      const wallet = wallets.get(userId);
      assert.strictEqual(wallet.balance, 1500);
      assert.ok(wallet.processedOperations.includes(deposit.depositReference));

      // Exactly one ledger transaction was created
      const txs = transactions.filter((t) => t.reference === deposit.depositReference);
      assert.strictEqual(txs.length, 1);
      assert.strictEqual(txs[0].amount, 500);
      assert.strictEqual(txs[0].balanceBefore, 1000);
      assert.strictEqual(txs[0].balanceAfter, 1500);
    });

    it('crash between wallet mutation and metadata checkpoint is recovered safely by reconciliation without double credit', async () => {
      const depRef = 'DEP-CRASH-WALLET-MUTATED-NO-CHECKPOINT';
      const deposit = createMockDepositDoc({
        depositReference: depRef,
        amount: 400,
        status: 'pending', // Metadata checkpoint was NOT saved before crash
        metadata: {
          walletCredited: false, // Flag is false because crash happened before checkpoint
          ledgerCreated: false,
        },
      });

      // Wallet was already atomically credited and depositReference claimed in processedOperations
      const wallet = wallets.get(userId);
      wallet.balance = 1400; // 1000 + 400
      wallet.processedOperations = [depRef];

      // Verify no ledger record exists yet
      assert.strictEqual(transactions.filter((t) => t.reference === depRef).length, 0);

      // Reconciler runs after restart
      const result = await reconcileDepositRecord(depRef);
      assert.strictEqual(result.status, 'recovered');

      // Balance remains 1400 (NOT double-credited to 1800)
      assert.strictEqual(wallets.get(userId).balance, 1400);

      // Ledger record created with exact continuous balance
      const tx = transactions.find((t) => t.reference === depRef);
      assert.ok(tx);
      assert.strictEqual(tx.amount, 400);
      assert.strictEqual(tx.balanceBefore, 1000);
      assert.strictEqual(tx.balanceAfter, 1400);

      // Deposit document marked completed with checkpoints
      const updatedDeposit = deposits.get(String(deposit._id));
      assert.strictEqual(updatedDeposit.status, 'completed');
      assert.strictEqual(updatedDeposit.metadata.walletCredited, true);
      assert.strictEqual(updatedDeposit.metadata.ledgerCreated, true);
    });

    it('duplicate reconciliation after deposit is already credited returns consistent without duplicate credit or ledger entry', async () => {
      const depRef = 'DEP-DUPLICATE-RECONCILE';
      const deposit = createMockDepositDoc({
        depositReference: depRef,
        amount: 250,
        status: 'completed',
        metadata: {
          walletCredited: true,
          ledgerCreated: true,
        },
      });

      // Initial state: already credited and ledger recorded
      wallets.get(userId).balance = 1250;
      wallets.get(userId).processedOperations = [depRef];
      transactions.push({
        _id: new mongoose.Types.ObjectId(),
        wallet: walletId,
        user: userId,
        type: 'credit',
        amount: 250,
        reference: depRef,
        balanceBefore: 1000,
        balanceAfter: 1250,
        createdAt: new Date(),
      });

      // First reconciliation call
      const res1 = await reconcileDepositRecord(depRef);
      assert.strictEqual(res1.status, 'consistent');

      // Second reconciliation call (duplicate retry)
      const res2 = await reconcileDepositRecord(depRef);
      assert.strictEqual(res2.status, 'consistent');

      // Balance remains strictly 1250 and exactly 1 ledger record exists
      assert.strictEqual(wallets.get(userId).balance, 1250);
      assert.strictEqual(transactions.filter((t) => t.reference === depRef).length, 1);
    });

    it('intervening wallet transactions that make historical balances uncertain trigger quarantine instead of guessing', async () => {
      const depRef = 'DEP-INTERVENING-UNCERTAIN';
      const deposit = createMockDepositDoc({
        depositReference: depRef,
        amount: 500,
        status: 'pending',
        metadata: {
          walletCredited: false, // Snapshot not saved before crash
          ledgerCreated: false,
        },
      });

      // Prior transaction existed in ledger:
      transactions.push({
        _id: new mongoose.Types.ObjectId(),
        wallet: walletId,
        user: userId,
        type: 'credit',
        amount: 1000,
        reference: 'DEP-INITIAL-SEED',
        balanceBefore: 0,
        balanceAfter: 1000,
        createdAt: new Date(Date.now() - 60000),
      });

      // Deposit was credited (+500 -> 1500)
      const wallet = wallets.get(userId);
      wallet.balance = 1500;
      wallet.processedOperations = [depRef];

      // Later, an intervening transaction occurred before reconciliation ran:
      // e.g. a withdrawal of 300 changed balance to 1200
      wallet.balance = 1200;
      transactions.push({
        _id: new mongoose.Types.ObjectId(),
        wallet: walletId,
        user: userId,
        type: 'debit',
        amount: 300,
        reference: 'WTH-INTERVENING-001',
        balanceBefore: 1500,
        balanceAfter: 1200,
        createdAt: new Date(Date.now() - 30000),
      });

      // Now reconcile runs. The latestTx is WTH-INTERVENING-001 (balanceAfter: 1200).
      // latestTx.balanceAfter + deposit.amount = 1200 + 500 = 1700 != 1200 (wallet.balance).
      // Continuity cannot be proven deterministically, and no checkpoint snapshot exists.
      const result = await reconcileDepositRecord(depRef);

      // Must be quarantined with status: 'uncertain'
      assert.strictEqual(result.status, 'uncertain');
      assert.match(result.message, /Historical ledger balance cannot be safely recovered without fabrication/);

      // Wallet balance must NOT be modified or guessed!
      assert.strictEqual(wallets.get(userId).balance, 1200);

      // No ledger entry created for this uncertain deposit
      assert.strictEqual(transactions.filter((t) => t.reference === depRef).length, 0);

      // Deposit is marked for manual administrative review
      const updatedDeposit = deposits.get(String(deposit._id));
      assert.strictEqual(updatedDeposit.metadata.reconciliationRequiresManualReview, true);
      assert.strictEqual(updatedDeposit.metadata.quarantineAlertDispatched, true);

      // Re-running reconciliation on quarantined deposit safely returns uncertain without modifying wallet
      const retryResult = await reconcileDepositRecord(depRef);
      assert.strictEqual(retryResult.status, 'uncertain');
      assert.strictEqual(wallets.get(userId).balance, 1200);
    });
  });
});
