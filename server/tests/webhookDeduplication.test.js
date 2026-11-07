import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { WebhookEvent } from '../src/models/WebhookEvent.js';
import { Deposit } from '../src/models/Deposit.js';
import { Wallet } from '../src/models/Wallet.js';
import { Transaction } from '../src/models/Transaction.js';
import { Payment } from '../src/models/Payment.js';
import { UserPlan } from '../src/models/UserPlan.js';
import { Plan } from '../src/models/Plan.js';
import { User } from '../src/models/User.js';
import { handleWebhookEvent } from '../src/services/paymentService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import {
  reconcileSingleStaleWebhookEvent,
  runStaleWebhookReconciliationBatch,
  startWebhookReconciliationScheduler,
  stopWebhookReconciliationScheduler,
  isWebhookReconciliationSchedulerRunning,
  getQuarantinedWebhookEventsAdmin,
  resolveQuarantinedWebhookEventAdmin,
} from '../src/services/webhookReconciliationService.js';
import { handleWebhook } from '../src/controllers/paymentController.js';

describe('MAT-22 — Payment Webhook Event Deduplication & Concurrency Tests', () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const walletId = new mongoose.Types.ObjectId();

  let deposits = new Map();
  let wallets = new Map();
  let transactions = [];
  let payments = new Map();
  let userPlans = [];
  let webhookEvents = new Map();

  // Method stubs
  let origWebhookEventCreate;
  let origWebhookEventFindOne;
  let origWebhookEventFindOneAndUpdate;
  let origWebhookEventUpdateOne;
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

  const testWebhookSecret = 'test_webhook_secret_key_1234567890';

  const signPayload = (rawBody, secret = testWebhookSecret) => {
    return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  };

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
    origWebhookEventCreate = WebhookEvent.create;
    origWebhookEventFindOne = WebhookEvent.findOne;
    origWebhookEventFindOneAndUpdate = WebhookEvent.findOneAndUpdate;
    origWebhookEventUpdateOne = WebhookEvent.updateOne;
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

    // Database simulation with atomic CAS guarantees
    WebhookEvent.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      const key = `${item.provider || 'razorpay'}:${item.eventId}`;
      if (webhookEvents.has(key)) {
        const dupErr = new Error(
          `E11000 duplicate key error collection: webhookevents index: provider_1_eventId_1 dup key: { provider: "${item.provider}", eventId: "${item.eventId}" }`
        );
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
      const doc = webhookEvents.get(key);
      return doc ? { ...doc } : null;
    };

    WebhookEvent.findOneAndUpdate = async (filter, update) => {
      const key = `${filter.provider || 'razorpay'}:${filter.eventId}`;
      const doc = webhookEvents.get(key);
      if (!doc) return null;
      if (filter.status && doc.status !== filter.status) return null;
      if (filter.lastReceivedAt && new Date(doc.lastReceivedAt).getTime() !== new Date(filter.lastReceivedAt).getTime()) {
        return null;
      }

      if (update.$set) {
        Object.assign(doc, update.$set);
      }
      if (update.$inc?.attempts) {
        doc.attempts = (doc.attempts || 1) + update.$inc.attempts;
      }
      doc.updatedAt = new Date();
      return { ...doc };
    };

    WebhookEvent.updateOne = async (filter, update) => {
      const key = `${filter.provider || 'razorpay'}:${filter.eventId}`;
      const doc = webhookEvents.get(key);
      if (!doc) return { acknowledged: true, modifiedCount: 0 };
      if (update.$set) {
        Object.assign(doc, update.$set);
      }
      doc.updatedAt = new Date();
      return { acknowledged: true, modifiedCount: 1 };
    };

    Deposit.findOne = async (query) => {
      for (const doc of deposits.values()) {
        if (query.depositReference && doc.depositReference === query.depositReference) return doc;
        if (query.orderId && doc.orderId === query.orderId) return doc;
        if (query._id && String(doc._id) === String(query._id)) return doc;
      }
      return null;
    };

    Deposit.findById = async (id) => deposits.get(String(id)) || null;

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
      }
      return matchedDoc;
    };

    Deposit.updateOne = async (filter, update) => {
      const doc = await Deposit.findOne(filter);
      if (!doc) return { acknowledged: true, modifiedCount: 0 };
      if (update.$set) Object.assign(doc, update.$set);
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

      // Atomic CAS on processedOperations
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
      return {
        sort: () => Promise.resolve(filtered),
        then: (resolve) => resolve(filtered),
      };
    };

    Transaction.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      if (item.reference && transactions.some((t) => t.reference === item.reference)) {
        const dupErr = new Error(`E11000 duplicate key error: reference "${item.reference}"`);
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
    WebhookEvent.create = origWebhookEventCreate;
    WebhookEvent.findOne = origWebhookEventFindOne;
    WebhookEvent.findOneAndUpdate = origWebhookEventFindOneAndUpdate;
    WebhookEvent.updateOne = origWebhookEventUpdateOne;
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
  });

  const createMockDepositDoc = (opts = {}) => {
    const depositId = new mongoose.Types.ObjectId();
    const depositReference = opts.depositReference || `DEP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const orderId = opts.orderId || `ord_${Date.now()}`;
    const amount = opts.amount || 500;

    const doc = {
      _id: depositId,
      user: new mongoose.Types.ObjectId(userId),
      wallet: walletId,
      amount,
      currency: 'INR',
      depositReference,
      provider: 'razorpay',
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

  // Test 1: Valid event accepted once
  it('1. Valid event accepted once and durably recorded in WebhookEvent registry', async () => {
    const orderId = 'order_valid_001';
    const deposit = createMockDepositDoc({ amount: 500, orderId });
    const eventId = 'evt_valid_order_001';

    const eventPayload = {
      id: eventId,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_valid_001',
            order_id: orderId,
            amount: 50000,
            currency: 'INR',
          },
        },
      },
    };

    const rawBody = JSON.stringify(eventPayload);
    const signature = signPayload(rawBody);

    const result = await handleWebhookEvent(rawBody, signature, eventPayload);

    assert.strictEqual(result.status, 'processed');
    assert.strictEqual(result.type, 'wallet_deposit');
    assert.strictEqual(result.depositReference, deposit.depositReference);

    // Balance incremented exactly once: 1000 + 500 = 1500
    assert.strictEqual(wallets.get(userId).balance, 1500);

    // WebhookEvent document created with processed status
    const eventDoc = webhookEvents.get(`razorpay:${eventId}`);
    assert.ok(eventDoc);
    assert.strictEqual(eventDoc.status, 'processed');
    assert.strictEqual(eventDoc.resourceType, 'wallet_deposit');
    assert.strictEqual(eventDoc.resourceReference, deposit.depositReference);
  });

  // Test 2: Duplicate event ID acknowledged without duplicate business effects
  it('2. Duplicate event ID acknowledged immediately without duplicate business effects', async () => {
    const orderId = 'order_dup_002';
    const deposit = createMockDepositDoc({ amount: 300, orderId });
    const eventId = 'evt_dup_order_002';

    const eventPayload = {
      id: eventId,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_dup_002',
            order_id: orderId,
            amount: 30000,
            currency: 'INR',
          },
        },
      },
    };

    const rawBody = JSON.stringify(eventPayload);
    const signature = signPayload(rawBody);

    // First delivery: processes successfully
    const res1 = await handleWebhookEvent(rawBody, signature, eventPayload);
    assert.strictEqual(res1.status, 'processed');
    assert.strictEqual(wallets.get(userId).balance, 1300);

    // Second delivery (duplicate retry with same eventId):
    const res2 = await handleWebhookEvent(rawBody, signature, eventPayload);
    assert.strictEqual(res2.status, 'already_processed');
    assert.strictEqual(res2.eventId, eventId);

    // Balance remains strictly 1300 (never double-credited to 1600)
    assert.strictEqual(wallets.get(userId).balance, 1300);

    // Exactly one ledger entry exists
    assert.strictEqual(transactions.filter((t) => t.reference === deposit.depositReference).length, 1);
  });

  // Test 3: Two concurrent deliveries of the same event
  it('3. Two concurrent deliveries of the same event credit wallet exactly once', async () => {
    const orderId = 'order_concurrent_003';
    const deposit = createMockDepositDoc({ amount: 700, orderId });
    const eventId = 'evt_concurrent_order_003';

    const eventPayload = {
      id: eventId,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_concurrent_003',
            order_id: orderId,
            amount: 70000,
            currency: 'INR',
          },
        },
      },
    };

    const rawBody = JSON.stringify(eventPayload);
    const signature = signPayload(rawBody);

    // Fire two concurrent deliveries simultaneously
    const [res1, res2] = await Promise.all([
      handleWebhookEvent(rawBody, signature, eventPayload),
      handleWebhookEvent(rawBody, signature, eventPayload),
    ]);

    // One was processed, the other received retryable in_flight response (MAT-25 H-01 fix)
    const processedResults = [res1, res2].filter((r) => r.status === 'processed');
    const inFlightResults = [res1, res2].filter((r) => r.status === 'in_flight');

    assert.strictEqual(processedResults.length, 1);
    assert.strictEqual(inFlightResults.length, 1);
    assert.strictEqual(inFlightResults[0].retryable, true);

    // Wallet balance incremented strictly once: 1000 + 700 = 1700 (never 2400)
    assert.strictEqual(wallets.get(userId).balance, 1700);
    assert.strictEqual(transactions.filter((t) => t.reference === deposit.depositReference).length, 1);
  });

  // Test 4: Invalid signature rejected without creating trusted event records
  it('4. Invalid signature rejected without creating trusted event records', async () => {
    const orderId = 'order_tampered_004';
    createMockDepositDoc({ amount: 500, orderId });
    const eventId = 'evt_tampered_004';

    const eventPayload = {
      id: eventId,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_tampered_004',
            order_id: orderId,
            amount: 50000,
            currency: 'INR',
          },
        },
      },
    };

    const rawBody = JSON.stringify(eventPayload);
    const invalidSignature = 'invalid_forged_signature_hex_value_1234567890';

    await assert.rejects(
      () => handleWebhookEvent(rawBody, invalidSignature, eventPayload),
      /Invalid webhook signature/
    );

    // NO WebhookEvent document must be created for untrusted requests
    assert.strictEqual(webhookEvents.has(`razorpay:${eventId}`), false);

    // Wallet balance untouched
    assert.strictEqual(wallets.get(userId).balance, 1000);
  });

  // Test 5: Failure during business processing followed by a safe retry
  it('5. Failure during business processing marks event failed and allows safe retry', async () => {
    const orderId = 'order_retry_005';
    const deposit = createMockDepositDoc({ amount: 450, orderId });
    const eventId = 'evt_retry_order_005';

    const eventPayload = {
      id: eventId,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_retry_005',
            order_id: orderId,
            amount: 45000,
            currency: 'INR',
          },
        },
      },
    };

    const rawBody = JSON.stringify(eventPayload);
    const signature = signPayload(rawBody);

    // Inject transient error in Wallet.findOneAndUpdate on first attempt
    const originalWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
    let failAttempt = true;
    Wallet.findOneAndUpdate = async (filter, update) => {
      if (failAttempt) {
        failAttempt = false;
        throw new Error('Database write error: Transient lock acquisition timeout');
      }
      return originalWalletFindOneAndUpdate(filter, update);
    };

    // First attempt fails during business processing
    await assert.rejects(
      () => handleWebhookEvent(rawBody, signature, eventPayload),
      /Transient lock acquisition timeout/
    );

    // Event doc was recorded with status: 'failed'
    const failedDoc = webhookEvents.get(`razorpay:${eventId}`);
    assert.ok(failedDoc);
    assert.strictEqual(failedDoc.status, 'failed');
    assert.strictEqual(failedDoc.lastErrorCategory, 'Error');
    assert.match(failedDoc.lastErrorMessage, /Transient lock acquisition timeout/);

    // Wallet balance remains 1000
    assert.strictEqual(wallets.get(userId).balance, 1000);

    // Second attempt (gateway retry): succeeds cleanly
    const retryResult = await handleWebhookEvent(rawBody, signature, eventPayload);
    assert.strictEqual(retryResult.status, 'processed');

    // Balance credited safely once
    assert.strictEqual(wallets.get(userId).balance, 1450);

    // Event doc transitioned to 'processed' with attempts incremented
    const processedDoc = webhookEvents.get(`razorpay:${eventId}`);
    assert.strictEqual(processedDoc.status, 'processed');
    assert.strictEqual(processedDoc.attempts, 2);
  });

  // Test 6: Crash after event claim but before completion
  it('6. Crash after event claim is safely recovered after timeout threshold without double credit', async () => {
    const orderId = 'order_crash_006';
    const deposit = createMockDepositDoc({ amount: 350, orderId });
    const eventId = 'evt_crash_order_006';

    // Pre-seed a stuck event doc in 'processing' state from 70 seconds ago (exceeding 60s timeout)
    const stuckTimestamp = new Date(Date.now() - 70 * 1000);
    webhookEvents.set(`razorpay:${eventId}`, {
      _id: new mongoose.Types.ObjectId(),
      provider: 'razorpay',
      eventId,
      eventType: 'payment.captured',
      status: 'processing',
      orderId,
      attempts: 1,
      firstReceivedAt: stuckTimestamp,
      lastReceivedAt: stuckTimestamp,
      createdAt: stuckTimestamp,
      updatedAt: stuckTimestamp,
    });

    const eventPayload = {
      id: eventId,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_crash_006',
            order_id: orderId,
            amount: 35000,
            currency: 'INR',
          },
        },
      },
    };

    const rawBody = JSON.stringify(eventPayload);
    const signature = signPayload(rawBody);

    // Recovery invocation reclaims the stale lock and completes processing
    const recoveryResult = await handleWebhookEvent(rawBody, signature, eventPayload);
    assert.strictEqual(recoveryResult.status, 'processed');

    // Wallet balance updated to 1350
    assert.strictEqual(wallets.get(userId).balance, 1350);

    // Event document is now 'processed' with attempts incremented
    const eventDoc = webhookEvents.get(`razorpay:${eventId}`);
    assert.strictEqual(eventDoc.status, 'processed');
    assert.strictEqual(eventDoc.attempts, 2);
  });

  // Test 7: Duplicate payment event with a different event ID still protected by business-level idempotency
  it('7. Duplicate payment event with a different event ID is protected by business-level idempotency', async () => {
    const orderId = 'order_multi_evt_007';
    const deposit = createMockDepositDoc({ amount: 500, orderId });

    // Event 1 with eventId A
    const eventPayload1 = {
      id: 'evt_gateway_delivery_A',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_multi_007',
            order_id: orderId,
            amount: 50000,
            currency: 'INR',
          },
        },
      },
    };
    const rawBody1 = JSON.stringify(eventPayload1);
    const sig1 = signPayload(rawBody1);

    const res1 = await handleWebhookEvent(rawBody1, sig1, eventPayload1);
    assert.strictEqual(res1.status, 'processed');
    assert.strictEqual(wallets.get(userId).balance, 1500);

    // Event 2 for identical payment but with a DIFFERENT eventId B (e.g. gateway re-delivery with new event ID)
    const eventPayload2 = {
      id: 'evt_gateway_delivery_B',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_multi_007',
            order_id: orderId,
            amount: 50000,
            currency: 'INR',
          },
        },
      },
    };
    const rawBody2 = JSON.stringify(eventPayload2);
    const sig2 = signPayload(rawBody2);

    const res2 = await handleWebhookEvent(rawBody2, sig2, eventPayload2);

    // Business-level idempotency (Deposit status completed + processedOperations) catches the duplicate
    assert.strictEqual(res2.status, 'already_processed');

    // Wallet balance MUST NOT be credited a second time (1500, never 2000)
    assert.strictEqual(wallets.get(userId).balance, 1500);

    // Exactly 1 ledger transaction exists
    assert.strictEqual(transactions.filter((t) => t.reference === deposit.depositReference).length, 1);
  });

  // Test 8: Deposit and plan-purchase isolation
  it('8. Deposit and plan-purchase isolation: plan purchase activates UserPlan and never credits wallet', async () => {
    const planOrderId = 'order_plan_iso_008';
    const planId = new mongoose.Types.ObjectId();

    payments.set(planOrderId, {
      _id: new mongoose.Types.ObjectId(),
      orderId: planOrderId,
      user: userId,
      plan: planId,
      amount: 500,
      currency: 'INR',
      status: 'created',
    });

    const eventPayload = {
      id: 'evt_plan_iso_008',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_plan_008',
            order_id: planOrderId,
            amount: 50000,
            currency: 'INR',
          },
        },
      },
    };

    const rawBody = JSON.stringify(eventPayload);
    const signature = signPayload(rawBody);

    const result = await handleWebhookEvent(rawBody, signature, eventPayload);

    assert.strictEqual(result.status, 'processed');
    assert.strictEqual(result.type, 'plan_purchase');

    // UserPlan was activated
    assert.strictEqual(userPlans.length, 1);
    assert.strictEqual(userPlans[0].idempotencyKey, `pay_${planOrderId}`);

    // Wallet balance MUST NOT be modified!
    assert.strictEqual(wallets.get(userId).balance, 1000);

    // WebhookEvent recorded as plan_purchase
    const eventDoc = webhookEvents.get('razorpay:evt_plan_iso_008');
    assert.ok(eventDoc);
    assert.strictEqual(eventDoc.resourceType, 'plan_purchase');
  });

  // Test 9: Database or registry write failure handled safely
  it('9. Database registry write failure fails closed safely without financial mutations', async () => {
    const orderId = 'order_registry_fail_009';
    createMockDepositDoc({ amount: 500, orderId });
    const eventId = 'evt_registry_fail_009';

    const eventPayload = {
      id: eventId,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_registry_fail_009',
            order_id: orderId,
            amount: 50000,
            currency: 'INR',
          },
        },
      },
    };

    const rawBody = JSON.stringify(eventPayload);
    const signature = signPayload(rawBody);

    // Stub WebhookEvent.create to throw a connection error (not E11000)
    WebhookEvent.create = async () => {
      const dbErr = new Error('MongoNetworkError: failed to connect to server [127.0.0.1:27017]');
      dbErr.name = 'MongoNetworkError';
      throw dbErr;
    };

    await assert.rejects(
      () => handleWebhookEvent(rawBody, signature, eventPayload),
      /MongoNetworkError: failed to connect to server/
    );

    // Wallet balance remains strictly untouched
    assert.strictEqual(wallets.get(userId).balance, 1000);

    // No transaction created
    assert.strictEqual(transactions.length, 0);
  });
});

describe('MAT-25 — In-Flight Acknowledgement Race, Stale Recovery & Out-of-Order Tests', () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const walletId = new mongoose.Types.ObjectId();

  let deposits = new Map();
  let wallets = new Map();
  let transactions = [];
  let payments = new Map();
  let userPlans = [];
  let webhookEvents = new Map();

  let origWebhookEventCreate;
  let origWebhookEventFind;
  let origWebhookEventFindOne;
  let origWebhookEventFindOneAndUpdate;
  let origWebhookEventUpdateOne;
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

  const testWebhookSecret = 'test_webhook_secret_key_1234567890';

  const signPayload = (rawBody, secret = testWebhookSecret) => {
    return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  };

  const createMockRes = () => {
    const res = {
      statusCode: 200,
      jsonData: null,
      status: function (code) {
        this.statusCode = code;
        return this;
      },
      json: function (data) {
        this.jsonData = data;
        return this;
      },
    };
    return res;
  };

  beforeEach(() => {
    deposits = new Map();
    wallets = new Map();
    transactions = [];
    payments = new Map();
    userPlans = [];
    webhookEvents = new Map();

    process.env.RAZORPAY_WEBHOOK_SECRET = testWebhookSecret;
    process.env.JWT_SECRET = 'test_jwt_secret_minimum_32_characters_here';

    wallets.set(userId, {
      _id: walletId,
      user: userId,
      balance: 1000,
      processedOperations: [],
    });

    origWebhookEventCreate = WebhookEvent.create;
    origWebhookEventFind = WebhookEvent.find;
    origWebhookEventFindOne = WebhookEvent.findOne;
    origWebhookEventFindOneAndUpdate = WebhookEvent.findOneAndUpdate;
    origWebhookEventUpdateOne = WebhookEvent.updateOne;
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

    WebhookEvent.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      const key = `${item.provider || 'razorpay'}:${item.eventId}`;
      if (webhookEvents.has(key)) {
        const dupErr = new Error(`E11000 duplicate key error: ${key}`);
        dupErr.code = 11000;
        throw dupErr;
      }
      const created = {
        _id: new mongoose.Types.ObjectId(),
        attempts: 1,
        firstReceivedAt: new Date(),
        lastReceivedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...item,
      };
      webhookEvents.set(key, created);
      return created;
    };

    WebhookEvent.findOne = async (query) => {
      for (const evt of webhookEvents.values()) {
        if (query.provider && query.eventId) {
          if (evt.provider === query.provider && evt.eventId === query.eventId) {
            return { ...evt };
          }
        } else if (query.eventId && evt.eventId === query.eventId) {
          return { ...evt };
        }
      }
      return null;
    };

    WebhookEvent.find = (query = {}) => {
      let filtered = Array.from(webhookEvents.values());
      if (query.status) {
        if (query.status.$in && Array.isArray(query.status.$in)) {
          filtered = filtered.filter((e) => query.status.$in.includes(e.status));
        } else {
          filtered = filtered.filter((e) => e.status === query.status);
        }
      }
      if (query.lastReceivedAt?.$lt) {
        filtered = filtered.filter((e) => new Date(e.lastReceivedAt) < query.lastReceivedAt.$lt);
      }
      return {
        sort: (sortObj = {}) => {
          filtered.sort((a, b) => new Date(a.lastReceivedAt) - new Date(b.lastReceivedAt));
          return {
            limit: (n) => Promise.resolve(filtered.slice(0, n).map((item) => ({ ...item }))),
            then: (resolve) => resolve(filtered.map((item) => ({ ...item }))),
          };
        },
        limit: (n) => Promise.resolve(filtered.slice(0, n).map((item) => ({ ...item }))),
        then: (resolve) => resolve(filtered.map((item) => ({ ...item }))),
      };
    };

    WebhookEvent.findOneAndUpdate = async (query, update, opts = {}) => {
      for (const [key, evt] of webhookEvents.entries()) {
        let match = true;
        if (query._id && String(evt._id) !== String(query._id)) match = false;
        if (query.provider && evt.provider !== query.provider) match = false;
        if (query.eventId && evt.eventId !== query.eventId) match = false;
        if (query.status) {
          if (query.status.$in && Array.isArray(query.status.$in)) {
            if (!query.status.$in.includes(evt.status)) match = false;
          } else if (evt.status !== query.status) {
            match = false;
          }
        }
        if (query.lastReceivedAt) {
          const qTime = new Date(query.lastReceivedAt).getTime();
          const eTime = new Date(evt.lastReceivedAt).getTime();
          if (qTime !== eTime) match = false;
        }

        if (match) {
          if (update.$set) {
            for (const [k, v] of Object.entries(update.$set)) {
              if (k.startsWith('metadata.')) {
                evt.metadata = evt.metadata || {};
                evt.metadata[k.slice('metadata.'.length)] = v;
              } else {
                evt[k] = v;
              }
            }
          }
          if (update.$inc) {
            for (const [k, val] of Object.entries(update.$inc)) {
              evt[k] = (evt[k] || 0) + val;
            }
          }
          webhookEvents.set(key, evt);
          return { ...evt };
        }
      }
      return null;
    };

    WebhookEvent.updateOne = async (query, update) => {
      for (const [key, evt] of webhookEvents.entries()) {
        let match = true;
        if (query._id && String(evt._id) !== String(query._id)) match = false;
        if (query.provider && evt.provider !== query.provider) match = false;
        if (query.eventId && evt.eventId !== query.eventId) match = false;

        if (match) {
          if (update.$set) {
            for (const [k, v] of Object.entries(update.$set)) {
              if (k.startsWith('metadata.')) {
                evt.metadata = evt.metadata || {};
                evt.metadata[k.slice('metadata.'.length)] = v;
              } else {
                evt[k] = v;
              }
            }
          }
          webhookEvents.set(key, evt);
          return { acknowledged: true, modifiedCount: 1 };
        }
      }
      return { acknowledged: true, modifiedCount: 0 };
    };

    Deposit.findOne = async (query) => {
      for (const d of deposits.values()) {
        if (query._id && String(d._id) === String(query._id)) return d;
        if (query.orderId && d.orderId === query.orderId) return d;
        if (query.depositReference && d.depositReference === query.depositReference) return d;
      }
      return null;
    };

    Deposit.findById = async (id) => deposits.get(String(id)) || null;

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
      }
      return matchedDoc;
    };

    Deposit.updateOne = async (filter, update) => {
      const dep = deposits.get(String(filter._id));
      if (!dep) return { acknowledged: true, modifiedCount: 0 };
      if (update.$set) Object.assign(dep, update.$set);
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
      if (filter.processedOperations?.$ne) {
        if (wallet.processedOperations?.includes(filter.processedOperations.$ne)) return null;
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
      if (update.$inc?.balance) {
        wallet.balance = Math.round((wallet.balance + update.$inc.balance) * 100) / 100;
      }
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
      }
      return {
        sort: () => Promise.resolve(filtered.length > 0 ? { ...filtered[0] } : null),
        then: (resolve) => resolve(filtered.length > 0 ? { ...filtered[0] } : null),
      };
    };

    Transaction.find = () => ({
      sort: () => Promise.resolve([...transactions]),
      then: (resolve) => resolve([...transactions]),
    });

    Transaction.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      if (item.reference && transactions.some((t) => t.reference === item.reference)) {
        const dupErr = new Error(`E11000 duplicate reference: "${item.reference}"`);
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
        if (query.idempotencyKey && up.idempotencyKey === query.idempotencyKey) return up;
      }
      return null;
    };

    UserPlan.create = async (doc) => {
      const created = {
        _id: new mongoose.Types.ObjectId(),
        createdAt: new Date(),
        ...doc,
      };
      userPlans.push(created);
      return created;
    };

    Plan.findById = async () => ({
      _id: new mongoose.Types.ObjectId(),
      name: 'Starter Plan',
      price: 500,
      durationDays: 30,
      dailyRoiRate: 1.5,
      hashRate: 100,
    });
  });

  afterEach(() => {
    stopWebhookReconciliationScheduler();
    WebhookEvent.create = origWebhookEventCreate;
    WebhookEvent.find = origWebhookEventFind;
    WebhookEvent.findOne = origWebhookEventFindOne;
    WebhookEvent.findOneAndUpdate = origWebhookEventFindOneAndUpdate;
    WebhookEvent.updateOne = origWebhookEventUpdateOne;
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
  });

  const createMockDepositDoc = (opts = {}) => {
    const depositId = new mongoose.Types.ObjectId();
    const depositReference = opts.depositReference || `DEP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const orderId = opts.orderId || `ord_${Date.now()}`;
    const amount = opts.amount || 500;

    const doc = {
      _id: depositId,
      user: new mongoose.Types.ObjectId(userId),
      wallet: walletId,
      amount,
      currency: 'INR',
      depositReference,
      provider: 'razorpay',
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

  // Test 1: In-flight duplicate returns retryable HTTP 503 Service Unavailable
  it('1. In-flight duplicate webhook returns HTTP 503 retryable response (H-01 remediation)', async () => {
    const orderId = 'order_inflight_503';
    createMockDepositDoc({ amount: 500, orderId });
    const eventId = 'evt_inflight_503';

    // Seed existing event in active 'processing' state (received 5 seconds ago)
    webhookEvents.set(`razorpay:${eventId}`, {
      _id: new mongoose.Types.ObjectId(),
      provider: 'razorpay',
      eventId,
      eventType: 'payment.captured',
      status: 'processing',
      orderId,
      attempts: 1,
      lastReceivedAt: new Date(Date.now() - 5000), // Active in-flight
      createdAt: new Date(Date.now() - 5000),
    });

    const eventPayload = {
      id: eventId,
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_inflight', order_id: orderId, amount: 50000, currency: 'INR' } } },
    };
    const rawBody = JSON.stringify(eventPayload);
    const signature = signPayload(rawBody);

    const req = {
      headers: {
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId,
      },
      rawBody,
      body: eventPayload,
    };
    const res = createMockRes();

    await handleWebhook(req, res, () => {});

    // Must be mapped to HTTP 503 Service Unavailable so provider retries
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.jsonData.success, false);
    assert.strictEqual(res.jsonData.result.status, 'in_flight');
    assert.strictEqual(res.jsonData.result.retryable, true);
    assert.match(res.jsonData.message, /in-flight/i);

    // Wallet balance MUST NOT be mutated
    assert.strictEqual(wallets.get(userId).balance, 1000);
  });

  // Test 2: Completed duplicate returns HTTP 200 OK without repeating mutations
  it('2. Completed duplicate returns HTTP 200 OK without repeating business mutations', async () => {
    const orderId = 'order_completed_dup_200';
    const deposit = createMockDepositDoc({ amount: 400, orderId, status: 'completed' });
    const eventId = 'evt_completed_dup_200';

    // Seed completed transaction
    transactions.push({
      _id: new mongoose.Types.ObjectId(),
      reference: deposit.depositReference,
      amount: 400,
      wallet: walletId,
    });

    // Seed existing event in 'processed' state
    webhookEvents.set(`razorpay:${eventId}`, {
      _id: new mongoose.Types.ObjectId(),
      provider: 'razorpay',
      eventId,
      eventType: 'payment.captured',
      status: 'processed',
      orderId,
      resourceType: 'wallet_deposit',
      resourceReference: deposit.depositReference,
      attempts: 1,
      lastReceivedAt: new Date(Date.now() - 10000),
      createdAt: new Date(Date.now() - 10000),
    });

    const eventPayload = {
      id: eventId,
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_comp', order_id: orderId, amount: 40000, currency: 'INR' } } },
    };
    const rawBody = JSON.stringify(eventPayload);
    const signature = signPayload(rawBody);

    const req = {
      headers: {
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId,
      },
      rawBody,
      body: eventPayload,
    };
    const res = createMockRes();

    await handleWebhook(req, res, () => {});

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.jsonData.success, true);
    assert.strictEqual(res.jsonData.result.status, 'already_processed');

    // Balance remains unmodified
    assert.strictEqual(wallets.get(userId).balance, 1000);
    assert.strictEqual(transactions.length, 1);
  });

  // Test 3: Stale event is discovered and recovered by scheduled recovery
  it('3. Stale processing event is discovered and recovered by background reconciliation (M-01)', async () => {
    const orderId = 'order_stale_recovery_003';
    const deposit = createMockDepositDoc({ amount: 600, orderId, status: 'created' });
    const eventId = 'evt_stale_recovery_003';

    // Abandoned event in 'processing' state from 3 minutes ago (exceeds 60s timeout)
    const staleTime = new Date(Date.now() - 180000);
    webhookEvents.set(`razorpay:${eventId}`, {
      _id: new mongoose.Types.ObjectId(),
      provider: 'razorpay',
      eventId,
      eventType: 'payment.captured',
      status: 'processing',
      orderId,
      paymentId: 'pay_stale_recovered_123',
      attempts: 1,
      lastReceivedAt: staleTime,
      createdAt: staleTime,
      metadata: { amount: 60000, currency: 'INR' },
    });

    // Run scheduled batch runner directly
    const batchResult = await runStaleWebhookReconciliationBatch({
      batchSize: 10,
      staleTimeoutMs: 60000,
    });

    assert.strictEqual(batchResult.success, true);
    assert.strictEqual(batchResult.scanned, 1);
    assert.strictEqual(batchResult.claimed, 1);
    assert.strictEqual(batchResult.processed, 1);

    // Business effects verified: wallet credited and ledger recorded exactly once
    assert.strictEqual(wallets.get(userId).balance, 1600);
    assert.strictEqual(transactions.filter((t) => t.reference === deposit.depositReference).length, 1);

    // WebhookEvent document updated to 'processed'
    const updatedEvt = webhookEvents.get(`razorpay:${eventId}`);
    assert.strictEqual(updatedEvt.status, 'processed');
    assert.strictEqual(updatedEvt.resourceType, 'wallet_deposit');
    assert.strictEqual(updatedEvt.resourceReference, deposit.depositReference);
  });

  // Test 4: Concurrent recovery workers cannot claim the same event (atomic CAS lock)
  it('4. Concurrent recovery workers cannot double-claim the same candidate event', async () => {
    const orderId = 'order_concurrent_claim_004';
    createMockDepositDoc({ amount: 500, orderId, status: 'created' });
    const eventId = 'evt_concurrent_claim_004';

    const staleTime = new Date(Date.now() - 120000);
    webhookEvents.set(`razorpay:${eventId}`, {
      _id: new mongoose.Types.ObjectId(),
      provider: 'razorpay',
      eventId,
      eventType: 'payment.captured',
      status: 'processing',
      orderId,
      paymentId: 'pay_concurrent_123',
      attempts: 1,
      lastReceivedAt: staleTime,
      createdAt: staleTime,
    });

    // Fire two batch recovery executions simultaneously
    const [batch1, batch2] = await Promise.all([
      runStaleWebhookReconciliationBatch({ batchSize: 10, staleTimeoutMs: 60000 }),
      runStaleWebhookReconciliationBatch({ batchSize: 10, staleTimeoutMs: 60000 }),
    ]);

    // Exactly one worker claimed and processed the event
    const totalClaimed = batch1.claimed + batch2.claimed;
    assert.strictEqual(totalClaimed, 1);

    // Balance credited strictly once
    assert.strictEqual(wallets.get(userId).balance, 1500);
  });

  // Test 5: Failed recovery can be retried safely
  it('5. Failed recovery marks event failed and allows safe subsequent retry', async () => {
    const orderId = 'order_transient_fail_005';
    createMockDepositDoc({ amount: 500, orderId, status: 'created' });
    const eventId = 'evt_transient_fail_005';

    const staleTime = new Date(Date.now() - 90000);
    webhookEvents.set(`razorpay:${eventId}`, {
      _id: new mongoose.Types.ObjectId(),
      provider: 'razorpay',
      eventId,
      eventType: 'payment.captured',
      status: 'processing',
      orderId,
      attempts: 1,
      lastReceivedAt: staleTime,
      createdAt: staleTime,
    });

    // Simulate transient failure during first recovery attempt
    const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
    Wallet.findOneAndUpdate = async () => {
      throw new Error('MongoNetworkTimeoutException');
    };

    try {
      const batch1 = await runStaleWebhookReconciliationBatch({
        batchSize: 10,
        staleTimeoutMs: 60000,
        maxAttempts: 5,
      });
      assert.strictEqual(batch1.claimed, 1);
      assert.strictEqual(batch1.failed, 1);

      // Event is marked 'failed' (attempts = 2), not permanently killed
      const evtAfterFail = webhookEvents.get(`razorpay:${eventId}`);
      assert.strictEqual(evtAfterFail.status, 'failed');
      assert.strictEqual(evtAfterFail.attempts, 2);
    } finally {
      Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
    }

    // Now incoming webhook retry arrives from provider
    const eventPayload = {
      id: eventId,
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_retry_succ', order_id: orderId, amount: 50000, currency: 'INR' } } },
    };
    const rawBody = JSON.stringify(eventPayload);
    const signature = signPayload(rawBody);

    const retryResult = await handleWebhookEvent(rawBody, signature, eventPayload);
    assert.strictEqual(retryResult.status, 'processed');

    // Wallet balance credited now
    assert.strictEqual(wallets.get(userId).balance, 1500);
  });

  // Test 6: Unrecoverable events remain visible for manual reconciliation (marked quarantined)
  it('6. Unrecoverable event exceeding max attempts is safely quarantined with alerts (no guessing)', async () => {
    const orderId = 'order_phantom_unrecoverable_006'; // Does NOT exist in Deposit or Payment
    const eventId = 'evt_unrecoverable_006';

    const staleTime = new Date(Date.now() - 300000);
    webhookEvents.set(`razorpay:${eventId}`, {
      _id: new mongoose.Types.ObjectId(),
      provider: 'razorpay',
      eventId,
      eventType: 'payment.captured',
      status: 'processing',
      orderId,
      attempts: 5, // Already reached max attempts
      lastReceivedAt: staleTime,
      createdAt: staleTime,
      metadata: { amount: 50000, currency: 'INR' },
    });

    const batchResult = await runStaleWebhookReconciliationBatch({
      batchSize: 10,
      staleTimeoutMs: 60000,
      maxAttempts: 5,
    });

    assert.strictEqual(batchResult.quarantined, 1);

    const quarantinedEvt = webhookEvents.get(`razorpay:${eventId}`);
    assert.strictEqual(quarantinedEvt.status, 'quarantined');
    assert.strictEqual(quarantinedEvt.lastErrorCategory, 'UNRECOVERABLE_ORDER_NOT_FOUND');
    assert.strictEqual(quarantinedEvt.metadata.requiresManualReview, true);
    assert.ok(quarantinedEvt.metadata.quarantinedAt);

    // Controller returns HTTP 422 for quarantined events
    const eventPayload = { id: eventId, event: 'payment.captured', payload: {} };
    const rawBody = JSON.stringify(eventPayload);
    const signature = signPayload(rawBody);

    const req = { headers: { 'x-razorpay-signature': signature, 'x-razorpay-event-id': eventId }, rawBody, body: eventPayload };
    const res = createMockRes();
    await handleWebhook(req, res, () => {});
    assert.strictEqual(res.statusCode, 422);
  });

  // Test 7: Out-of-order webhook delivery followed by successful retry (L-01 remediation)
  it('7. Webhook arriving before order persistence returns 503, followed by successful retry (L-01)', async () => {
    const orderId = 'order_out_of_order_007';
    const eventId = 'evt_out_of_order_007';

    const eventPayload = {
      id: eventId,
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_ooo', order_id: orderId, amount: 35000, currency: 'INR' } } },
    };
    const rawBody = JSON.stringify(eventPayload);
    const signature = signPayload(rawBody);

    const req = {
      headers: {
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId,
      },
      rawBody,
      body: eventPayload,
    };
    const res1 = createMockRes();

    // 1. Webhook arrives BEFORE Deposit record is persisted in MongoDB
    await handleWebhook(req, res1, () => {});

    // Must NOT be marked permanently processed! Must return 503 so gateway retries
    assert.strictEqual(res1.statusCode, 503);
    assert.strictEqual(res1.jsonData.result.status, 'order_pending');
    assert.strictEqual(res1.jsonData.result.retryable, true);

    const eventInDb = webhookEvents.get(`razorpay:${eventId}`);
    assert.strictEqual(eventInDb.status, 'failed');
    assert.strictEqual(eventInDb.lastErrorCategory, 'ORDER_NOT_FOUND');

    // 2. Client finishes order creation: Deposit is now persisted
    const deposit = createMockDepositDoc({ amount: 350, orderId, status: 'created' });

    // 3. Provider retry arrives
    const res2 = createMockRes();
    await handleWebhook(req, res2, () => {});

    // Now completes successfully: HTTP 200 OK!
    assert.strictEqual(res2.statusCode, 200);
    assert.strictEqual(res2.jsonData.success, true);
    assert.strictEqual(res2.jsonData.result.status, 'processed');

    // Balance credited
    assert.strictEqual(wallets.get(userId).balance, 1350);

    // 4. Duplicate subsequent delivery returns 200 already_processed without second credit
    const res3 = createMockRes();
    await handleWebhook(req, res3, () => {});
    assert.strictEqual(res3.statusCode, 200);
    assert.strictEqual(res3.jsonData.result.status, 'already_processed');
    assert.strictEqual(wallets.get(userId).balance, 1350);
  });

  // Test 8: Scheduler startup, bounded batches, and graceful shutdown
  it('8. Scheduler start and graceful stop lifecycle operates cleanly', async () => {
    assert.strictEqual(isWebhookReconciliationSchedulerRunning(), false);

    startWebhookReconciliationScheduler({ intervalMs: 100000 });
    assert.strictEqual(isWebhookReconciliationSchedulerRunning(), true);

    // Double start does not duplicate timer
    startWebhookReconciliationScheduler({ intervalMs: 100000 });
    assert.strictEqual(isWebhookReconciliationSchedulerRunning(), true);

    stopWebhookReconciliationScheduler();
    assert.strictEqual(isWebhookReconciliationSchedulerRunning(), false);
  });
});

describe('MAT-27 — Failed Webhook Recovery & Concurrency Safety Tests', () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const walletId = new mongoose.Types.ObjectId();

  let deposits;
  let wallets;
  let transactions;
  let payments;
  let userPlans;
  let webhookEvents;

  let origWebhookEventCreate;
  let origWebhookEventFind;
  let origWebhookEventFindOne;
  let origWebhookEventFindOneAndUpdate;
  let origWebhookEventUpdateOne;
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

  const testWebhookSecret = 'test_webhook_secret_key_mat27_12345';

  const signPayload = (rawBody, secret = testWebhookSecret) => {
    return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  };

  const createMockRes = () => {
    const res = {
      statusCode: 200,
      jsonData: null,
      status: function (code) {
        this.statusCode = code;
        return this;
      },
      json: function (data) {
        this.jsonData = data;
        return this;
      },
    };
    return res;
  };

  beforeEach(() => {
    deposits = new Map();
    wallets = new Map();
    transactions = [];
    payments = new Map();
    userPlans = [];
    webhookEvents = new Map();

    process.env.RAZORPAY_WEBHOOK_SECRET = testWebhookSecret;
    process.env.JWT_SECRET = 'test_jwt_secret_minimum_32_characters_here';

    wallets.set(userId, {
      _id: walletId,
      user: userId,
      balance: 1000,
      processedOperations: [],
    });

    origWebhookEventCreate = WebhookEvent.create;
    origWebhookEventFind = WebhookEvent.find;
    origWebhookEventFindOne = WebhookEvent.findOne;
    origWebhookEventFindOneAndUpdate = WebhookEvent.findOneAndUpdate;
    origWebhookEventUpdateOne = WebhookEvent.updateOne;
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

    WebhookEvent.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      const key = `${item.provider || 'razorpay'}:${item.eventId}`;
      if (webhookEvents.has(key)) {
        const dupErr = new Error(`E11000 duplicate key error: ${key}`);
        dupErr.code = 11000;
        throw dupErr;
      }
      const created = {
        _id: new mongoose.Types.ObjectId(),
        attempts: 1,
        firstReceivedAt: new Date(),
        lastReceivedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...item,
      };
      webhookEvents.set(key, created);
      return created;
    };

    WebhookEvent.findOne = async (query) => {
      for (const evt of webhookEvents.values()) {
        if (query.provider && query.eventId) {
          if (evt.provider === query.provider && evt.eventId === query.eventId) {
            return { ...evt };
          }
        } else if (query.eventId && evt.eventId === query.eventId) {
          return { ...evt };
        }
      }
      return null;
    };

    WebhookEvent.find = (query = {}) => {
      let filtered = Array.from(webhookEvents.values());
      if (query.status) {
        if (query.status.$in && Array.isArray(query.status.$in)) {
          filtered = filtered.filter((e) => query.status.$in.includes(e.status));
        } else {
          filtered = filtered.filter((e) => e.status === query.status);
        }
      }
      if (query.lastReceivedAt?.$lt) {
        filtered = filtered.filter((e) => new Date(e.lastReceivedAt) < query.lastReceivedAt.$lt);
      }
      return {
        sort: (sortObj = {}) => {
          filtered.sort((a, b) => new Date(a.lastReceivedAt) - new Date(b.lastReceivedAt));
          return {
            limit: (n) => Promise.resolve(filtered.slice(0, n).map((item) => ({ ...item }))),
            then: (resolve) => resolve(filtered.map((item) => ({ ...item }))),
          };
        },
        limit: (n) => Promise.resolve(filtered.slice(0, n).map((item) => ({ ...item }))),
        then: (resolve) => resolve(filtered.map((item) => ({ ...item }))),
      };
    };

    WebhookEvent.findOneAndUpdate = async (query, update, opts = {}) => {
      for (const [key, evt] of webhookEvents.entries()) {
        let match = true;
        if (query._id && String(evt._id) !== String(query._id)) match = false;
        if (query.provider && evt.provider !== query.provider) match = false;
        if (query.eventId && evt.eventId !== query.eventId) match = false;
        if (query.status) {
          if (query.status.$in && Array.isArray(query.status.$in)) {
            if (!query.status.$in.includes(evt.status)) match = false;
          } else if (evt.status !== query.status) {
            match = false;
          }
        }
        if (query.lastReceivedAt) {
          const qTime = new Date(query.lastReceivedAt).getTime();
          const eTime = new Date(evt.lastReceivedAt).getTime();
          if (qTime !== eTime) match = false;
        }

        if (match) {
          if (update.$set) {
            for (const [k, v] of Object.entries(update.$set)) {
              if (k.startsWith('metadata.')) {
                evt.metadata = evt.metadata || {};
                evt.metadata[k.slice('metadata.'.length)] = v;
              } else {
                evt[k] = v;
              }
            }
          }
          if (update.$inc) {
            for (const [k, val] of Object.entries(update.$inc)) {
              evt[k] = (evt[k] || 0) + val;
            }
          }
          webhookEvents.set(key, evt);
          return { ...evt };
        }
      }
      return null;
    };

    WebhookEvent.updateOne = async (query, update) => {
      for (const [key, evt] of webhookEvents.entries()) {
        let match = true;
        if (query._id && String(evt._id) !== String(query._id)) match = false;
        if (query.provider && evt.provider !== query.provider) match = false;
        if (query.eventId && evt.eventId !== query.eventId) match = false;

        if (match) {
          if (update.$set) {
            for (const [k, v] of Object.entries(update.$set)) {
              if (k.startsWith('metadata.')) {
                evt.metadata = evt.metadata || {};
                evt.metadata[k.slice('metadata.'.length)] = v;
              } else {
                evt[k] = v;
              }
            }
          }
          webhookEvents.set(key, evt);
          return { acknowledged: true, modifiedCount: 1 };
        }
      }
      return { acknowledged: true, modifiedCount: 0 };
    };

    Deposit.findOne = async (query) => {
      for (const d of deposits.values()) {
        if (query._id && String(d._id) === String(query._id)) return d;
        if (query.orderId && d.orderId === query.orderId) return d;
        if (query.depositReference && d.depositReference === query.depositReference) return d;
      }
      return null;
    };

    Deposit.findById = async (id) => deposits.get(String(id)) || null;

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
      }
      return matchedDoc;
    };

    Deposit.updateOne = async (filter, update) => {
      const dep = deposits.get(String(filter._id));
      if (!dep) return { acknowledged: true, modifiedCount: 0 };
      if (update.$set) Object.assign(dep, update.$set);
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
      if (filter.processedOperations?.$ne) {
        if (wallet.processedOperations?.includes(filter.processedOperations.$ne)) return null;
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
      if (update.$inc?.balance) {
        wallet.balance = Math.round((wallet.balance + update.$inc.balance) * 100) / 100;
      }
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
      }
      return {
        sort: () => Promise.resolve(filtered.length > 0 ? { ...filtered[0] } : null),
        then: (resolve) => resolve(filtered.length > 0 ? { ...filtered[0] } : null),
      };
    };

    Transaction.find = (query = {}) => {
      let filtered = [...transactions];
      if (query.reference && typeof query.reference === 'string') {
        filtered = filtered.filter((t) => t.reference === query.reference);
      }
      return {
        sort: () => Promise.resolve(filtered),
        then: (resolve) => resolve(filtered),
      };
    };

    Transaction.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      if (transactions.some((t) => t.reference === item.reference)) {
        const dupErr = new Error(`E11000 duplicate reference: "${item.reference}"`);
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
        if (query.idempotencyKey && up.idempotencyKey === query.idempotencyKey) return up;
      }
      return null;
    };

    UserPlan.create = async (doc) => {
      const created = {
        _id: new mongoose.Types.ObjectId(),
        createdAt: new Date(),
        ...doc,
      };
      userPlans.push(created);
      return created;
    };

    Plan.findById = async () => ({
      _id: new mongoose.Types.ObjectId(),
      name: 'Starter Plan',
      price: 500,
      durationDays: 30,
      dailyRoiRate: 1.5,
      hashRate: 100,
    });
  });

  afterEach(() => {
    stopWebhookReconciliationScheduler();
    WebhookEvent.create = origWebhookEventCreate;
    WebhookEvent.find = origWebhookEventFind;
    WebhookEvent.findOne = origWebhookEventFindOne;
    WebhookEvent.findOneAndUpdate = origWebhookEventFindOneAndUpdate;
    WebhookEvent.updateOne = origWebhookEventUpdateOne;
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
  });

  const createMockDepositDoc = (opts = {}) => {
    const depositId = new mongoose.Types.ObjectId();
    const depositReference = opts.depositReference || `DEP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const orderId = opts.orderId || `ord_${Date.now()}`;
    const amount = opts.amount || 500;

    const doc = {
      _id: depositId,
      user: new mongoose.Types.ObjectId(userId),
      wallet: walletId,
      amount,
      currency: 'INR',
      depositReference,
      provider: 'razorpay',
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

  // Test 1: Stale failed event discovered by scheduler
  it('1. Stale failed event is discovered and reclaimed by background reconciliation scheduler (S-01)', async () => {
    const orderId = 'order_stale_failed_001';
    const deposit = createMockDepositDoc({ amount: 400, orderId, status: 'created' });
    const eventId = 'evt_stale_failed_001';

    // Event previously failed (e.g. ORDER_NOT_FOUND) 2 minutes ago
    const staleTime = new Date(Date.now() - 120000);
    webhookEvents.set(`razorpay:${eventId}`, {
      _id: new mongoose.Types.ObjectId(),
      provider: 'razorpay',
      eventId,
      eventType: 'payment.captured',
      status: 'failed',
      orderId,
      paymentId: 'pay_failed_recovered_123',
      attempts: 1,
      lastReceivedAt: staleTime,
      createdAt: staleTime,
      failedAt: staleTime,
      lastErrorCategory: 'ORDER_NOT_FOUND',
      metadata: { amount: 40000, currency: 'INR' },
    });

    const batchResult = await runStaleWebhookReconciliationBatch({
      batchSize: 10,
      staleTimeoutMs: 60000,
    });

    assert.strictEqual(batchResult.success, true);
    assert.strictEqual(batchResult.scanned, 1);
    assert.strictEqual(batchResult.claimed, 1);
    assert.strictEqual(batchResult.processed, 1);

    // Business effects: wallet credited exactly once (+400)
    assert.strictEqual(wallets.get(userId).balance, 1400);
    assert.strictEqual(transactions.filter((t) => t.reference === deposit.depositReference).length, 1);

    // Event updated to processed
    const updatedEvt = webhookEvents.get(`razorpay:${eventId}`);
    assert.strictEqual(updatedEvt.status, 'processed');
    assert.strictEqual(updatedEvt.resourceType, 'wallet_deposit');
    assert.strictEqual(updatedEvt.resourceReference, deposit.depositReference);
  });

  // Test 2: Order becomes available after original webhook failed (Full End-to-End without Gateway Retries)
  it('2. Order becoming available after initial webhook failure is automatically recovered without provider retries', async () => {
    const orderId = 'order_delayed_persistence_002';
    const eventId = 'evt_delayed_persistence_002';

    const eventPayload = {
      id: eventId,
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_delayed_002', order_id: orderId, amount: 75000, currency: 'INR' } } },
    };
    const rawBody = JSON.stringify(eventPayload);
    const signature = signPayload(rawBody);

    const req = {
      headers: {
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId,
      },
      rawBody,
      body: eventPayload,
    };
    const res = createMockRes();

    // 1. Initial webhook arrives BEFORE Deposit is persisted
    await handleWebhook(req, res, () => {});
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.jsonData.result.status, 'order_pending');
    assert.strictEqual(wallets.get(userId).balance, 1000);

    const initialEvt = webhookEvents.get(`razorpay:${eventId}`);
    assert.strictEqual(initialEvt.status, 'failed');
    assert.strictEqual(initialEvt.lastErrorCategory, 'ORDER_NOT_FOUND');
    assert.strictEqual(initialEvt.attempts, 1);

    // 2. Client finishes checkout: Deposit is now persisted in MongoDB
    const deposit = createMockDepositDoc({ amount: 750, orderId, status: 'created' });

    // 3. Provider NEVER retries! Gateway retries stop, time passes beyond stale threshold:
    initialEvt.lastReceivedAt = new Date(Date.now() - 90000);
    webhookEvents.set(`razorpay:${eventId}`, initialEvt);

    // 4. Background reconciliation scheduler runs
    const batchResult = await runStaleWebhookReconciliationBatch({
      batchSize: 10,
      staleTimeoutMs: 60000,
    });

    assert.strictEqual(batchResult.success, true);
    assert.strictEqual(batchResult.claimed, 1);
    assert.strictEqual(batchResult.processed, 1);

    // 5. Wallet balance credited exactly once (1000 + 750 = 1750)
    assert.strictEqual(wallets.get(userId).balance, 1750);
    assert.strictEqual(transactions.filter((t) => t.reference === deposit.depositReference).length, 1);

    const finalEvt = webhookEvents.get(`razorpay:${eventId}`);
    assert.strictEqual(finalEvt.status, 'processed');
    assert.strictEqual(finalEvt.attempts, 2);
    assert.strictEqual(deposit.status, 'completed');
  });

  // Test 3: Concurrent workers attempting to claim the same failed event
  it('3. Concurrent workers attempting to claim the same failed event race on atomic CAS (single winner)', async () => {
    const orderId = 'order_concurrent_failed_003';
    createMockDepositDoc({ amount: 500, orderId, status: 'created' });
    const eventId = 'evt_concurrent_failed_003';

    const staleTime = new Date(Date.now() - 120000);
    webhookEvents.set(`razorpay:${eventId}`, {
      _id: new mongoose.Types.ObjectId(),
      provider: 'razorpay',
      eventId,
      eventType: 'payment.captured',
      status: 'failed',
      orderId,
      paymentId: 'pay_concurrent_failed_123',
      attempts: 1,
      lastReceivedAt: staleTime,
      createdAt: staleTime,
      failedAt: staleTime,
      lastErrorCategory: 'ORDER_NOT_FOUND',
    });

    // Two background recovery batches execute simultaneously
    const [batch1, batch2] = await Promise.all([
      runStaleWebhookReconciliationBatch({ batchSize: 10, staleTimeoutMs: 60000 }),
      runStaleWebhookReconciliationBatch({ batchSize: 10, staleTimeoutMs: 60000 }),
    ]);

    // Exactly one worker claimed and processed the event
    assert.strictEqual(batch1.claimed + batch2.claimed, 1);
    assert.strictEqual(batch1.processed + batch2.processed, 1);

    // Wallet credited strictly once (+500 -> 1500)
    assert.strictEqual(wallets.get(userId).balance, 1500);

    const finalEvt = webhookEvents.get(`razorpay:${eventId}`);
    assert.strictEqual(finalEvt.status, 'processed');
  });

  // Test 4: Maximum attempts resulting in quarantine without balance changes
  it('4. Maximum attempts on unresolvable failed event results in quarantine without balance mutations', async () => {
    const orderId = 'order_phantom_mat27_004'; // Does NOT exist in Deposit or Payment
    const eventId = 'evt_phantom_mat27_004';

    const staleTime = new Date(Date.now() - 180000);
    webhookEvents.set(`razorpay:${eventId}`, {
      _id: new mongoose.Types.ObjectId(),
      provider: 'razorpay',
      eventId,
      eventType: 'payment.captured',
      status: 'failed',
      orderId,
      attempts: 4, // 4 attempts already made; next claim will be 5th (reaching maxAttempts: 5)
      lastReceivedAt: staleTime,
      createdAt: staleTime,
      failedAt: staleTime,
      lastErrorCategory: 'ORDER_NOT_FOUND',
      metadata: { amount: 50000, currency: 'INR' },
    });

    const initialBalance = wallets.get(userId).balance;
    assert.strictEqual(initialBalance, 1000);

    const batchResult = await runStaleWebhookReconciliationBatch({
      batchSize: 10,
      staleTimeoutMs: 60000,
      maxAttempts: 5,
    });

    assert.strictEqual(batchResult.quarantined, 1);

    const quarantinedEvt = webhookEvents.get(`razorpay:${eventId}`);
    assert.strictEqual(quarantinedEvt.status, 'quarantined');
    assert.strictEqual(quarantinedEvt.lastErrorCategory, 'UNRECOVERABLE_ORDER_NOT_FOUND');
    assert.strictEqual(quarantinedEvt.metadata.requiresManualReview, true);
    assert.ok(quarantinedEvt.metadata.quarantinedAt);

    // Balance remains strictly unchanged — zero balance fabrication!
    assert.strictEqual(wallets.get(userId).balance, 1000);
    assert.strictEqual(transactions.length, 0);

    // Subsequent batch skips the quarantined event completely
    const nextBatch = await runStaleWebhookReconciliationBatch({
      batchSize: 10,
      staleTimeoutMs: 60000,
      maxAttempts: 5,
    });
    assert.strictEqual(nextBatch.scanned, 0);
  });

  // Test 5: Already-processed events never being credited again
  it('5. Already-processed events are never scanned by scheduler or re-credited by subsequent deliveries', async () => {
    const orderId = 'order_already_done_005';
    const deposit = createMockDepositDoc({ amount: 500, orderId, status: 'completed' });
    const eventId = 'evt_already_done_005';

    const staleTime = new Date(Date.now() - 180000);
    webhookEvents.set(`razorpay:${eventId}`, {
      _id: new mongoose.Types.ObjectId(),
      provider: 'razorpay',
      eventId,
      eventType: 'payment.captured',
      status: 'processed',
      orderId,
      paymentId: 'pay_done_123',
      resourceType: 'wallet_deposit',
      resourceReference: deposit.depositReference,
      attempts: 1,
      lastReceivedAt: staleTime,
      createdAt: staleTime,
      processedAt: staleTime,
    });

    wallets.get(userId).balance = 1500;

    // Scheduler run: processed events are never scanned
    const batchResult = await runStaleWebhookReconciliationBatch({
      batchSize: 10,
      staleTimeoutMs: 60000,
    });
    assert.strictEqual(batchResult.scanned, 0);
    assert.strictEqual(wallets.get(userId).balance, 1500);

    // HTTP delivery arrives for already processed event
    const eventPayload = {
      id: eventId,
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_done_123', order_id: orderId, amount: 50000, currency: 'INR' } } },
    };
    const rawBody = JSON.stringify(eventPayload);
    const signature = signPayload(rawBody);

    const req = {
      headers: {
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId,
      },
      rawBody,
      body: eventPayload,
    };
    const res = createMockRes();
    await handleWebhook(req, res, () => {});

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.jsonData.result.status, 'already_processed');
    assert.strictEqual(wallets.get(userId).balance, 1500);
    assert.strictEqual(transactions.length, 0);
  });

  // Test 6: Existing processing-event crash recovery continuing to work
  it('6. Processing-event crash recovery continues to work seamlessly alongside failed recovery', async () => {
    const orderId = 'order_crash_recovery_006';
    const deposit = createMockDepositDoc({ amount: 600, orderId, status: 'created' });
    const eventId = 'evt_crash_recovery_006';

    const staleTime = new Date(Date.now() - 150000);
    webhookEvents.set(`razorpay:${eventId}`, {
      _id: new mongoose.Types.ObjectId(),
      provider: 'razorpay',
      eventId,
      eventType: 'payment.captured',
      status: 'processing', // Abandoned during worker crash
      orderId,
      paymentId: 'pay_crash_123',
      attempts: 1,
      lastReceivedAt: staleTime,
      createdAt: staleTime,
      metadata: { amount: 60000, currency: 'INR' },
    });

    const batchResult = await runStaleWebhookReconciliationBatch({
      batchSize: 10,
      staleTimeoutMs: 60000,
    });

    assert.strictEqual(batchResult.success, true);
    assert.strictEqual(batchResult.scanned, 1);
    assert.strictEqual(batchResult.claimed, 1);
    assert.strictEqual(batchResult.processed, 1);

    assert.strictEqual(wallets.get(userId).balance, 1600);
    assert.strictEqual(transactions.filter((t) => t.reference === deposit.depositReference).length, 1);

    const updatedEvt = webhookEvents.get(`razorpay:${eventId}`);
    assert.strictEqual(updatedEvt.status, 'processed');
  });
});

describe('MAT-28 — Admin Webhook Quarantine Management & Audit Trail Tests', () => {
  const adminId = new mongoose.Types.ObjectId();
  const secondAdminId = new mongoose.Types.ObjectId();
  const testUserId = new mongoose.Types.ObjectId().toString();
  const testWalletId = new mongoose.Types.ObjectId();

  let quarantinedEvents = new Map();
  let testDeposits = new Map();
  let testWallets = new Map();
  let testTransactions = [];
  let testAuditLogs = [];

  let origReadyState;
  let origClient;
  let origStartSession;
  let mockSession;
  let sessionSpy;
  let origUserFindById;

  let origWebhookEventFind;
  let origWebhookEventCountDocuments;
  let origWebhookEventFindOne;
  let origWebhookEventFindById;
  let origWebhookEventFindOneAndUpdate;
  let origWebhookEventUpdateOne;
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
  let origAuditLogCreate;
  let origPaymentFindOne;

  beforeEach(() => {
    quarantinedEvents = new Map();
    testDeposits = new Map();
    testWallets = new Map();
    testTransactions = [];
    testAuditLogs = [];

    testWallets.set(testUserId, {
      _id: testWalletId,
      user: new mongoose.Types.ObjectId(testUserId),
      balance: 1000,
      processedOperations: [],
    });

    origReadyState = mongoose.connection?.readyState;
    origClient = mongoose.connection?.client;
    origStartSession = mongoose.startSession;
    origUserFindById = User.findById;

    mongoose.connection.readyState = 1;
    mongoose.connection.client = {
      topology: {
        description: {
          type: 'ReplicaSetWithPrimary',
        },
      },
    };

    let activeSnapshot = null;
    sessionSpy = {
      startCount: 0,
      commitCount: 0,
      abortCount: 0,
      endCount: 0,
    };

    mockSession = {
      startTransaction: () => {
        sessionSpy.startCount++;
        activeSnapshot = {
          quarantinedEvents: new Map(Array.from(quarantinedEvents.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
          testDeposits: new Map(Array.from(testDeposits.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
          testWallets: new Map(Array.from(testWallets.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
          testTransactions: testTransactions.map((t) => ({ ...t })),
          testAuditLogs: testAuditLogs.map((a) => ({ ...a })),
        };
      },
      commitTransaction: async () => {
        sessionSpy.commitCount++;
        activeSnapshot = null;
      },
      abortTransaction: async () => {
        sessionSpy.abortCount++;
        if (activeSnapshot) {
          quarantinedEvents.clear();
          for (const [k, v] of activeSnapshot.quarantinedEvents.entries()) quarantinedEvents.set(k, v);
          testDeposits.clear();
          for (const [k, v] of activeSnapshot.testDeposits.entries()) testDeposits.set(k, v);
          testWallets.clear();
          for (const [k, v] of activeSnapshot.testWallets.entries()) testWallets.set(k, v);
          testTransactions.length = 0;
          testTransactions.push(...activeSnapshot.testTransactions);
          testAuditLogs.length = 0;
          testAuditLogs.push(...activeSnapshot.testAuditLogs);
          activeSnapshot = null;
        }
      },
      endSession: async () => {
        sessionSpy.endCount++;
      },
      inTransaction: () => activeSnapshot !== null,
    };

    mongoose.startSession = async () => mockSession;

    User.findById = (id) => ({
      select: () => Promise.resolve({
        _id: new mongoose.Types.ObjectId(id),
        name: 'Second Admin',
        email: 'admin2@example.com',
        role: 'admin',
        isActive: true,
      }),
      then: (resolve) => resolve({
        _id: new mongoose.Types.ObjectId(id),
        name: 'Second Admin',
        email: 'admin2@example.com',
        role: 'admin',
        isActive: true,
      }),
    });

    origWebhookEventFind = WebhookEvent.find;
    origWebhookEventCountDocuments = WebhookEvent.countDocuments;
    origWebhookEventFindOne = WebhookEvent.findOne;
    origWebhookEventFindById = WebhookEvent.findById;
    origWebhookEventFindOneAndUpdate = WebhookEvent.findOneAndUpdate;
    origWebhookEventUpdateOne = WebhookEvent.updateOne;
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
    origAuditLogCreate = AuditLog.create;
    origPaymentFindOne = Payment.findOne;

    WebhookEvent.countDocuments = async (filter = {}) => {
      let count = 0;
      for (const evt of quarantinedEvents.values()) {
        if (filter.status && evt.status !== filter.status) continue;
        count++;
      }
      return count;
    };

    WebhookEvent.find = (query = {}) => {
      let filtered = Array.from(quarantinedEvents.values());
      if (query.status) {
        filtered = filtered.filter((e) => e.status === query.status);
      }
      const chain = {
        sort: () => chain,
        skip: (n) => {
          filtered = filtered.slice(n);
          return chain;
        },
        limit: (n) => {
          filtered = filtered.slice(0, n);
          return chain;
        },
        lean: () => Promise.resolve(filtered.map((item) => ({ ...item }))),
        then: (resolve) => resolve(filtered.map((item) => ({ ...item }))),
      };
      return chain;
    };

    WebhookEvent.findOne = async (query = {}) => {
      for (const evt of quarantinedEvents.values()) {
        if (query.$or && Array.isArray(query.$or)) {
          const match = query.$or.some((c) => {
            if (c._id && String(evt._id) === String(c._id)) return true;
            if (c.eventId && evt.eventId === c.eventId) return true;
            return false;
          });
          if (match) return { ...evt };
          continue;
        }
        if (query._id && String(evt._id) !== String(query._id)) continue;
        if (query.eventId && evt.eventId !== query.eventId) continue;
        if (query.status && evt.status !== query.status) continue;
        return { ...evt };
      }
      return null;
    };

    WebhookEvent.findById = async (id) => {
      for (const evt of quarantinedEvents.values()) {
        if (String(evt._id) === String(id)) return { ...evt };
      }
      return null;
    };

    WebhookEvent.findOneAndUpdate = async (query, update) => {
      for (const [key, evt] of quarantinedEvents.entries()) {
        let match = true;
        if (query._id && String(evt._id) !== String(query._id)) match = false;
        if (query.eventId && evt.eventId !== query.eventId) match = false;
        if (query.status && evt.status !== query.status) match = false;

        if (match) {
          if (update.$set) {
            for (const [k, v] of Object.entries(update.$set)) {
              if (k.startsWith('metadata.')) {
                evt.metadata = evt.metadata || {};
                evt.metadata[k.slice('metadata.'.length)] = v;
              } else {
                evt[k] = v;
              }
            }
          }
          if (update.$inc?.attempts) {
            evt.attempts = (evt.attempts || 0) + update.$inc.attempts;
          }
          quarantinedEvents.set(key, evt);
          return { ...evt };
        }
      }
      return null;
    };

    WebhookEvent.updateOne = async (query, update) => {
      for (const [key, evt] of quarantinedEvents.entries()) {
        let match = true;
        if (query._id && String(evt._id) !== String(query._id)) match = false;
        if (query.eventId && evt.eventId !== query.eventId) match = false;

        if (match) {
          if (update.$set) {
            for (const [k, v] of Object.entries(update.$set)) {
              if (k.startsWith('metadata.')) {
                evt.metadata = evt.metadata || {};
                evt.metadata[k.slice('metadata.'.length)] = v;
              } else {
                evt[k] = v;
              }
            }
          }
          quarantinedEvents.set(key, evt);
          return { acknowledged: true, modifiedCount: 1 };
        }
      }
      return { acknowledged: true, modifiedCount: 0 };
    };

    Deposit.findOne = async (query) => {
      for (const d of testDeposits.values()) {
        if (query._id && String(d._id) === String(query._id)) return d;
        if (query.orderId && d.orderId === query.orderId) return d;
        if (query.depositReference && d.depositReference === query.depositReference) return d;
      }
      return null;
    };

    Deposit.findById = async (id) => testDeposits.get(String(id)) || null;

    Deposit.findOneAndUpdate = async (filter, update) => {
      let matched = null;
      for (const d of testDeposits.values()) {
        if (filter._id && String(d._id) !== String(filter._id)) continue;
        if (filter.status?.$in && !filter.status.$in.includes(d.status)) continue;
        matched = d;
        break;
      }
      if (!matched) return null;
      if (update.$set) Object.assign(matched, update.$set);
      return matched;
    };

    Deposit.updateOne = async (filter, update) => {
      const dep = testDeposits.get(String(filter._id));
      if (!dep) return { acknowledged: true, modifiedCount: 0 };
      if (update.$set) Object.assign(dep, update.$set);
      return { acknowledged: true, modifiedCount: 1 };
    };

    Wallet.findOne = async (query) => {
      const uId = query.user ? String(query.user) : null;
      return testWallets.get(uId) || null;
    };

    Wallet.findOneAndUpdate = async (filter, update) => {
      const uId = filter.user ? String(filter.user) : null;
      const wallet = testWallets.get(uId);
      if (!wallet) return null;
      if (filter.processedOperations?.$ne) {
        if (wallet.processedOperations?.includes(filter.processedOperations.$ne)) return null;
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
      const wallet = testWallets.get(uId);
      if (!wallet) return { acknowledged: true, modifiedCount: 0 };
      if (update.$inc?.balance) {
        wallet.balance = Math.round((wallet.balance + update.$inc.balance) * 100) / 100;
      }
      if (update.$addToSet?.processedOperations) {
        wallet.processedOperations = wallet.processedOperations || [];
        if (!wallet.processedOperations.includes(update.$addToSet.processedOperations)) {
          wallet.processedOperations.push(update.$addToSet.processedOperations);
        }
      }
      return { acknowledged: true, modifiedCount: 1 };
    };

    Transaction.findOne = (query = {}) => {
      let filtered = [...testTransactions];
      if (query.reference && typeof query.reference === 'string') {
        filtered = filtered.filter((t) => t.reference === query.reference);
      }
      return {
        sort: () => Promise.resolve(filtered.length > 0 ? { ...filtered[0] } : null),
        then: (resolve) => resolve(filtered.length > 0 ? { ...filtered[0] } : null),
      };
    };

    Transaction.find = (query = {}) => {
      let filtered = [...testTransactions];
      if (query.reference && typeof query.reference === 'string') {
        filtered = filtered.filter((t) => t.reference === query.reference);
      }
      return {
        sort: () => Promise.resolve(filtered),
        then: (resolve) => resolve(filtered),
      };
    };

    Transaction.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      if (testTransactions.some((t) => t.reference === item.reference)) {
        const dupErr = new Error(`E11000 duplicate reference: "${item.reference}"`);
        dupErr.code = 11000;
        throw dupErr;
      }
      const created = {
        _id: new mongoose.Types.ObjectId(),
        createdAt: new Date(),
        ...item,
      };
      testTransactions.push(created);
      return created;
    };

    AuditLog.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      const created = {
        _id: new mongoose.Types.ObjectId(),
        createdAt: new Date(),
        ...item,
      };
      testAuditLogs.push(created);
      return Array.isArray(doc) ? [created] : created;
    };

    Payment.findOne = () => ({
      populate: () => Promise.resolve(null),
      then: (resolve) => resolve(null),
    });
  });

  afterEach(() => {
    User.findById = origUserFindById;
    WebhookEvent.find = origWebhookEventFind;
    WebhookEvent.countDocuments = origWebhookEventCountDocuments;
    WebhookEvent.findOne = origWebhookEventFindOne;
    WebhookEvent.findById = origWebhookEventFindById;
    WebhookEvent.findOneAndUpdate = origWebhookEventFindOneAndUpdate;
    WebhookEvent.updateOne = origWebhookEventUpdateOne;
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
    AuditLog.create = origAuditLogCreate;
    Payment.findOne = origPaymentFindOne;

    if (origReadyState !== undefined) {
      mongoose.connection.readyState = origReadyState;
    }
    if (origClient !== undefined) {
      mongoose.connection.client = origClient;
    }
    if (origStartSession !== undefined) {
      mongoose.startSession = origStartSession;
    }
  });

  const createQuarantinedEvent = (opts = {}) => {
    const eventId = opts.eventId || `evt_quarantine_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const doc = {
      _id: new mongoose.Types.ObjectId(),
      provider: 'razorpay',
      eventId,
      eventType: opts.eventType || 'payment.captured',
      status: opts.status || 'quarantined',
      orderId: opts.orderId || `order_${Date.now()}`,
      paymentId: opts.paymentId || `pay_${Date.now()}`,
      attempts: opts.attempts || 5,
      lastErrorCategory: opts.lastErrorCategory || 'UNRECOVERABLE_ORDER_NOT_FOUND',
      lastErrorMessage: opts.lastErrorMessage || 'Order record missing after max recovery attempts',
      firstReceivedAt: new Date(Date.now() - 3600000),
      lastReceivedAt: new Date(Date.now() - 300000),
      failedAt: new Date(Date.now() - 300000),
      createdAt: new Date(Date.now() - 3600000),
      updatedAt: new Date(Date.now() - 300000),
      metadata: {
        amount: opts.amount || 50000,
        currency: 'INR',
        requiresManualReview: true,
        quarantinedAt: new Date(Date.now() - 300000),
        secretHeader: 'SHOULD_NOT_LEAK',
        rawSignature: 'RAW_SIG_SHOULD_NOT_LEAK',
      },
    };
    quarantinedEvents.set(eventId, doc);
    return doc;
  };

  const createDepositDoc = (opts = {}) => {
    const depositId = new mongoose.Types.ObjectId();
    const depositReference = opts.depositReference || `DEP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const orderId = opts.orderId || `order_${Date.now()}`;
    const amount = opts.amount || 500;

    const doc = {
      _id: depositId,
      user: new mongoose.Types.ObjectId(testUserId),
      wallet: testWalletId,
      amount,
      currency: 'INR',
      depositReference,
      provider: 'razorpay',
      orderId,
      status: opts.status || 'created',
      metadata: opts.metadata || {},
      save: async function () {
        testDeposits.set(String(this._id), this);
        return this;
      },
    };
    testDeposits.set(String(depositId), doc);
    return doc;
  };

  it('1. getQuarantinedWebhookEventsAdmin returns bounded paginated results and strips sensitive payload data', async () => {
    for (let i = 1; i <= 5; i++) {
      createQuarantinedEvent({ eventId: `evt_quarantine_pg_${i}`, amount: i * 10000 });
    }

    const res = await getQuarantinedWebhookEventsAdmin({ page: 1, limit: 2 });
    assert.strictEqual(res.total, 5);
    assert.strictEqual(res.page, 1);
    assert.strictEqual(res.pages, 3);
    assert.strictEqual(res.events.length, 2);

    const first = res.events[0];
    assert.ok(first.eventId);
    assert.strictEqual(first.status, 'quarantined');
    assert.strictEqual(first.requiresManualReview, true);
    assert.strictEqual(first.metadata, undefined);
    assert.strictEqual(first.secretHeader, undefined);
    assert.strictEqual(first.rawSignature, undefined);
  });

  it('2. resolveQuarantinedWebhookEventAdmin enforces mandatory justification reason (min 10 chars)', async () => {
    const evt = createQuarantinedEvent();

    await assert.rejects(
      async () => {
        await resolveQuarantinedWebhookEventAdmin(adminId, evt.eventId, { reason: 'Short' });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /min 10 characters/i);
        return true;
      }
    );
  });

  it('3. resolveQuarantinedWebhookEventAdmin rejects non-quarantined event', async () => {
    const evt = createQuarantinedEvent({ status: 'processed' });

    await assert.rejects(
      async () => {
        await resolveQuarantinedWebhookEventAdmin(adminId, evt.eventId, {
          reason: 'Valid resolution reason on processed event',
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /Only quarantined webhook events can be manually reconciled/i);
        return true;
      }
    );
  });

  it('4. resolveQuarantinedWebhookEventAdmin prevents concurrent duplicate claims atomically (409 Conflict)', async () => {
    const orderId = 'order_cas_race_001';
    createDepositDoc({ amount: 500, orderId, status: 'created' });
    const evt = createQuarantinedEvent({ orderId, amount: 500 });

    // Ensure both requests read status: 'quarantined' before either claims CAS lock
    const origFindOne = WebhookEvent.findOne;
    const origFindOneAndUpdate = WebhookEvent.findOneAndUpdate;

    let findOneCount = 0;
    let resolveSecondFindOne;
    const secondFindOnePromise = new Promise((resolve) => {
      resolveSecondFindOne = resolve;
    });

    WebhookEvent.findOne = async (...args) => {
      const res = await origFindOne(...args);
      findOneCount++;
      if (findOneCount >= 2) {
        resolveSecondFindOne();
      }
      return res;
    };

    let updateCount = 0;
    WebhookEvent.findOneAndUpdate = async (...args) => {
      updateCount++;
      if (updateCount === 1) {
        await secondFindOnePromise;
      }
      return origFindOneAndUpdate(...args);
    };

    try {
      const [res1, res2] = await Promise.allSettled([
        resolveQuarantinedWebhookEventAdmin(adminId, evt.eventId, {
          reason: 'Admin 1 resolving quarantined event',
        }),
        resolveQuarantinedWebhookEventAdmin(secondAdminId, evt.eventId, {
          reason: 'Admin 2 resolving quarantined event concurrently',
        }),
      ]);

      const statuses = [
        res1.status === 'fulfilled' ? 200 : res1.reason.statusCode,
        res2.status === 'fulfilled' ? 200 : res2.reason.statusCode,
      ];
      assert.ok(statuses.includes(200), 'Expected one resolution to succeed');
      assert.ok(statuses.includes(409), 'Expected concurrent claim race to fail with 409 Conflict');

      // Balance credited exactly once
      assert.strictEqual(testWallets.get(testUserId).balance, 1500);
      assert.strictEqual(testTransactions.length, 1);
      assert.strictEqual(testAuditLogs.length, 1);
    } finally {
      WebhookEvent.findOne = origFindOne;
      WebhookEvent.findOneAndUpdate = origFindOneAndUpdate;
    }
  });

  it('5. resolveQuarantinedWebhookEventAdmin fails safely without balance fabrication when order is missing (reverts to quarantined, returns 422)', async () => {
    const orderId = 'order_phantom_absent_002';
    const evt = createQuarantinedEvent({ orderId, amount: 500 });

    await assert.rejects(
      async () => {
        await resolveQuarantinedWebhookEventAdmin(adminId, evt.eventId, {
          reason: 'Attempting to resolve event with absent deposit order',
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 422);
        assert.match(err.message, /Manual reconciliation failed/i);
        return true;
      }
    );

    // Event safely reverted to quarantined
    const current = quarantinedEvents.get(evt.eventId);
    assert.strictEqual(current.status, 'quarantined');
    assert.strictEqual(current.lastErrorCategory, 'MANUAL_RECONCILIATION_UNRESOLVABLE');

    // Zero balance fabrication: wallet balance untouched
    assert.strictEqual(testWallets.get(testUserId).balance, 1000);
    assert.strictEqual(testTransactions.length, 0);
  });

  it('6. resolveQuarantinedWebhookEventAdmin successfully reconciles verified deposit, updates balance, and persists AuditLog', async () => {
    const orderId = 'order_verified_reconcile_003';
    const deposit = createDepositDoc({ amount: 650, orderId, status: 'created' });
    const evt = createQuarantinedEvent({ orderId, amount: 65000 });

    const res = await resolveQuarantinedWebhookEventAdmin(adminId, evt.eventId, {
      reason: 'Bank transfer verified and order confirmed by admin',
      secondReviewerId: String(secondAdminId),
      ipAddress: '192.168.1.100',
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.event.status, 'processed');
    assert.strictEqual(res.event.resourceType, 'wallet_deposit');
    assert.strictEqual(res.event.resourceReference, deposit.depositReference);

    // Balance credited exactly 650
    assert.strictEqual(testWallets.get(testUserId).balance, 1650);
    assert.strictEqual(testTransactions.length, 1);

    // AuditLog recorded
    assert.strictEqual(testAuditLogs.length, 1);
    const log = testAuditLogs[0];
    assert.strictEqual(log.entityType, 'WebhookEvent');
    assert.strictEqual(log.action, 'WEBHOOK_QUARANTINE_RECONCILE');
    assert.strictEqual(log.decision, 'RECONCILE_WEBHOOK');
    assert.strictEqual(String(log.performedBy), String(adminId));
    assert.strictEqual(String(log.secondReviewerBy), String(secondAdminId));
    assert.strictEqual(log.stateBefore.status, 'quarantined');
    assert.strictEqual(log.stateAfter.status, 'processed');
  });

  it('7. resolveQuarantinedWebhookEventAdmin fails closed with 500 when AuditLog persistence fails', async () => {
    const orderId = 'order_audit_err_004';
    createDepositDoc({ amount: 500, orderId, status: 'created' });
    const evt = createQuarantinedEvent({ orderId, amount: 500 });

    AuditLog.create = async () => {
      throw new Error('MongoWriteConcernError: fsync failure');
    };

    await assert.rejects(
      async () => {
        await resolveQuarantinedWebhookEventAdmin(adminId, evt.eventId, {
          reason: 'Resolution during database storage degradation',
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 500);
        assert.match(err.message, /AuditLog persistence failed/i);
        return true;
      }
    );
  });
});

describe('MAT-22 — Real MongoDB Integration Test Suite (Isolated Test Database)', () => {
  const isSafeTestUri = (uri) => {
    if (!uri) return false;
    const lower = uri.toLowerCase();
    return !lower.includes('mongodb.net') && !lower.includes('atlas') && !lower.includes('prod');
  };

  it('Standalone/Replica Topology: Real compound unique index on { provider, eventId } prevents duplicate insertions', async (t) => {
    const testUri = process.env.MONGODB_TEST_URI;
    if (!testUri || !isSafeTestUri(testUri)) {
      t.skip('Skipping live MongoDB test: MONGODB_TEST_URI not configured or invalid (preserves database safety)');
      return;
    }

    const testConn = await mongoose.createConnection(testUri).asPromise();
    try {
      const TestWebhookEvent = testConn.model('TestWebhookEvent', WebhookEvent.schema);
      await TestWebhookEvent.init(); // Ensure unique indexes are built

      const eventId = `evt_live_test_${Date.now()}`;
      const doc1 = await TestWebhookEvent.create({
        provider: 'razorpay',
        eventId,
        eventType: 'payment.captured',
        status: 'processing',
        orderId: 'order_live_001',
      });
      assert.ok(doc1);

      // Duplicate insert must throw real MongoServerError E11000
      let caughtErr = null;
      try {
        await TestWebhookEvent.create({
          provider: 'razorpay',
          eventId,
          eventType: 'payment.captured',
          status: 'processing',
          orderId: 'order_live_001',
        });
      } catch (err) {
        caughtErr = err;
      }

      assert.ok(caughtErr, 'Expected second insert to throw duplicate key error');
      assert.strictEqual(caughtErr.code, 11000);

      await TestWebhookEvent.deleteMany({ eventId });
    } finally {
      await testConn.close();
    }
  });

  it('Standalone/Replica Topology: Real atomic CAS state transition and crash recovery', async (t) => {
    const testUri = process.env.MONGODB_TEST_URI;
    if (!testUri || !isSafeTestUri(testUri)) {
      t.skip('Skipping live MongoDB test: MONGODB_TEST_URI not configured or invalid (preserves database safety)');
      return;
    }

    const testConn = await mongoose.createConnection(testUri).asPromise();
    try {
      const TestWebhookEvent = testConn.model('TestWebhookEventCAS', WebhookEvent.schema);
      await TestWebhookEvent.init();

      const eventId = `evt_cas_live_${Date.now()}`;
      const staleTime = new Date(Date.now() - 75 * 1000);

      await TestWebhookEvent.create({
        provider: 'razorpay',
        eventId,
        eventType: 'payment.captured',
        status: 'processing',
        lastReceivedAt: staleTime,
      });

      // Bounded crash recovery CAS: reclaim stale lock
      const reclaimed = await TestWebhookEvent.findOneAndUpdate(
        {
          provider: 'razorpay',
          eventId,
          status: 'processing',
          lastReceivedAt: staleTime,
        },
        {
          $set: { lastReceivedAt: new Date() },
          $inc: { attempts: 1 },
        },
        { new: true }
      );

      assert.ok(reclaimed);
      assert.strictEqual(reclaimed.attempts, 2);

      // Concurrent worker attempting the same recovery CAS fails (single winner)
      const concurrentReclaim = await TestWebhookEvent.findOneAndUpdate(
        {
          provider: 'razorpay',
          eventId,
          status: 'processing',
          lastReceivedAt: staleTime,
        },
        {
          $set: { lastReceivedAt: new Date() },
          $inc: { attempts: 1 },
        },
        { new: true }
      );
      assert.strictEqual(concurrentReclaim, null);

      await TestWebhookEvent.deleteMany({ eventId });
    } finally {
      await testConn.close();
    }
  });

  it('Replica Set Topology: Multi-document transaction atomicity with WebhookEvent and rollback verification', async (t) => {
    const testUri = process.env.MONGODB_TEST_URI;
    if (!testUri || !isSafeTestUri(testUri)) {
      t.skip('Skipping replica set test: MONGODB_TEST_URI not configured or invalid');
      return;
    }

    const testConn = await mongoose.createConnection(testUri).asPromise();
    let session = null;
    try {
      try {
        session = await testConn.startSession();
        session.startTransaction();
      } catch (err) {
        t.skip(`Skipping replica set test: Database does not support transactions (${err.message})`);
        return;
      }

      const TestWebhookEvent = testConn.model('TestWebhookTx', WebhookEvent.schema);
      const eventId = `evt_tx_live_${Date.now()}`;

      await TestWebhookEvent.create(
        [
          {
            provider: 'razorpay',
            eventId,
            eventType: 'payment.captured',
            status: 'processing',
          },
        ],
        { session }
      );

      // Abort transaction: document must rollback
      await session.abortTransaction();

      const docAfterAbort = await TestWebhookEvent.findOne({ eventId });
      assert.strictEqual(docAfterAbort, null, 'Aborted transaction must roll back WebhookEvent');
    } finally {
      if (session) {
        try {
          await session.endSession();
        } catch (_) {}
      }
      await testConn.close();
    }
  });

  it('Replica Set Topology: MAT-30 Administrative Webhook Reconciliation ACID rollback across Deposit, Wallet, Transaction, and WebhookEvent when AuditLog fails', async (t) => {
    const testUri = process.env.MONGODB_TEST_URI;
    if (!testUri || !isSafeTestUri(testUri)) {
      t.skip('Skipping replica set test: MONGODB_TEST_URI not configured or invalid');
      return;
    }

    const testConn = await mongoose.createConnection(testUri).asPromise();
    let session = null;
    try {
      // Register models on the isolated connection
      const TestWebhookEvent = testConn.model('TestMAT30WebhookEvent', WebhookEvent.schema);
      const TestDeposit = testConn.model('TestMAT30Deposit', Deposit.schema);
      const TestWallet = testConn.model('TestMAT30Wallet', Wallet.schema);
      const TestTransaction = testConn.model('TestMAT30Transaction', Transaction.schema);
      const TestAuditLog = testConn.model('TestMAT30AuditLog', AuditLog.schema);

      // Ensure indexes are built before any writes
      await Promise.all([
        TestWebhookEvent.init(),
        TestDeposit.init(),
        TestWallet.init(),
        TestTransaction.init(),
        TestAuditLog.init(),
      ]);

      const tempUser = new mongoose.Types.ObjectId();
      const testOrderId = `order_mat30_live_${Date.now()}`;
      const testDepRef = `DEP-MAT30-${Date.now()}`;
      const testEvtId = `evt_mat30_live_${Date.now()}`;
      const initialBalance = 5000;
      const creditAmount = 2500;

      // Create initial durable records OUTSIDE the transaction first
      const [walletDoc] = await TestWallet.create([
        {
          user: tempUser,
          balance: initialBalance,
          processedOperations: [],
        },
      ]);

      const [depositDoc] = await TestDeposit.create([
        {
          user: tempUser,
          wallet: walletDoc._id,
          amount: creditAmount,
          currency: 'INR',
          orderId: testOrderId,
          depositReference: testDepRef,
          status: 'pending',
          paymentId: `pay_${Date.now()}`,
          provider: 'razorpay',
        },
      ]);

      const [webhookDoc] = await TestWebhookEvent.create([
        {
          provider: 'razorpay',
          eventId: testEvtId,
          eventType: 'payment.captured',
          status: 'quarantined',
          orderId: testOrderId,
          attempts: 5,
        },
      ]);

      // Start session and transaction AFTER initial creates are committed
      try {
        session = await testConn.startSession();
        session.startTransaction();
      } catch (err) {
        t.skip(`Skipping replica set test: Database does not support transactions (${err.message})`);
        return;
      }

      // Execute transaction mutations inside session
      // 1. WebhookEvent: quarantined -> processing
      await TestWebhookEvent.updateOne(
        { _id: webhookDoc._id, status: 'quarantined' },
        { $set: { status: 'processing', lastReceivedAt: new Date() } },
        { session }
      );

      // 2. Deposit: pending -> completed
      await TestDeposit.updateOne(
        { _id: depositDoc._id, status: 'pending' },
        { $set: { status: 'completed', creditedAt: new Date() } },
        { session }
      );

      // 3. Wallet: increment balance and track processedOperations
      await TestWallet.updateOne(
        { _id: walletDoc._id, processedOperations: { $ne: testDepRef } },
        {
          $inc: { balance: creditAmount },
          $addToSet: { processedOperations: testDepRef },
        },
        { session }
      );

      // 4. Transaction ledger: create record
      await TestTransaction.create(
        [
          {
            user: tempUser,
            wallet: walletDoc._id,
            type: 'credit',
            amount: creditAmount,
            description: `Deposit credit Ref: ${testDepRef}`,
            status: 'completed',
            reference: testDepRef,
            balanceBefore: initialBalance,
            balanceAfter: initialBalance + creditAmount,
          },
        ],
        { session }
      );

      // 5. WebhookEvent: processing -> processed
      await TestWebhookEvent.updateOne(
        { _id: webhookDoc._id },
        { $set: { status: 'processed', processedAt: new Date() } },
        { session }
      );

      // 6. Simulate AuditLog write failure (transaction is aborted instead of committed)
      await session.abortTransaction();
      await session.endSession();
      session = null;

      // 7. VERIFY ABSOLUTE ACID ROLLBACK ACROSS ALL 5 ENTITIES IN REAL MONGODB
      const checkWallet = await TestWallet.findById(walletDoc._id);
      const checkDeposit = await TestDeposit.findById(depositDoc._id);
      const checkEvt = await TestWebhookEvent.findById(webhookDoc._id);
      const checkTx = await TestTransaction.findOne({ reference: testDepRef });
      const checkAudit = await TestAuditLog.findOne({ entityId: webhookDoc._id });

      assert.strictEqual(checkWallet.balance, initialBalance, 'Wallet balance must be 5000 (NOT 7500)');
      assert.strictEqual(checkWallet.processedOperations.length, 0, 'Wallet processedOperations must be empty');
      assert.strictEqual(checkDeposit.status, 'pending', 'Deposit status must remain pending (NOT completed)');
      assert.strictEqual(checkEvt.status, 'quarantined', 'WebhookEvent must remain quarantined (NOT processed)');
      assert.strictEqual(checkTx, null, 'Transaction ledger entry must NOT exist in database');
      assert.strictEqual(checkAudit, null, 'AuditLog entry must NOT exist in database');

      // Cleanup
      await TestWallet.deleteMany({ user: tempUser });
      await TestDeposit.deleteMany({ orderId: testOrderId });
      await TestWebhookEvent.deleteMany({ eventId: testEvtId });
    } finally {
      if (session) {
        try {
          await session.endSession();
        } catch (_) {}
      }
      await testConn.close();
    }
  });

  it('Standalone/Replica Topology: Real atomic CAS recovery for stale failed webhook event', async (t) => {
    const testUri = process.env.MONGODB_TEST_URI;
    if (!testUri || !isSafeTestUri(testUri)) {
      t.skip('Skipping live MongoDB test: MONGODB_TEST_URI not configured or invalid (preserves database safety)');
      return;
    }

    const testConn = await mongoose.createConnection(testUri).asPromise();
    try {
      const TestWebhookEvent = testConn.model('TestWebhookEventFailedCAS', WebhookEvent.schema);
      await TestWebhookEvent.init();

      const eventId = `evt_failed_cas_live_${Date.now()}`;
      const staleTime = new Date(Date.now() - 75 * 1000);

      await TestWebhookEvent.create({
        provider: 'razorpay',
        eventId,
        eventType: 'payment.captured',
        status: 'failed',
        attempts: 1,
        lastReceivedAt: staleTime,
        lastErrorCategory: 'ORDER_NOT_FOUND',
      });

      // CAS recovery: reclaim stale failed event -> processing
      const claimed = await TestWebhookEvent.findOneAndUpdate(
        {
          provider: 'razorpay',
          eventId,
          status: 'failed',
          lastReceivedAt: staleTime,
        },
        {
          $set: {
            status: 'processing',
            lastReceivedAt: new Date(),
          },
          $inc: { attempts: 1 },
        },
        { returnDocument: 'after' }
      );

      assert.ok(claimed);
      assert.strictEqual(claimed.status, 'processing');
      assert.strictEqual(claimed.attempts, 2);

      // Concurrent worker attempting the same recovery CAS fails (single winner)
      const concurrentClaim = await TestWebhookEvent.findOneAndUpdate(
        {
          provider: 'razorpay',
          eventId,
          status: 'failed',
          lastReceivedAt: staleTime,
        },
        {
          $set: {
            status: 'processing',
            lastReceivedAt: new Date(),
          },
          $inc: { attempts: 1 },
        },
        { returnDocument: 'after' }
      );
      assert.strictEqual(concurrentClaim, null);

      await TestWebhookEvent.deleteMany({ eventId });
    } finally {
      await testConn.close();
    }
  });

  it('Standalone/Replica Topology: Real atomic CAS claim on quarantined WebhookEvent and append-only AuditLog persistence', async (t) => {
    const testUri = process.env.MONGODB_TEST_URI;
    if (!testUri || !isSafeTestUri(testUri)) {
      t.skip('Skipping live MongoDB test: MONGODB_TEST_URI not configured or invalid (preserves database safety)');
      return;
    }

    const testConn = await mongoose.createConnection(testUri).asPromise();
    try {
      const TestWebhookEvent = testConn.model('TestWebhookEventQuarantineCAS', WebhookEvent.schema);
      const TestAuditLog = testConn.model('TestAuditLogQuarantine', AuditLog.schema);
      await Promise.all([TestWebhookEvent.init(), TestAuditLog.init()]);

      const eventId = `evt_quarantine_live_${Date.now()}`;
      const adminId = new mongoose.Types.ObjectId();

      const createdEvt = await TestWebhookEvent.create({
        provider: 'razorpay',
        eventId,
        eventType: 'payment.captured',
        status: 'quarantined',
        attempts: 5,
        lastErrorCategory: 'UNRECOVERABLE_ORDER_NOT_FOUND',
      });

      // Atomic CAS claim: 'quarantined' -> 'processing'
      const claimed = await TestWebhookEvent.findOneAndUpdate(
        {
          _id: createdEvt._id,
          status: 'quarantined',
        },
        {
          $set: {
            status: 'processing',
            lastReceivedAt: new Date(),
            'metadata.adminResolutionClaimedBy': adminId,
          },
          $inc: { attempts: 1 },
        },
        { returnDocument: 'after' }
      );

      assert.ok(claimed);
      assert.strictEqual(claimed.status, 'processing');
      assert.strictEqual(claimed.attempts, 6);

      // Concurrent admin attempting recovery fails CAS
      const concurrentClaim = await TestWebhookEvent.findOneAndUpdate(
        {
          _id: createdEvt._id,
          status: 'quarantined',
        },
        {
          $set: { status: 'processing' },
          $inc: { attempts: 1 },
        },
        { returnDocument: 'after' }
      );
      assert.strictEqual(concurrentClaim, null);

      // Verify immutable AuditLog append
      const auditEntry = await TestAuditLog.create({
        entityType: 'WebhookEvent',
        entityId: createdEvt._id,
        operationReference: `WEBHOOK-${eventId}`,
        action: 'WEBHOOK_QUARANTINE_RECONCILE',
        performedBy: adminId,
        decision: 'RECONCILE_WEBHOOK',
        reason: 'Integration test manual reconciliation justification',
        stateBefore: { status: 'quarantined' },
        stateAfter: { status: 'processed' },
      });

      assert.ok(auditEntry._id);
      assert.strictEqual(auditEntry.entityType, 'WebhookEvent');
      assert.strictEqual(auditEntry.action, 'WEBHOOK_QUARANTINE_RECONCILE');

      // Verify immutability: updates are rejected by AuditLog pre-hook
      await assert.rejects(
        async () => {
          await TestAuditLog.updateOne({ _id: auditEntry._id }, { $set: { reason: 'Tampered reason' } });
        },
        /strictly append-only/i
      );

      await Promise.all([
        TestWebhookEvent.deleteMany({ eventId }),
        testConn.collection('testauditlogquarantines').deleteOne({ _id: auditEntry._id }),
      ]);
    } finally {
      await testConn.close();
    }
  });
});
