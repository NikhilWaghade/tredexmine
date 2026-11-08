import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { Transaction } from '../src/models/Transaction.js';
import { Payment } from '../src/models/Payment.js';
import { Plan } from '../src/models/Plan.js';
import { UserPlan } from '../src/models/UserPlan.js';
import { ReferralReward } from '../src/models/ReferralReward.js';
import { generateAccessToken } from '../src/utils/tokenService.js';

describe('Development-Only Referral & Payment Simulation Tests (POST /api/v1/payments/dev-simulate-plan-purchase)', () => {
  let server;
  let baseUrl;

  // In-memory collections for fast, deterministic unit testing
  const users = new Map();
  const wallets = new Map();
  const transactions = [];
  const referralRewards = new Map();
  const payments = new Map();
  const plans = new Map();
  const userPlans = [];

  // Mongoose Model stubs
  let origUserFindOne;
  let origUserFindById;
  let origUserUpdateOne;
  let origWalletFindOne;
  let origWalletFindOneAndUpdate;
  let origWalletCreate;
  let origTransactionFindOne;
  let origTransactionCreate;
  let origReferralRewardCreate;
  let origReferralRewardFind;
  let origReferralRewardFindOne;
  let origPaymentCreate;
  let origPaymentFindOne;
  let origPaymentFindById;
  let origPlanFindOne;
  let origPlanFindById;
  let origUserPlanFindOne;
  let origUserPlanCreate;
  let origUserPlanFindById;

  const referrerId = new mongoose.Types.ObjectId();
  const referredUserId = new mongoose.Types.ObjectId();
  const independentUserId = new mongoose.Types.ObjectId();
  const testPlanId = new mongoose.Types.ObjectId();
  const inactivePlanId = new mongoose.Types.ObjectId();

  let referrerToken;
  let referredUserToken;
  let independentUserToken;

  before(async () => {
    process.env.JWT_SECRET = 'test_jwt_secret_min_32_characters_long_for_security';
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_TEST_PAYMENT_SIMULATION = 'true';

    referrerToken = generateAccessToken({ id: referrerId, role: 'user' });
    referredUserToken = generateAccessToken({ id: referredUserId, role: 'user' });
    independentUserToken = generateAccessToken({ id: independentUserId, role: 'user' });

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Save originals
    origUserFindOne = User.findOne;
    origUserFindById = User.findById;
    origUserUpdateOne = User.updateOne;
    origWalletFindOne = Wallet.findOne;
    origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
    origWalletCreate = Wallet.create;
    origTransactionFindOne = Transaction.findOne;
    origTransactionCreate = Transaction.create;
    origReferralRewardCreate = ReferralReward.create;
    origReferralRewardFind = ReferralReward.find;
    origReferralRewardFindOne = ReferralReward.findOne;
    origPaymentCreate = Payment.create;
    origPaymentFindOne = Payment.findOne;
    origPaymentFindById = Payment.findById;
    origPlanFindOne = Plan.findOne;
    origPlanFindById = Plan.findById;
    origUserPlanFindOne = UserPlan.findOne;
    origUserPlanCreate = UserPlan.create;
    origUserPlanFindById = UserPlan.findById;
  });

  after(async () => {
    User.findOne = origUserFindOne;
    User.findById = origUserFindById;
    User.updateOne = origUserUpdateOne;
    Wallet.findOne = origWalletFindOne;
    Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
    Wallet.create = origWalletCreate;
    Transaction.findOne = origTransactionFindOne;
    Transaction.create = origTransactionCreate;
    ReferralReward.create = origReferralRewardCreate;
    ReferralReward.find = origReferralRewardFind;
    ReferralReward.findOne = origReferralRewardFindOne;
    Payment.create = origPaymentCreate;
    Payment.findOne = origPaymentFindOne;
    Payment.findById = origPaymentFindById;
    Plan.findOne = origPlanFindOne;
    Plan.findById = origPlanFindById;
    UserPlan.findOne = origUserPlanFindOne;
    UserPlan.create = origUserPlanCreate;
    UserPlan.findById = origUserPlanFindById;

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    users.clear();
    wallets.clear();
    transactions.length = 0;
    referralRewards.clear();
    payments.clear();
    plans.clear();
    userPlans.length = 0;

    // Reset default dev simulation env vars
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_TEST_PAYMENT_SIMULATION = 'true';

    // Seed mock plans
    const activePlan = {
      _id: testPlanId,
      name: 'Starter Cloud Miner',
      price: 1500,
      durationDays: 30,
      dailyRoiRate: 2.5,
      hashRate: '50 MH/s',
      features: ['24/7 Cluster Uptime', 'Daily Distribution'],
      isActive: true,
    };
    plans.set(String(testPlanId), activePlan);

    const inactivePlan = {
      _id: inactivePlanId,
      name: 'Legacy Mining Pool',
      price: 3000,
      durationDays: 60,
      dailyRoiRate: 1.8,
      hashRate: '100 MH/s',
      features: ['Archived Node'],
      isActive: false,
    };
    plans.set(String(inactivePlanId), inactivePlan);

    // Seed Referrer User
    const referrerUser = {
      _id: referrerId,
      name: 'Referrer Alice',
      email: 'alice@example.com',
      role: 'user',
      isActive: true,
      referralCode: 'TXMALICE99',
      referredBy: null,
      referralRewardStatus: 'NOT_ELIGIBLE',
      save: async function () {
        users.set(String(this._id), this);
        return this;
      },
    };
    users.set(String(referrerId), referrerUser);

    // Seed Referred User (referred by Alice)
    const referredUser = {
      _id: referredUserId,
      name: 'Referred Bob',
      email: 'bob@example.com',
      role: 'user',
      isActive: true,
      referralCode: 'TXMBOB100',
      referredBy: referrerId,
      referralCodeUsed: 'TXMALICE99',
      referralRewardStatus: 'PENDING',
      save: async function () {
        users.set(String(this._id), this);
        return this;
      },
    };
    users.set(String(referredUserId), referredUser);

    // Seed Independent User (no referrer)
    const independentUser = {
      _id: independentUserId,
      name: 'Independent Carol',
      email: 'carol@example.com',
      role: 'user',
      isActive: true,
      referralCode: 'TXMCAROL01',
      referredBy: null,
      referralRewardStatus: 'NOT_ELIGIBLE',
      save: async function () {
        users.set(String(this._id), this);
        return this;
      },
    };
    users.set(String(independentUserId), independentUser);

    // Seed Wallets
    wallets.set(String(referrerId), {
      _id: new mongoose.Types.ObjectId(),
      user: referrerId,
      balance: 1000,
      referralIncome: 0,
      planIncome: 0,
      totalWithdrawn: 0,
      processedOperations: [],
    });

    wallets.set(String(referredUserId), {
      _id: new mongoose.Types.ObjectId(),
      user: referredUserId,
      balance: 500,
      referralIncome: 0,
      planIncome: 0,
      totalWithdrawn: 0,
      processedOperations: [],
    });

    wallets.set(String(independentUserId), {
      _id: new mongoose.Types.ObjectId(),
      user: independentUserId,
      balance: 500,
      referralIncome: 0,
      planIncome: 0,
      totalWithdrawn: 0,
      processedOperations: [],
    });

    // Setup Model Stubs
    User.findOne = (query = {}) => {
      let matched = null;
      for (const u of users.values()) {
        if (query.email && u.email && u.email.toLowerCase() === String(query.email).toLowerCase()) {
          matched = u;
          break;
        }
        if (query.referralCode && u.referralCode && u.referralCode === String(query.referralCode).toUpperCase()) {
          matched = u;
          break;
        }
        if (query._id && String(u._id) === String(query._id)) {
          matched = u;
          break;
        }
      }
      return {
        select: () => Promise.resolve(matched ? { ...matched } : null),
        then: (resolve) => resolve(matched ? { ...matched } : null),
      };
    };

    User.findById = (id) => {
      const u = users.get(String(id));
      const res = u ? { ...u } : null;
      return {
        select: () => Promise.resolve(res),
        then: (resolve) => resolve(res),
      };
    };

    User.updateOne = async (filter, update) => {
      const u = users.get(String(filter._id));
      if (u && update.$set) {
        Object.assign(u, update.$set);
      }
      return { acknowledged: true, modifiedCount: u ? 1 : 0 };
    };

    Wallet.findOne = async (query = {}) => {
      const uId = String(query.user);
      return wallets.get(uId) || null;
    };

    Wallet.findOneAndUpdate = async (filter, update) => {
      const uId = String(filter.user);
      const w = wallets.get(uId);
      if (!w) return null;

      if (filter.processedOperations?.$ne) {
        const op = filter.processedOperations.$ne;
        if (w.processedOperations && w.processedOperations.includes(op)) {
          return null;
        }
      }

      if (update.$inc?.balance) {
        w.balance = Math.round((w.balance + update.$inc.balance) * 100) / 100;
      }
      if (update.$inc?.referralIncome) {
        w.referralIncome = Math.round((w.referralIncome + update.$inc.referralIncome) * 100) / 100;
      }
      if (update.$addToSet?.processedOperations) {
        w.processedOperations = w.processedOperations || [];
        if (!w.processedOperations.includes(update.$addToSet.processedOperations)) {
          w.processedOperations.push(update.$addToSet.processedOperations);
        }
      }
      return { ...w };
    };

    Wallet.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      const created = {
        _id: new mongoose.Types.ObjectId(),
        balance: 0,
        referralIncome: 0,
        planIncome: 0,
        totalWithdrawn: 0,
        processedOperations: [],
        ...item,
      };
      wallets.set(String(item.user), created);
      return created;
    };

    Transaction.findOne = async (query = {}) => {
      return transactions.find((t) => t.reference === query.reference) || null;
    };

    Transaction.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      if (item.reference && transactions.some((t) => t.reference === item.reference)) {
        const err = new Error(`E11000 duplicate key: ${item.reference}`);
        err.code = 11000;
        throw err;
      }
      const created = {
        _id: new mongoose.Types.ObjectId(),
        createdAt: new Date(),
        ...item,
      };
      transactions.push(created);
      return created;
    };

    ReferralReward.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      for (const r of referralRewards.values()) {
        if (String(r.referredUser) === String(item.referredUser)) {
          const err = new Error('E11000 duplicate key: referredUser already rewarded');
          err.code = 11000;
          throw err;
        }
      }
      const id = new mongoose.Types.ObjectId();
      const created = {
        _id: id,
        createdAt: new Date(),
        ...item,
        save: async function () {
          referralRewards.set(String(this._id), this);
          return this;
        },
      };
      referralRewards.set(String(id), created);
      return created;
    };

    ReferralReward.find = (query = {}) => {
      const list = [...referralRewards.values()];
      return {
        select: () => Promise.resolve(list),
      };
    };

    ReferralReward.findOne = async (query = {}) => {
      for (const r of referralRewards.values()) {
        if (query.reference && r.reference === query.reference) return r;
        if (query.referredUser && String(r.referredUser) === String(query.referredUser)) return r;
      }
      return null;
    };

    Plan.findOne = async (query = {}) => {
      for (const p of plans.values()) {
        if (query._id && String(p._id) === String(query._id)) {
          if (query.isActive !== undefined && p.isActive !== query.isActive) continue;
          return { ...p };
        }
      }
      return null;
    };

    Plan.findById = async (id) => {
      const p = plans.get(String(id));
      return p ? { ...p } : null;
    };

    Payment.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      const id = item._id || new mongoose.Types.ObjectId();
      const created = {
        _id: id,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...item,
        save: async function () {
          payments.set(String(this._id), this);
          return this;
        },
      };
      payments.set(String(id), created);
      return created;
    };

    Payment.findOne = (query = {}) => {
      let matched = null;
      for (const p of payments.values()) {
        if (query.orderId && p.orderId === query.orderId) {
          matched = p;
          break;
        }
        if (query.user && String(p.user) === String(query.user)) {
          if (
            query['metadata.devSimIdempotencyKey'] &&
            p.metadata?.devSimIdempotencyKey === query['metadata.devSimIdempotencyKey']
          ) {
            matched = p;
            break;
          }
        }
      }
      return {
        populate: () => Promise.resolve(matched ? { ...matched } : null),
        then: (resolve) => resolve(matched ? { ...matched } : null),
      };
    };

    Payment.findById = async (id) => {
      const p = payments.get(String(id));
      return p ? { ...p } : null;
    };

    UserPlan.findOne = (query = {}) => {
      let matched = null;
      for (const up of userPlans) {
        if (query.user && String(up.user) === String(query.user)) {
          if (query.idempotencyKey && up.idempotencyKey === query.idempotencyKey) {
            matched = up;
            break;
          }
        }
      }
      return {
        session: () => Promise.resolve(matched ? { ...matched } : null),
        then: (resolve) => resolve(matched ? { ...matched } : null),
      };
    };

    UserPlan.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      const id = item._id || new mongoose.Types.ObjectId();
      const created = {
        _id: id,
        createdAt: new Date(),
        ...item,
      };
      userPlans.push(created);
      return created;
    };

    UserPlan.findById = async (id) => {
      return userPlans.find((up) => String(up._id) === String(id)) || null;
    };
  });

  // =========================================================================
  // 1. SECURITY & PRODUCTION GUARD ENFORCEMENT
  // =========================================================================

  describe('1. Security & Production Environment Guards', () => {
    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      const res = await fetch(`${baseUrl}/api/v1/payments/dev-simulate-plan-purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: testPlanId.toString(),
          outcome: 'success',
        }),
      });

      assert.strictEqual(res.status, 401);
      const body = await res.json();
      assert.strictEqual(body.success, false);
    });

    it('returns 404 Not Found when NODE_ENV=production', async () => {
      process.env.NODE_ENV = 'production';

      const res = await fetch(`${baseUrl}/api/v1/payments/dev-simulate-plan-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${referredUserToken}`,
        },
        body: JSON.stringify({
          planId: testPlanId.toString(),
          outcome: 'success',
        }),
      });

      assert.strictEqual(res.status, 404);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Endpoint not found');
    });

    it('returns 403 Forbidden when ENABLE_TEST_PAYMENT_SIMULATION is false or unset', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ENABLE_TEST_PAYMENT_SIMULATION = 'false';

      const res = await fetch(`${baseUrl}/api/v1/payments/dev-simulate-plan-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${referredUserToken}`,
        },
        body: JSON.stringify({
          planId: testPlanId.toString(),
          outcome: 'success',
        }),
      });

      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /Payment simulation is disabled/);
    });
  });

  // =========================================================================
  // 2. INPUT VALIDATION
  // =========================================================================

  describe('2. Input Validation Guards', () => {
    it('rejects missing planId with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/v1/payments/dev-simulate-plan-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${referredUserToken}`,
        },
        body: JSON.stringify({
          outcome: 'success',
        }),
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /Plan ID is required/i);
    });

    it('rejects invalid outcome value with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/v1/payments/dev-simulate-plan-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${referredUserToken}`,
        },
        body: JSON.stringify({
          planId: testPlanId.toString(),
          outcome: 'pending',
        }),
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /Invalid outcome/i);
    });

    it('rejects non-existent or inactive plan with 404 Not Found', async () => {
      const res = await fetch(`${baseUrl}/api/v1/payments/dev-simulate-plan-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${referredUserToken}`,
        },
        body: JSON.stringify({
          planId: inactivePlanId.toString(),
          outcome: 'success',
        }),
      });

      assert.strictEqual(res.status, 404);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /Plan not found or is currently inactive/i);
    });
  });

  // =========================================================================
  // 3. FAILED PAYMENT SIMULATION
  // =========================================================================

  describe('3. Failed Payment Simulation Outcome', () => {
    it('creates failed payment record, does NOT activate user plan, and does NOT reward referrer', async () => {
      const initialReferrerWallet = wallets.get(String(referrerId)).balance;

      const res = await fetch(`${baseUrl}/api/v1/payments/dev-simulate-plan-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${referredUserToken}`,
        },
        body: JSON.stringify({
          planId: testPlanId.toString(),
          outcome: 'failure',
        }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.simulated, true);
      assert.strictEqual(body.data.payment.status, 'failed');
      assert.strictEqual(body.data.payment.gateway, 'dev_simulation');
      assert.strictEqual(body.data.userPlan, null);
      assert.strictEqual(body.data.referralReward, null);

      // Verify no user plan was provisioned
      assert.strictEqual(userPlans.length, 0);

      // Verify referrer wallet remained untouched
      assert.strictEqual(wallets.get(String(referrerId)).balance, initialReferrerWallet);
      assert.strictEqual(wallets.get(String(referrerId)).referralIncome, 0);

      // Verify no referral reward document was created
      assert.strictEqual(referralRewards.size, 0);

      // Verify referred user status remained PENDING
      assert.strictEqual(users.get(String(referredUserId)).referralRewardStatus, 'PENDING');
    });
  });

  // =========================================================================
  // 4. SUCCESSFUL PAYMENT SIMULATION & REFERRAL REWARDING
  // =========================================================================

  describe('4. Successful Simulation Outcome & Referral Distribution', () => {
    it('activates plan for non-referred user without creating any referral reward', async () => {
      const res = await fetch(`${baseUrl}/api/v1/payments/dev-simulate-plan-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${independentUserToken}`,
        },
        body: JSON.stringify({
          planId: testPlanId.toString(),
          outcome: 'success',
        }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.simulated, true);
      assert.strictEqual(body.data.payment.status, 'captured');
      assert.strictEqual(body.data.userPlan.status, 'active');
      assert.strictEqual(body.data.referralReward, null);

      // Verify UserPlan was persisted
      assert.strictEqual(userPlans.length, 1);
      assert.strictEqual(String(userPlans[0].user), String(independentUserId));

      // Verify no referral rewards created
      assert.strictEqual(referralRewards.size, 0);
    });

    it('simulates purchase for referred user, activating plan and crediting exactly ₹300 to referrer', async () => {
      const initialReferrerBalance = wallets.get(String(referrerId)).balance;

      const res = await fetch(`${baseUrl}/api/v1/payments/dev-simulate-plan-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${referredUserToken}`,
        },
        body: JSON.stringify({
          planId: testPlanId.toString(),
          outcome: 'success',
        }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.simulated, true);
      assert.strictEqual(body.data.payment.status, 'captured');
      assert.strictEqual(body.data.userPlan.status, 'active');

      // Verify referral reward response
      assert.ok(body.data.referralReward);
      assert.strictEqual(body.data.referralReward.amount, 300);

      // Verify Referrer Wallet credited with exactly ₹300
      const updatedReferrerWallet = wallets.get(String(referrerId));
      assert.strictEqual(updatedReferrerWallet.balance, initialReferrerBalance + 300);
      assert.strictEqual(updatedReferrerWallet.referralIncome, 300);
      assert.ok(updatedReferrerWallet.processedOperations.includes(`REF-REW-${referredUserId}`));

      // Verify Transaction ledger record created for referrer
      const referralTx = transactions.find(
        (t) => t.reference === `REF-REW-${referredUserId}`
      );
      assert.ok(referralTx);
      assert.strictEqual(String(referralTx.user), String(referrerId));
      assert.strictEqual(referralTx.amount, 300);
      assert.strictEqual(referralTx.type, 'credit');
      assert.strictEqual(referralTx.reference, `REF-REW-${referredUserId}`);

      // Verify ReferralReward document in database
      assert.strictEqual(referralRewards.size, 1);
      const rewardDoc = [...referralRewards.values()][0];
      assert.strictEqual(String(rewardDoc.referrer), String(referrerId));
      assert.strictEqual(String(rewardDoc.referredUser), String(referredUserId));
      assert.strictEqual(rewardDoc.rewardAmount, 300);
      assert.strictEqual(rewardDoc.status, 'CREDITED');

      // Verify referred user marked REWARDED
      const updatedReferredUser = users.get(String(referredUserId));
      assert.strictEqual(updatedReferredUser.referralRewardStatus, 'REWARDED');
    });

    it('prevents duplicate referral rewards when referred user simulates a second plan purchase', async () => {
      // Step 1: First plan purchase simulation
      const res1 = await fetch(`${baseUrl}/api/v1/payments/dev-simulate-plan-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${referredUserToken}`,
        },
        body: JSON.stringify({
          planId: testPlanId.toString(),
          outcome: 'success',
        }),
      });

      assert.strictEqual(res1.status, 200);
      const balanceAfterFirstPlan = wallets.get(String(referrerId)).balance;

      // Step 2: Second plan purchase simulation by the same referred user
      const res2 = await fetch(`${baseUrl}/api/v1/payments/dev-simulate-plan-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${referredUserToken}`,
        },
        body: JSON.stringify({
          planId: testPlanId.toString(),
          outcome: 'success',
        }),
      });

      assert.strictEqual(res2.status, 200);
      const body2 = await res2.json();
      assert.strictEqual(body2.success, true);
      assert.strictEqual(body2.data.userPlan.status, 'active');

      // Second plan must NOT generate a second referral reward
      assert.strictEqual(body2.data.referralReward.isAlreadyProcessed, true);

      // Referrer wallet balance must remain identical (no second ₹300 credit)
      assert.strictEqual(wallets.get(String(referrerId)).balance, balanceAfterFirstPlan);
      assert.strictEqual(wallets.get(String(referrerId)).referralIncome, 300);

      // Exactly 1 referral reward document exists
      assert.strictEqual(referralRewards.size, 1);

      // Exactly 1 referral transaction in ledger
      const referralTxs = transactions.filter(
        (t) => t.reference === `REF-REW-${referredUserId}`
      );
      assert.strictEqual(referralTxs.length, 1);
    });

    it('safely deduplicates replay requests with identical idempotencyKey', async () => {
      const idempotencyKey = 'dev-sim-test-key-12345';

      const res1 = await fetch(`${baseUrl}/api/v1/payments/dev-simulate-plan-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${referredUserToken}`,
        },
        body: JSON.stringify({
          planId: testPlanId.toString(),
          outcome: 'success',
          idempotencyKey,
        }),
      });

      assert.strictEqual(res1.status, 200);
      const body1 = await res1.json();
      assert.strictEqual(body1.success, true);

      // Replay identical idempotency request
      const res2 = await fetch(`${baseUrl}/api/v1/payments/dev-simulate-plan-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${referredUserToken}`,
        },
        body: JSON.stringify({
          planId: testPlanId.toString(),
          outcome: 'success',
          idempotencyKey,
        }),
      });

      assert.strictEqual(res2.status, 200);
      const body2 = await res2.json();
      assert.strictEqual(body2.isAlreadyProcessed, true);
      assert.strictEqual(body2.simulated, true);
    });

    it('ignores client-supplied referrerId or rewardAmount, adhering strictly to system rules', async () => {
      const spoofedReferrerId = new mongoose.Types.ObjectId();

      const res = await fetch(`${baseUrl}/api/v1/payments/dev-simulate-plan-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${referredUserToken}`,
        },
        body: JSON.stringify({
          planId: testPlanId.toString(),
          outcome: 'success',
          referrerId: spoofedReferrerId.toString(),
          rewardAmount: 999999, // Attempted tamper
        }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);

      // Reward must still go to genuine referrer (Alice), never to spoofedReferrerId
      assert.strictEqual(String(body.data.referralReward.referrerId), String(referrerId));
      assert.strictEqual(body.data.referralReward.amount, 300); // Fixed ₹300, not 999999
    });
  });
});
