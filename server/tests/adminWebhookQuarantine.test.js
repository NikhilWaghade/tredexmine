import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { Deposit } from '../src/models/Deposit.js';
import { Payment } from '../src/models/Payment.js';
import { Transaction } from '../src/models/Transaction.js';
import { WebhookEvent } from '../src/models/WebhookEvent.js';
import { Withdrawal } from '../src/models/Withdrawal.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { generateAccessToken } from '../src/utils/tokenService.js';

describe('MAT-28 — Secure Admin Webhook Quarantine Management Tests', () => {
  let server;
  let baseUrl;

  const mockAdminId = new mongoose.Types.ObjectId();
  const mockSecondAdminId = new mongoose.Types.ObjectId();
  const mockRegularUserId = new mongoose.Types.ObjectId();
  const targetUserId = new mongoose.Types.ObjectId();
  const targetWalletId = new mongoose.Types.ObjectId();

  const mockAdminUser = {
    _id: mockAdminId,
    name: 'Primary Admin',
    email: 'admin1@example.com',
    role: 'admin',
    isActive: true,
  };

  const mockSecondAdminUser = {
    _id: mockSecondAdminId,
    name: 'Secondary Admin',
    email: 'admin2@example.com',
    role: 'admin',
    isActive: true,
  };

  const mockRegularUser = {
    _id: mockRegularUserId,
    name: 'Regular Customer',
    email: 'user@example.com',
    role: 'user',
    isActive: true,
  };

  let adminToken;
  let secondAdminToken;
  let userToken;

  let users;
  let webhookEvents;
  let deposits;
  let wallets;
  let transactions;
  let auditLogs;
  let payments;
  let withdrawals;

  let origReadyState;
  let origClient;
  let origStartSession;
  let mockSession;
  let sessionSpy;

  let origUserFindById;
  let origWithdrawalFind;
  let origWithdrawalCountDocuments;
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

  before(async () => {
    process.env.JWT_SECRET = 'test_jwt_secret_min_32_characters_long_for_security';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret_key_1234567890';

    adminToken = generateAccessToken({ id: mockAdminId, role: 'admin' });
    secondAdminToken = generateAccessToken({ id: mockSecondAdminId, role: 'admin' });
    userToken = generateAccessToken({ id: mockRegularUserId, role: 'user' });

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    users = new Map();
    webhookEvents = new Map();
    deposits = new Map();
    wallets = new Map();
    transactions = [];
    auditLogs = [];
    payments = new Map();
    withdrawals = new Map();

    users.set(String(mockAdminId), mockAdminUser);
    users.set(String(mockSecondAdminId), mockSecondAdminUser);
    users.set(String(mockRegularUserId), mockRegularUser);

    wallets.set(String(targetUserId), {
      _id: targetWalletId,
      user: targetUserId,
      balance: 1000,
      processedOperations: [],
    });

    origReadyState = mongoose.connection?.readyState;
    origClient = mongoose.connection?.client;
    origStartSession = mongoose.startSession;

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
          deposits: new Map(Array.from(deposits.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
          wallets: new Map(Array.from(wallets.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
          transactions: transactions.map((t) => ({ ...t })),
          webhookEvents: new Map(Array.from(webhookEvents.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
          auditLogs: auditLogs.map((a) => ({ ...a })),
        };
      },
      commitTransaction: async () => {
        sessionSpy.commitCount++;
        activeSnapshot = null;
      },
      abortTransaction: async () => {
        sessionSpy.abortCount++;
        if (activeSnapshot) {
          deposits.clear();
          for (const [k, v] of activeSnapshot.deposits.entries()) deposits.set(k, v);
          wallets.clear();
          for (const [k, v] of activeSnapshot.wallets.entries()) wallets.set(k, v);
          transactions.length = 0;
          transactions.push(...activeSnapshot.transactions);
          webhookEvents.clear();
          for (const [k, v] of activeSnapshot.webhookEvents.entries()) webhookEvents.set(k, v);
          auditLogs.length = 0;
          auditLogs.push(...activeSnapshot.auditLogs);
          activeSnapshot = null;
        }
      },
      endSession: async () => {
        sessionSpy.endCount++;
      },
      inTransaction: () => activeSnapshot !== null,
    };

    mongoose.startSession = async () => mockSession;

    origUserFindById = User.findById;
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
    origWithdrawalFind = Withdrawal.find;
    origWithdrawalCountDocuments = Withdrawal.countDocuments;

    Withdrawal.countDocuments = async (filter = {}) => {
      let count = 0;
      for (const w of withdrawals.values()) {
        if (filter['metadata.reconciliationRequiresManualReview'] && !w.metadata?.reconciliationRequiresManualReview) continue;
        count++;
      }
      return count;
    };

    Withdrawal.find = (query = {}) => {
      let filtered = Array.from(withdrawals.values());
      if (query['metadata.reconciliationRequiresManualReview']) {
        filtered = filtered.filter((w) => Boolean(w.metadata?.reconciliationRequiresManualReview));
      }
      const chain = {
        populate: () => chain,
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

    User.findById = (id) => ({
      select: () => Promise.resolve(users.get(String(id)) || null),
      then: (resolve) => resolve(users.get(String(id)) || null),
    });

    WebhookEvent.countDocuments = async (filter = {}) => {
      let count = 0;
      for (const evt of webhookEvents.values()) {
        if (filter.status && evt.status !== filter.status) continue;
        count++;
      }
      return count;
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
      for (const evt of webhookEvents.values()) {
        if (query.$or && Array.isArray(query.$or)) {
          const match = query.$or.some((clause) => {
            if (clause._id && String(evt._id) === String(clause._id)) return true;
            if (clause.eventId && evt.eventId === clause.eventId) return true;
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
      for (const evt of webhookEvents.values()) {
        if (String(evt._id) === String(id)) return { ...evt };
      }
      return null;
    };

    WebhookEvent.findOneAndUpdate = async (query, update, opts = {}) => {
      for (const [key, evt] of webhookEvents.entries()) {
        let match = true;
        if (query._id && String(evt._id) !== String(query._id)) match = false;
        if (query.eventId && evt.eventId !== query.eventId) match = false;
        if (query.status && evt.status !== query.status) match = false;
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
    Withdrawal.find = origWithdrawalFind;
    Withdrawal.countDocuments = origWithdrawalCountDocuments;

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

  const createMockQuarantinedEvent = (opts = {}) => {
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
        secretHeader: 'SHOULD_NOT_LEAK_IN_RESPONSE',
        rawSignature: 'HEX_SIGNATURE_SHOULD_NOT_LEAK',
      },
    };
    webhookEvents.set(eventId, doc);
    return doc;
  };

  const createMockDeposit = (opts = {}) => {
    const depositId = new mongoose.Types.ObjectId();
    const depositReference = opts.depositReference || `DEP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const orderId = opts.orderId || `order_${Date.now()}`;
    const amount = opts.amount || 500;

    const doc = {
      _id: depositId,
      user: targetUserId,
      wallet: targetWalletId,
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

  // --------------------------------------------------------------------------
  // TEST GROUP 1: AUTHORIZATION AND AUTHENTICATION GUARDS
  // --------------------------------------------------------------------------
  describe('1. Authentication & Role-Based Authorization Enforcement', () => {
    it('rejects unauthenticated GET /admin/webhooks/quarantined with 401', async () => {
      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/quarantined`);
      assert.strictEqual(res.status, 401);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.match(json.message, /not authorized|access token missing/i);
    });

    it('rejects non-admin role (user) on GET /admin/webhooks/quarantined with 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/quarantined`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      assert.strictEqual(res.status, 403);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.match(json.message, /forbidden|insufficient permissions/i);
    });

    it('rejects unauthenticated POST /admin/webhooks/:id/reconcile with 401', async () => {
      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/some_evt_id/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Valid justification reason here' }),
      });
      assert.strictEqual(res.status, 401);
    });

    it('rejects non-admin role (user) on POST /admin/webhooks/:id/reconcile with 403', async () => {
      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/some_evt_id/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Valid justification reason here' }),
      });
      assert.strictEqual(res.status, 403);
    });
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 2: SAFE PAGINATED QUARANTINE LISTING
  // --------------------------------------------------------------------------
  describe('2. Read-Only Quarantine Listing & Projection Safety', () => {
    it('returns paginated list of quarantined webhooks with safe diagnostic fields only', async () => {
      for (let i = 1; i <= 5; i++) {
        createMockQuarantinedEvent({ eventId: `evt_test_page_${i}`, amount: i * 10000 });
      }

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/quarantined?page=1&limit=2`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(res.status, 200);
      const json = await res.json();

      assert.strictEqual(json.success, true);
      assert.strictEqual(json.count, 2);
      assert.strictEqual(json.total, 5);
      assert.strictEqual(json.page, 1);
      assert.strictEqual(json.pages, 3);
      assert.strictEqual(json.events.length, 2);

      // Verify safe fields exist
      const first = json.events[0];
      assert.ok(first.eventId);
      assert.ok(first.provider);
      assert.strictEqual(first.status, 'quarantined');
      assert.strictEqual(first.requiresManualReview, true);

      // Verify sensitive metadata was stripped (NO secretHeader, NO rawSignature)
      assert.strictEqual(first.metadata, undefined);
      assert.strictEqual(first.secretHeader, undefined);
      assert.strictEqual(first.rawSignature, undefined);
    });

    it('enforces bounded limit and handles invalid pagination parameters safely', async () => {
      createMockQuarantinedEvent({ eventId: 'evt_bounds_check' });

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/quarantined?page=-5&limit=9999`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.page, 1); // Defaults to page 1
    });
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 3: INPUT VALIDATION & TAMPERING PREVENTION
  // --------------------------------------------------------------------------
  describe('3. Reconciliation Input Validation & Tampering Guards', () => {
    it('rejects missing or short justification reason (<10 characters) with 400', async () => {
      const evt = createMockQuarantinedEvent();

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Too short' }),
      });

      assert.strictEqual(res.status, 400);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.match(json.errors[0], /minimum 10 characters/i);
    });

    it('strictly rejects requests attempting to inject arbitrary amount or balance overrides', async () => {
      const evt = createMockQuarantinedEvent();

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Valid justification reason with attempted financial tampering',
          amount: 99999,
          balance: 88888,
        }),
      });

      assert.strictEqual(res.status, 400);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.ok(json.errors.some((e) => e.includes('not permitted')));
    });

    it('returns 404 for non-existent webhook event ID', async () => {
      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/non_existent_evt_999/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Valid justification reason for non-existent record' }),
      });

      assert.strictEqual(res.status, 404);
      const json = await res.json();
      assert.match(json.message, /not found/i);
    });

    it('rejects events that are not in quarantined status (e.g. already processed) with 400', async () => {
      const evt = createMockQuarantinedEvent({ status: 'processed' });

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Valid reason on already processed event' }),
      });

      assert.strictEqual(res.status, 400);
      const json = await res.json();
      assert.match(json.message, /Only quarantined webhook events can be manually reconciled/i);
    });
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 4: ATOMIC CONCURRENCY & RACE CONDITIONS
  // --------------------------------------------------------------------------
  describe('4. Atomic Concurrency & Dual-Administrator Race Protection', () => {
    it('prevents concurrent administrators from double-reconciling the same quarantined event (409 Conflict)', async () => {
      const orderId = 'order_concurrent_mat28_001';
      createMockDeposit({ amount: 500, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId, amount: 500 });

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
        // Two administrators click resolve at the exact same moment
        const [res1, res2] = await Promise.all([
          fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${adminToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ reason: 'Admin 1 resolving verified deposit order' }),
          }),
          fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${secondAdminToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ reason: 'Admin 2 resolving verified deposit order' }),
          }),
        ]);

        const statuses = [res1.status, res2.status];
        assert.ok(statuses.includes(200), 'Expected one resolution to succeed with 200');
        assert.ok(statuses.includes(409), 'Expected concurrent claim race to reject with 409 Conflict');

        // Financial balance credited exactly once (1000 + 500 = 1500)
        assert.strictEqual(wallets.get(String(targetUserId)).balance, 1500);

        // Ledger written exactly once
        assert.strictEqual(transactions.length, 1);

        // AuditLog recorded exactly once
        assert.strictEqual(auditLogs.length, 1);
      } finally {
        WebhookEvent.findOne = origFindOne;
        WebhookEvent.findOneAndUpdate = origFindOneAndUpdate;
      }
    });
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 5: FINANCIAL INTEGRITY & SAFE RECONCILIATION
  // --------------------------------------------------------------------------
  describe('5. Verified Financial Reconciliation & Audit Logging', () => {
    it('successfully reconciles quarantined event when valid deposit order is verified', async () => {
      const orderId = 'order_valid_reconcile_002';
      const deposit = createMockDeposit({ amount: 750, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId, amount: 75000 });

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Customer completed payment and bank slip confirmed by administrative review',
          secondReviewerId: String(mockSecondAdminId),
        }),
      });

      assert.strictEqual(res.status, 200);
      const json = await res.json();

      assert.strictEqual(json.success, true);
      assert.strictEqual(json.event.status, 'processed');
      assert.strictEqual(json.event.resourceType, 'wallet_deposit');
      assert.strictEqual(json.event.resourceReference, deposit.depositReference);

      // Wallet credited exactly 750
      assert.strictEqual(wallets.get(String(targetUserId)).balance, 1750);
      assert.strictEqual(transactions.filter((t) => t.reference === deposit.depositReference).length, 1);

      // AuditLog recorded with complete immutable trail
      assert.strictEqual(auditLogs.length, 1);
      const log = auditLogs[0];
      assert.strictEqual(log.entityType, 'WebhookEvent');
      assert.strictEqual(log.action, 'WEBHOOK_QUARANTINE_RECONCILE');
      assert.strictEqual(log.decision, 'RECONCILE_WEBHOOK');
      assert.strictEqual(String(log.performedBy), String(mockAdminId));
      assert.strictEqual(String(log.secondReviewerBy), String(mockSecondAdminId));
      assert.strictEqual(log.stateBefore.status, 'quarantined');
      assert.strictEqual(log.stateAfter.status, 'processed');
    });

    it('aliases /resolve-quarantine endpoint cleanly to reconciliation handler', async () => {
      const orderId = 'order_alias_reconcile_003';
      const deposit = createMockDeposit({ amount: 300, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId, amount: 30000 });

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/resolve-quarantine`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Resolving quarantined webhook via route alias',
        }),
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(wallets.get(String(targetUserId)).balance, 1300);
    });
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 6: FAILURE SAFETY & ZERO BALANCE FABRICATION
  // --------------------------------------------------------------------------
  describe('6. Failure Safety, Missing Orders & Audit Fail-Closed', () => {
    it('leaves event quarantined and rejects with 422 if order is still missing (never invents balances)', async () => {
      const orderId = 'order_phantom_unresolvable_004'; // No deposit or payment exists
      const evt = createMockQuarantinedEvent({ orderId, amount: 500 });

      const initialBalance = wallets.get(String(targetUserId)).balance;
      assert.strictEqual(initialBalance, 1000);

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Manual review attempt on absent order',
        }),
      });

      assert.strictEqual(res.status, 422);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.match(json.message, /Manual reconciliation failed/i);

      // Event remains safely in quarantined state!
      const currentEvt = webhookEvents.get(evt.eventId);
      assert.strictEqual(currentEvt.status, 'quarantined');
      assert.strictEqual(currentEvt.lastErrorCategory, 'MANUAL_RECONCILIATION_UNRESOLVABLE');

      // Wallet balance completely untouched (0 balance fabrication)
      assert.strictEqual(wallets.get(String(targetUserId)).balance, 1000);
      assert.strictEqual(transactions.length, 0);
    });

    it('fails closed with 500 and prevents silent success if AuditLog persistence fails', async () => {
      const orderId = 'order_audit_fail_005';
      const deposit = createMockDeposit({ amount: 500, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId });

      const initialWalletBalance = wallets.get(String(targetUserId)).balance;
      assert.strictEqual(initialWalletBalance, 1000);

      // Force AuditLog to throw storage error
      AuditLog.create = async () => {
        throw new Error('MongoWriteConcernException: Journal flush failed');
      };

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Attempting resolution during audit storage failure',
        }),
      });

      // Must fail closed with 500 error!
      assert.strictEqual(res.status, 500);
      const json = await res.json();
      assert.match(json.message, /AuditLog persistence failed/i);

      // PROVE TRANSACTION ROLLBACK (MAT-30):
      // 1. Transaction abort was triggered
      assert.strictEqual(sessionSpy.abortCount >= 1, true, 'session.abortTransaction must be called on audit failure');
      // 2. Wallet balance must be strictly untouched (1000, NOT 1500)
      assert.strictEqual(wallets.get(String(targetUserId)).balance, 1000, 'Wallet balance must be rolled back');
      // 3. Deposit status must remain 'created', not 'completed'
      assert.strictEqual(deposits.get(String(deposit._id)).status, 'created', 'Deposit status must be rolled back');
      // 4. Ledger transaction record must not exist
      assert.strictEqual(transactions.filter((t) => t.reference === deposit.depositReference).length, 0, 'Ledger entry must be rolled back');
      // 5. Webhook event must remain quarantined
      assert.strictEqual(webhookEvents.get(evt.eventId).status, 'quarantined', 'WebhookEvent status must be rolled back to quarantined');
      // 6. Zero audit logs committed
      assert.strictEqual(auditLogs.length, 0, 'AuditLog must be empty');
    });
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 7: REPEATED RESOLUTION ATTEMPTS (IDEMPOTENCY)
  // --------------------------------------------------------------------------
  describe('7. Repeated Resolution Idempotency Defense', () => {
    it('rejects subsequent resolution calls once event has been processed (no double credit)', async () => {
      const orderId = 'order_repeated_attempt_006';
      createMockDeposit({ amount: 450, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId });

      // 1. First resolution call succeeds
      const res1 = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'First successful administrative resolution' }),
      });
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(wallets.get(String(targetUserId)).balance, 1450);

      // 2. Second resolution call for same event must be rejected
      const res2 = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Duplicate attempt to resolve already processed event' }),
      });

      assert.strictEqual(res2.status, 400);
      const json2 = await res2.json();
      assert.match(json2.message, /Only quarantined webhook events can be manually reconciled/i);

      // Wallet balance remains strictly 1450 (NO second credit)
      assert.strictEqual(wallets.get(String(targetUserId)).balance, 1450);
      assert.strictEqual(transactions.length, 1);
    });
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 8: EXISTING WITHDRAWAL & DEPOSIT ADMIN ROUTES REGRESSION
  // --------------------------------------------------------------------------
  describe('8. Existing Withdrawal & Deposit Admin Routes Regression', () => {
    it('rejects unauthenticated GET /api/v1/wallet/admin/withdrawals/quarantined with 401', async () => {
      const res = await fetch(`${baseUrl}/api/v1/wallet/admin/withdrawals/quarantined`);
      assert.strictEqual(res.status, 401);
    });

    it('rejects non-admin role on GET /api/v1/wallet/admin/withdrawals/quarantined with 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/v1/wallet/admin/withdrawals/quarantined`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      assert.strictEqual(res.status, 403);
    });

    it('successfully serves GET /api/v1/wallet/admin/withdrawals/quarantined for authenticated admin', async () => {
      const mockWithdrawalId = new mongoose.Types.ObjectId();
      withdrawals.set(String(mockWithdrawalId), {
        _id: mockWithdrawalId,
        withdrawalReference: 'WD-TEST-001',
        amount: 250,
        currency: 'INR',
        status: 'pending',
        user: { _id: targetUserId, name: 'Target User', email: 'target@example.com' },
        payoutMethod: 'bank_transfer',
        payoutDetails: { maskedIdentifier: '******1234' },
        metadata: {
          reconciliationRequiresManualReview: true,
          reconciliationReason: 'Ledger mismatch detected',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await fetch(`${baseUrl}/api/v1/wallet/admin/withdrawals/quarantined`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.count, 1);
      assert.strictEqual(json.withdrawals[0].withdrawalReference, 'WD-TEST-001');
    });

    it('successfully serves GET /api/v1/wallet/admin/withdrawals for authenticated admin', async () => {
      const res = await fetch(`${baseUrl}/api/v1/wallet/admin/withdrawals`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
    });
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 9: MAT-30 ATOMIC TRANSACTION ROLLBACK & STANDALONE FAIL-CLOSED
  // --------------------------------------------------------------------------
  describe('9. MAT-30: Atomic Transaction Rollback & Standalone Fail-Closed Tests', () => {
    it('AuditLog creation failure rolls back all transactional financial mutations', async () => {
      const orderId = 'order_mat30_audit_rollback_001';
      const deposit = createMockDeposit({ amount: 800, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId, amount: 80000 });

      const initialWallet = wallets.get(String(targetUserId)).balance;
      assert.strictEqual(initialWallet, 1000);

      // Force AuditLog to throw
      AuditLog.create = async () => {
        throw new Error('MongoWriteConcernException: Primary stepped down during journal commit');
      };

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Testing complete rollback on AuditLog persistence failure',
        }),
      });

      assert.strictEqual(res.status, 500);
      const json = await res.json();
      assert.match(json.message, /AuditLog persistence failed/i);

      // 1. Transaction abort was called
      assert.strictEqual(sessionSpy.abortCount >= 1, true, 'session.abortTransaction must be called');
      // 2. Wallet balance rolled back cleanly
      assert.strictEqual(wallets.get(String(targetUserId)).balance, 1000, 'Wallet balance must be restored');
      // 3. Deposit status rolled back
      assert.strictEqual(deposits.get(String(deposit._id)).status, 'created', 'Deposit status must remain created');
      // 4. Ledger transaction rolled back
      assert.strictEqual(transactions.filter((t) => t.reference === deposit.depositReference).length, 0, 'No ledger entry should exist');
      // 5. Webhook event rolled back to quarantined
      assert.strictEqual(webhookEvents.get(evt.eventId).status, 'quarantined', 'WebhookEvent must remain quarantined');
      // 6. Zero audit logs committed
      assert.strictEqual(auditLogs.length, 0, 'Zero audit logs should be committed');
    });

    it('Wallet update failure causes transaction rollback and preserves quarantined state', async () => {
      const orderId = 'order_mat30_wallet_fail_002';
      const deposit = createMockDeposit({ amount: 600, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId, amount: 60000 });

      // Force Wallet findOneAndUpdate to fail
      Wallet.findOneAndUpdate = async () => {
        throw new Error('Database write error: Wallet connection dropped');
      };

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Testing transaction rollback when wallet credit encounters database error',
        }),
      });

      // Returns error (422 or 500)
      assert.strictEqual(res.status >= 400, true);
      assert.strictEqual(sessionSpy.abortCount >= 1, true, 'session.abortTransaction must be called');

      // State restored
      assert.strictEqual(wallets.get(String(targetUserId)).balance, 1000);
      assert.strictEqual(deposits.get(String(deposit._id)).status, 'created');
      assert.strictEqual(transactions.length, 0);
      assert.strictEqual(auditLogs.length, 0);
    });

    it('Transaction ledger creation failure triggers abort and rolls back wallet credit', async () => {
      const orderId = 'order_mat30_tx_fail_003';
      const deposit = createMockDeposit({ amount: 750, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId, amount: 75000 });

      // Force Transaction create to throw duplicate reference
      Transaction.create = async () => {
        const dupErr = new Error('E11000 duplicate key error collection: transactions index: reference_1');
        dupErr.code = 11000;
        throw dupErr;
      };

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Testing transaction rollback on ledger creation failure',
        }),
      });

      assert.strictEqual(res.status >= 400, true);
      assert.strictEqual(sessionSpy.abortCount >= 1, true);

      // Wallet credit rolled back
      assert.strictEqual(wallets.get(String(targetUserId)).balance, 1000);
      assert.strictEqual(deposits.get(String(deposit._id)).status, 'created');
      assert.strictEqual(transactions.length, 0);
      assert.strictEqual(auditLogs.length, 0);
    });

    it('Standalone MongoDB fails closed with 503 without partial financial writes', async () => {
      const orderId = 'order_mat30_standalone_004';
      const deposit = createMockDeposit({ amount: 500, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId, amount: 50000 });

      // Simulate standalone topology ('Single')
      mongoose.connection.client.topology.description.type = 'Single';

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Attempting manual reconciliation on standalone MongoDB topology',
        }),
      });

      // Must fail closed with 503 Service Unavailable
      assert.strictEqual(res.status, 503);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.match(json.message, /Multi-document ACID transactions are required/i);
      assert.match(json.message, /Replica Set topology is unavailable/i);

      // Zero financial mutations attempted
      assert.strictEqual(sessionSpy.startCount, 0, 'No transaction should be started on standalone');
      assert.strictEqual(wallets.get(String(targetUserId)).balance, 1000, 'Wallet balance untouched');
      assert.strictEqual(deposits.get(String(deposit._id)).status, 'created', 'Deposit status untouched');
      assert.strictEqual(transactions.length, 0, 'No transaction created');
      assert.strictEqual(auditLogs.length, 0, 'No audit log created');
      assert.strictEqual(webhookEvents.get(evt.eventId).status, 'quarantined', 'Event remains quarantined');
    });
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 10: MAT-30 SECOND-ADMIN VERIFICATION & HIGH-VALUE DUAL APPROVAL
  // --------------------------------------------------------------------------
  describe('10. MAT-30: Second-Admin Verification & High-Value Dual Approval Policy', () => {
    it('Valid active second administrator is accepted and recorded in the immutable AuditLog', async () => {
      const orderId = 'order_mat30_valid_second_001';
      const deposit = createMockDeposit({ amount: 500, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId, amount: 50000 });

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Reconciliation approved by primary with valid secondary reviewer',
          secondReviewerId: String(mockSecondAdminId),
        }),
      });

      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(wallets.get(String(targetUserId)).balance, 1500);

      // Verify AuditLog contains verified second reviewer
      assert.strictEqual(auditLogs.length, 1);
      assert.strictEqual(String(auditLogs[0].performedBy), String(mockAdminId));
      assert.strictEqual(String(auditLogs[0].secondReviewerBy), String(mockSecondAdminId));
      assert.strictEqual(auditLogs[0].decision, 'RECONCILE_WEBHOOK');
    });

    it('Nonexistent second reviewer ID is rejected with 400', async () => {
      const orderId = 'order_mat30_nonexistent_rev_002';
      createMockDeposit({ amount: 500, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId, amount: 50000 });

      const nonexistentId = new mongoose.Types.ObjectId();

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Attempting reconciliation with phantom reviewer ID',
          secondReviewerId: String(nonexistentId),
        }),
      });

      assert.strictEqual(res.status, 400);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.match(json.message, /Second reviewer account does not exist/i);

      // Zero financial mutations
      assert.strictEqual(wallets.get(String(targetUserId)).balance, 1000);
      assert.strictEqual(transactions.length, 0);
      assert.strictEqual(auditLogs.length, 0);
    });

    it('Non-admin reviewer account (role user) is rejected with 400', async () => {
      const orderId = 'order_mat30_non_admin_rev_003';
      createMockDeposit({ amount: 500, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId, amount: 50000 });

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Attempting reconciliation with non-admin reviewer',
          secondReviewerId: String(mockRegularUserId),
        }),
      });

      assert.strictEqual(res.status, 400);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.match(json.message, /Second reviewer must be an authorized administrator/i);

      assert.strictEqual(wallets.get(String(targetUserId)).balance, 1000);
      assert.strictEqual(transactions.length, 0);
      assert.strictEqual(auditLogs.length, 0);
    });

    it('Inactive second reviewer account (isActive: false) is rejected with 400', async () => {
      const orderId = 'order_mat30_inactive_rev_004';
      createMockDeposit({ amount: 500, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId, amount: 50000 });

      const inactiveAdminId = new mongoose.Types.ObjectId();
      users.set(String(inactiveAdminId), {
        _id: inactiveAdminId,
        name: 'Inactive Admin',
        email: 'inactive@example.com',
        role: 'admin',
        isActive: false,
      });

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Attempting reconciliation with deactivated admin reviewer',
          secondReviewerId: String(inactiveAdminId),
        }),
      });

      assert.strictEqual(res.status, 400);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.match(json.message, /Second reviewer account is inactive or suspended/i);

      assert.strictEqual(wallets.get(String(targetUserId)).balance, 1000);
      assert.strictEqual(transactions.length, 0);
      assert.strictEqual(auditLogs.length, 0);
    });

    it('Suspended second reviewer account (status: suspended) is rejected with 400', async () => {
      const orderId = 'order_mat30_suspended_rev_005';
      createMockDeposit({ amount: 500, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId, amount: 50000 });

      const suspendedAdminId = new mongoose.Types.ObjectId();
      users.set(String(suspendedAdminId), {
        _id: suspendedAdminId,
        name: 'Suspended Admin',
        email: 'suspended@example.com',
        role: 'admin',
        isActive: true,
        status: 'suspended',
      });

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Attempting reconciliation with suspended admin reviewer',
          secondReviewerId: String(suspendedAdminId),
        }),
      });

      assert.strictEqual(res.status, 400);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.match(json.message, /Second reviewer account is inactive or suspended/i);
    });

    it('Same admin as actor (secondReviewerId === adminId) is rejected with 400', async () => {
      const orderId = 'order_mat30_same_actor_006';
      createMockDeposit({ amount: 500, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId, amount: 50000 });

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Attempting self-dual-approval by providing own admin ID',
          secondReviewerId: String(mockAdminId),
        }),
      });

      assert.strictEqual(res.status, 400);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      const errorMsg = [json.message, ...(json.errors || [])].filter(Boolean).join(' ');
      assert.match(errorMsg, /Second reviewer (cannot be the same|must be a different) administrator/i);

      assert.strictEqual(wallets.get(String(targetUserId)).balance, 1000);
      assert.strictEqual(transactions.length, 0);
      assert.strictEqual(auditLogs.length, 0);
    });

    it('Reconciliation below INR 10,000 follows documented policy (succeeds without second reviewer)', async () => {
      const orderId = 'order_mat30_low_val_007';
      const deposit = createMockDeposit({ amount: 9999, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId, amount: 999900 });

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Single admin reconciliation for low-value transaction below threshold',
        }),
      });

      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(wallets.get(String(targetUserId)).balance, 10999);
      assert.strictEqual(auditLogs.length, 1);
      assert.strictEqual(auditLogs[0].secondReviewerBy, null);
    });

    it('Reconciliation at or above INR 10,000 requires valid second-admin approval (missing second reviewer rejected with 400)', async () => {
      const orderId = 'order_mat30_high_val_missing_008';
      const deposit = createMockDeposit({ amount: 10000, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId, amount: 1000000 });

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Attempting high-value reconciliation without mandatory second reviewer',
        }),
      });

      assert.strictEqual(res.status, 400);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.match(json.message, /Dual authorization required.*amounts >= ₹10000/i);

      // Financial writes blocked
      assert.strictEqual(wallets.get(String(targetUserId)).balance, 1000);
      assert.strictEqual(deposits.get(String(deposit._id)).status, 'created');
      assert.strictEqual(transactions.length, 0);
      assert.strictEqual(auditLogs.length, 0);
    });

    it('Reconciliation at or above INR 10,000 with valid second admin succeeds with 200 and logs both admins', async () => {
      const orderId = 'order_mat30_high_val_valid_009';
      const deposit = createMockDeposit({ amount: 25000, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId, amount: 2500000 });

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Valid high-value reconciliation with authorized second reviewer',
          secondReviewerId: String(mockSecondAdminId),
        }),
      });

      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(wallets.get(String(targetUserId)).balance, 26000);

      // Both admins logged in immutable AuditLog
      assert.strictEqual(auditLogs.length, 1);
      assert.strictEqual(String(auditLogs[0].performedBy), String(mockAdminId));
      assert.strictEqual(String(auditLogs[0].secondReviewerBy), String(mockSecondAdminId));
    });

    it('Derives amount strictly from database deposit record, blocking client manipulation attempts', async () => {
      const orderId = 'order_mat30_db_derived_010';
      // In DB, deposit amount is 15000 (high value >= 10000)
      createMockDeposit({ amount: 15000, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId });

      // Client omits secondReviewerId hoping amount is derived from body or default
      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Attempting to reconcile high value deposit without second reviewer',
        }),
      });

      // Must be rejected because DB record has 15,000 >= 10,000
      assert.strictEqual(res.status, 400);
      const json = await res.json();
      assert.match(json.message, /Dual authorization required.*amounts >= ₹10000/i);
    });

    it('Concurrent reconciliation attempts cannot double-credit (CAS lock returns 409)', async () => {
      const orderId = 'order_mat30_concurrent_011';
      createMockDeposit({ amount: 500, orderId, status: 'created' });
      const evt = createMockQuarantinedEvent({ orderId, amount: 50000 });

      // Simulate a concurrent worker having claimed the event
      const origFindOneAndUpdate = WebhookEvent.findOneAndUpdate;
      WebhookEvent.findOneAndUpdate = async () => null; // Lost CAS race

      const res = await fetch(`${baseUrl}/api/v1/payments/admin/webhooks/${evt.eventId}/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Concurrent race attempt while another administrator is reconciling',
        }),
      });

      WebhookEvent.findOneAndUpdate = origFindOneAndUpdate;

      assert.strictEqual(res.status, 409);
      const json = await res.json();
      assert.match(json.message, /Conflict.*currently being reconciled by another administrator/i);

      // No double credit
      assert.strictEqual(wallets.get(String(targetUserId)).balance, 1000);
      assert.strictEqual(transactions.length, 0);
      assert.strictEqual(auditLogs.length, 0);
    });
  });
});
