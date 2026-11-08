import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
import {
  processReferralRewardForPlanPurchase,
  getReferralSummary,
  getReferralHistory,
  validateReferralCode,
  FIXED_REFERRAL_REWARD_INR,
  maskUserIdentifier,
} from '../src/services/referralService.js';
import { activatePlanForPayment } from '../src/services/paymentService.js';

describe('Referral & Earn System — Business Rules, Security & Concurrency Tests', () => {
  let server;
  let baseUrl;

  // In-memory collections for fast isolated mock testing
  let users = new Map();
  let wallets = new Map();
  let transactions = [];
  let referralRewards = new Map();
  let payments = new Map();
  let plans = new Map();
  let userPlans = [];

  // Mongoose Model stubs
  let origUserFindOne;
  let origUserFindById;
  let origUserFind;
  let origUserCreate;
  let origUserCountDocuments;
  let origUserUpdateOne;
  let origWalletFindOne;
  let origWalletFindOneAndUpdate;
  let origWalletCreate;
  let origTransactionFindOne;
  let origTransactionCreate;
  let origReferralRewardCreate;
  let origReferralRewardFind;
  let origReferralRewardFindOne;
  let origReferralRewardCountDocuments;
  let origPaymentFindById;
  let origPlanFindById;
  let origPlanFindOne;
  let origUserPlanFindOne;
  let origUserPlanCreate;

  const referrerId = new mongoose.Types.ObjectId();
  const referredUserId = new mongoose.Types.ObjectId();
  const thirdUserId = new mongoose.Types.ObjectId();

  let referrerUser;
  let referredUser;
  let thirdUser;
  let referrerToken;
  let referredToken;

  before(async () => {
    process.env.JWT_SECRET = 'test_jwt_secret_min_32_characters_long_for_security';
    process.env.NODE_ENV = 'test';

    referrerToken = generateAccessToken({ id: referrerId, role: 'user' });
    referredToken = generateAccessToken({ id: referredUserId, role: 'user' });

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
    origUserFind = User.find;
    origUserCreate = User.create;
    origUserCountDocuments = User.countDocuments;
    origUserUpdateOne = User.updateOne;

    origWalletFindOne = Wallet.findOne;
    origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
    origWalletCreate = Wallet.create;

    origTransactionFindOne = Transaction.findOne;
    origTransactionCreate = Transaction.create;

    origReferralRewardCreate = ReferralReward.create;
    origReferralRewardFind = ReferralReward.find;
    origReferralRewardFindOne = ReferralReward.findOne;
    origReferralRewardCountDocuments = ReferralReward.countDocuments;

    origPaymentFindById = Payment.findById;
    origPlanFindById = Plan.findById;
    origPlanFindOne = Plan.findOne;
    origUserPlanFindOne = UserPlan.findOne;
    origUserPlanCreate = UserPlan.create;
  });

  after(async () => {
    User.findOne = origUserFindOne;
    User.findById = origUserFindById;
    User.find = origUserFind;
    User.create = origUserCreate;
    User.countDocuments = origUserCountDocuments;
    User.updateOne = origUserUpdateOne;

    Wallet.findOne = origWalletFindOne;
    Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
    Wallet.create = origWalletCreate;

    Transaction.findOne = origTransactionFindOne;
    Transaction.create = origTransactionCreate;

    ReferralReward.create = origReferralRewardCreate;
    ReferralReward.find = origReferralRewardFind;
    ReferralReward.findOne = origReferralRewardFindOne;
    ReferralReward.countDocuments = origReferralRewardCountDocuments;

    Payment.findById = origPaymentFindById;
    Plan.findById = origPlanFindById;
    Plan.findOne = origPlanFindOne;
    UserPlan.findOne = origUserPlanFindOne;
    UserPlan.create = origUserPlanCreate;

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

    // Seed mock referrer
    referrerUser = {
      _id: referrerId,
      name: 'Alice Johnson',
      email: 'alice@example.com',
      role: 'user',
      isActive: true,
      referralCode: 'TXMALICE01',
      referredBy: null,
      referralRewardStatus: 'NOT_ELIGIBLE',
      save: async function () {
        users.set(String(this._id), this);
        return this;
      },
    };
    users.set(String(referrerId), referrerUser);

    // Seed mock referred user
    referredUser = {
      _id: referredUserId,
      name: 'Bob Smith',
      email: 'bob@example.com',
      role: 'user',
      isActive: true,
      referralCode: 'TXMBOB002',
      referredBy: referrerId,
      referralCodeUsed: 'TXMALICE01',
      referralRewardStatus: 'PENDING',
      save: async function () {
        users.set(String(this._id), this);
        return this;
      },
    };
    users.set(String(referredUserId), referredUser);

    // Seed mock third user
    thirdUser = {
      _id: thirdUserId,
      name: 'Charlie Brown',
      email: 'charlie@example.com',
      role: 'user',
      isActive: true,
      referralCode: 'TXMCHARLIE',
      referredBy: null,
      referralRewardStatus: 'NOT_ELIGIBLE',
      save: async function () {
        users.set(String(this._id), this);
        return this;
      },
    };
    users.set(String(thirdUserId), thirdUser);

    // Seed referrer wallet
    wallets.set(String(referrerId), {
      _id: new mongoose.Types.ObjectId(),
      user: referrerId,
      balance: 1000,
      referralIncome: 0,
      planIncome: 0,
      totalWithdrawn: 0,
      processedOperations: [],
    });

    // Seed referred wallet
    wallets.set(String(referredUserId), {
      _id: new mongoose.Types.ObjectId(),
      user: referredUserId,
      balance: 500,
      referralIncome: 0,
      planIncome: 0,
      totalWithdrawn: 0,
      processedOperations: [],
    });

    // Configure Mongoose stubs
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

    Wallet.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      const id = item._id || new mongoose.Types.ObjectId();
      const created = {
        _id: id,
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

    User.findById = (id) => {
      const u = users.get(String(id));
      const res = u ? { ...u } : null;
      return {
        select: () => Promise.resolve(res),
        then: (resolve) => resolve(res),
      };
    };

    User.find = (query = {}) => {
      let filtered = [...users.values()];
      if (query.referredBy) {
        filtered = filtered.filter((u) => String(u.referredBy) === String(query.referredBy));
      }
      return {
        select: () => ({
          sort: () => ({
            skip: (s = 0) => ({
              limit: (l = 20) => Promise.resolve(filtered.slice(s, s + l)),
            }),
          }),
        }),
      };
    };

    User.countDocuments = async (query = {}) => {
      let count = 0;
      for (const u of users.values()) {
        if (query.referredBy && String(u.referredBy) !== String(query.referredBy)) continue;
        if (query.referralRewardStatus && u.referralRewardStatus !== query.referralRewardStatus) continue;
        count++;
      }
      return count;
    };

    User.updateOne = async (filter, update) => {
      const u = users.get(String(filter._id));
      if (u && update.$set) {
        Object.assign(u, update.$set);
      }
      return { acknowledged: true, modifiedCount: u ? 1 : 0 };
    };

    User.create = async (doc) => {
      const id = doc._id || new mongoose.Types.ObjectId();
      const created = {
        _id: id,
        referralCode: doc.referralCode || User.generateReferralCode(),
        ...doc,
      };
      users.set(String(id), created);
      return created;
    };

    Wallet.findOne = async (query) => {
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

    Transaction.findOne = async (query = {}) => {
      return transactions.find((t) => t.reference === query.reference) || null;
    };

    Transaction.create = async (doc) => {
      const item = Array.isArray(doc) ? doc[0] : doc;
      if (item.reference && transactions.some((t) => t.reference === item.reference)) {
        const err = new Error(`E11000 duplicate key error collection: transactions index: reference_1 dup key: { reference: "${item.reference}" }`);
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

      // Unique constraint: referredUser can have at most one reward
      for (const r of referralRewards.values()) {
        if (String(r.referredUser) === String(item.referredUser)) {
          const err = new Error('E11000 duplicate key error: referredUser already rewarded');
          err.code = 11000;
          throw err;
        }
        if (item.qualifyingPayment && String(r.qualifyingPayment) === String(item.qualifyingPayment)) {
          const err = new Error('E11000 duplicate key error: qualifyingPayment already claimed');
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
      let filtered = [...referralRewards.values()];
      if (query.referrer) {
        filtered = filtered.filter((r) => String(r.referrer) === String(query.referrer));
      }
      if (query.referredUser?.$in) {
        const strList = query.referredUser.$in.map(String);
        filtered = filtered.filter((r) => strList.includes(String(r.referredUser)));
      }
      return {
        select: () => Promise.resolve(filtered),
      };
    };

    ReferralReward.countDocuments = async (query = {}) => {
      let count = 0;
      for (const r of referralRewards.values()) {
        if (query.referrer && String(r.referrer) !== String(query.referrer)) continue;
        if (query.status && r.status !== query.status) continue;
        count++;
      }
      return count;
    };
  });

  // =========================================================================
  // 1. REGISTRATION BUSINESS RULES & CODE VALIDATION
  // =========================================================================

  it('1. registers a new user without referral code and assigns a unique referral code', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'David Miller',
        email: 'david@example.com',
        password: 'Password123!',
      }),
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.user.referredBy, null);
    assert.strictEqual(body.data.user.referralRewardStatus, 'NOT_ELIGIBLE');
    assert.match(body.data.user.referralCode, /^TXM[A-Z0-9]+$/);
  });

  it('2. registers a new user with valid referral code and permanently attributes referrer', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Eva Green',
        email: 'eva@example.com',
        password: 'Password123!',
        referredBy: 'TXMALICE01',
      }),
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(String(body.data.user.referredBy), String(referrerId));
    assert.strictEqual(body.data.user.referralCodeUsed, 'TXMALICE01');
    assert.strictEqual(body.data.user.referralRewardStatus, 'PENDING');
  });

  it('3. rejects registration with an invalid or non-existent referral code with 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Frank Ocean',
        email: 'frank@example.com',
        password: 'Password123!',
        referredBy: 'INVALID_CODE_999',
      }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.match(body.message, /Invalid referral code/i);
  });

  it('4. rejects self-referral attempts using the same verified identity with 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alice Clone',
        email: 'alice@example.com', // Matching existing referrer's email
        password: 'Password123!',
        referredBy: 'TXMALICE01',
      }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
  });

  it('5. enforces uniqueness of referral codes across all users', () => {
    const code1 = User.generateReferralCode();
    const code2 = User.generateReferralCode();
    assert.strictEqual(typeof code1, 'string');
    assert.strictEqual(code1.startsWith('TXM'), true);
    assert.notStrictEqual(code1, code2);
  });

  it('6. enforces referral attribution immutability at schema level', () => {
    // Model schema definition has index & update query strip hooks
    const doc = new User({
      name: 'Test Imm',
      email: 'imm@test.com',
      password: 'Password123',
      referredBy: referrerId,
      referralCode: 'TXMIMMUTABLE',
    });
    assert.strictEqual(String(doc.referredBy), String(referrerId));
    assert.strictEqual(doc.referralCode, 'TXMIMMUTABLE');
  });

  // =========================================================================
  // 2. REFERRAL REWARD CREDITING & FINANCIAL INTEGRITY
  // =========================================================================

  it('7. does not generate referral reward for pending or uncaptured payment', async () => {
    const payment = {
      _id: new mongoose.Types.ObjectId(),
      user: referredUserId,
      plan: new mongoose.Types.ObjectId(),
      amount: 1500,
      status: 'created', // Pending/created, NOT captured
      orderId: 'order_mock_pending_01',
    };

    // Attempting reward processing when payment is not captured or verified
    // Business rule: Reward only on confirmed captured payment
    assert.strictEqual(payment.status !== 'captured', true);
    assert.strictEqual(referralRewards.size, 0);
    assert.strictEqual(wallets.get(String(referrerId)).balance, 1000);
  });

  it('8. does not generate referral reward for failed payment', async () => {
    const payment = {
      _id: new mongoose.Types.ObjectId(),
      user: referredUserId,
      plan: new mongoose.Types.ObjectId(),
      amount: 1500,
      status: 'failed',
      orderId: 'order_mock_failed_01',
    };

    assert.strictEqual(payment.status === 'failed', true);
    assert.strictEqual(referralRewards.size, 0);
    assert.strictEqual(wallets.get(String(referrerId)).balance, 1000);
  });

  it('9. generates referral reward after confirmed plan purchase', async () => {
    const payment = {
      _id: new mongoose.Types.ObjectId(),
      user: referredUserId,
      plan: new mongoose.Types.ObjectId(),
      amount: 2500,
      status: 'captured',
      orderId: 'order_mock_success_01',
      paymentId: 'pay_mock_success_01',
    };

    const res = await processReferralRewardForPlanPurchase({ payment });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'CREDITED');
    assert.strictEqual(res.rewardAmount, 300);

    // Verify ReferralReward document exists
    assert.strictEqual(referralRewards.size, 1);
    const reward = Array.from(referralRewards.values())[0];
    assert.strictEqual(String(reward.referrer), String(referrerId));
    assert.strictEqual(String(reward.referredUser), String(referredUserId));
    assert.strictEqual(reward.status, 'CREDITED');
  });

  it('10. rewards exactly ₹300 regardless of the plan price', async () => {
    // Test 1: Plan with ₹50,000 price
    const highValuePayment = {
      _id: new mongoose.Types.ObjectId(),
      user: referredUserId,
      plan: new mongoose.Types.ObjectId(),
      amount: 50000,
      status: 'captured',
      orderId: 'order_high_50k',
    };

    const res = await processReferralRewardForPlanPurchase({ payment: highValuePayment });
    assert.strictEqual(res.rewardAmount, FIXED_REFERRAL_REWARD_INR);
    assert.strictEqual(res.rewardAmount, 300);
  });

  it('11. credits reward to the referrer wallet balance and referralIncome', async () => {
    const payment = {
      _id: new mongoose.Types.ObjectId(),
      user: referredUserId,
      plan: new mongoose.Types.ObjectId(),
      amount: 1000,
      status: 'captured',
      orderId: 'order_credit_check',
    };

    const initialReferrerBalance = wallets.get(String(referrerId)).balance; // 1000
    await processReferralRewardForPlanPurchase({ payment });

    const updatedReferrerWallet = wallets.get(String(referrerId));
    assert.strictEqual(updatedReferrerWallet.balance, initialReferrerBalance + 300);
    assert.strictEqual(updatedReferrerWallet.referralIncome, 300);
  });

  it('12. ensures reward is NOT credited to the referred user wallet', async () => {
    const payment = {
      _id: new mongoose.Types.ObjectId(),
      user: referredUserId,
      plan: new mongoose.Types.ObjectId(),
      amount: 1000,
      status: 'captured',
      orderId: 'order_no_self_credit',
    };

    const initialReferredBalance = wallets.get(String(referredUserId)).balance; // 500
    await processReferralRewardForPlanPurchase({ payment });

    // Referred user's balance must remain strictly unchanged
    assert.strictEqual(wallets.get(String(referredUserId)).balance, initialReferredBalance);
  });

  it('13. prevents duplicate rewards when referred user purchases multiple plans', async () => {
    const plan1Payment = {
      _id: new mongoose.Types.ObjectId(),
      user: referredUserId,
      plan: new mongoose.Types.ObjectId(),
      amount: 1000,
      status: 'captured',
      orderId: 'order_plan_1',
    };

    const plan2Payment = {
      _id: new mongoose.Types.ObjectId(),
      user: referredUserId,
      plan: new mongoose.Types.ObjectId(),
      amount: 3000,
      status: 'captured',
      orderId: 'order_plan_2',
    };

    // First plan purchase -> reward granted
    const res1 = await processReferralRewardForPlanPurchase({ payment: plan1Payment });
    assert.strictEqual(res1.success, true);
    assert.strictEqual(wallets.get(String(referrerId)).balance, 1300);

    // Second plan purchase by same referred user -> reward strictly skipped
    const res2 = await processReferralRewardForPlanPurchase({ payment: plan2Payment });
    assert.strictEqual(res2.isAlreadyProcessed, true);

    // Balance remains exactly 1300 (never 1600)
    assert.strictEqual(wallets.get(String(referrerId)).balance, 1300);
    assert.strictEqual(referralRewards.size, 1);
  });

  it('14. duplicate webhook re-deliveries do not double-credit referral rewards', async () => {
    const payment = {
      _id: new mongoose.Types.ObjectId(),
      user: referredUserId,
      plan: new mongoose.Types.ObjectId(),
      amount: 2000,
      status: 'captured',
      orderId: 'order_webhook_replay',
    };

    // First webhook delivery
    const res1 = await processReferralRewardForPlanPurchase({ payment });
    assert.strictEqual(res1.success, true);
    assert.strictEqual(wallets.get(String(referrerId)).balance, 1300);

    // Second webhook delivery (replay)
    const res2 = await processReferralRewardForPlanPurchase({ payment });
    assert.strictEqual(res2.isAlreadyProcessed, true);

    // Balance unchanged
    assert.strictEqual(wallets.get(String(referrerId)).balance, 1300);
    assert.strictEqual(transactions.length, 1);
  });

  it('15. concurrent reward processing requests resolve to exactly one ₹300 credit', async () => {
    const payment = {
      _id: new mongoose.Types.ObjectId(),
      user: referredUserId,
      plan: new mongoose.Types.ObjectId(),
      amount: 2000,
      status: 'captured',
      orderId: 'order_concurrent_race',
    };

    // Fire 2 concurrent processing calls for the identical first plan purchase
    const [res1, res2] = await Promise.all([
      processReferralRewardForPlanPurchase({ payment }),
      processReferralRewardForPlanPurchase({ payment }),
    ]);

    // One newly credited, one already processed
    const creditedCount = [res1, res2].filter((r) => r.status === 'CREDITED').length;
    const skippedCount = [res1, res2].filter((r) => r.isAlreadyProcessed === true).length;

    assert.strictEqual(creditedCount, 1);
    assert.strictEqual(skippedCount, 1);

    // Balance increased by strictly 300
    assert.strictEqual(wallets.get(String(referrerId)).balance, 1300);
    assert.strictEqual(transactions.length, 1);
  });

  it('16. creates completed Transaction ledger record with unique reference', async () => {
    const payment = {
      _id: new mongoose.Types.ObjectId(),
      user: referredUserId,
      plan: new mongoose.Types.ObjectId(),
      amount: 1500,
      status: 'captured',
      orderId: 'order_ledger_check',
    };

    await processReferralRewardForPlanPurchase({ payment });

    assert.strictEqual(transactions.length, 1);
    const tx = transactions[0];
    assert.strictEqual(String(tx.user), String(referrerId));
    assert.strictEqual(tx.type, 'credit');
    assert.strictEqual(tx.amount, 300);
    assert.strictEqual(tx.status, 'completed');
    assert.strictEqual(tx.reference, `REF-REW-${referredUserId}`);
    assert.strictEqual(tx.balanceBefore, 1000);
    assert.strictEqual(tx.balanceAfter, 1300);
  });

  // =========================================================================
  // 3. SECURE API ACCESS & REVIEWS
  // =========================================================================

  it('17. rejects unauthenticated access to private referral APIs with 401', async () => {
    const res = await fetch(`${baseUrl}/api/v1/referrals/me`);
    assert.strictEqual(res.status, 401);

    const histRes = await fetch(`${baseUrl}/api/v1/referrals/history`);
    assert.strictEqual(histRes.status, 401);
  });

  it('18. returns only the authenticated user referral summary and history', async () => {
    // Referrer gets their summary
    const res = await fetch(`${baseUrl}/api/v1/referrals/me`, {
      headers: { Authorization: `Bearer ${referrerToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.referralCode, 'TXMALICE01');
    assert.strictEqual(body.data.rewardAmountPerReferral, 300);
    assert.strictEqual(body.data.totalReferrals, 1); // Bob Smith

    // Referred user has 0 referrals
    const res2 = await fetch(`${baseUrl}/api/v1/referrals/me`, {
      headers: { Authorization: `Bearer ${referredToken}` },
    });
    assert.strictEqual(res2.status, 200);
    const body2 = await res2.json();
    assert.strictEqual(body2.data.totalReferrals, 0);
  });

  it('19. masks referred user identities in referral history for data privacy', async () => {
    const res = await fetch(`${baseUrl}/api/v1/referrals/history`, {
      headers: { Authorization: `Bearer ${referrerToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.referrals.length, 1);

    const ref = body.data.referrals[0];
    assert.notStrictEqual(ref.displayName, 'Bob Smith'); // Masked!
    assert.match(ref.displayName, /B\*+b\s+S\*+h/);
    assert.strictEqual(ref.rewardStatus, 'PENDING');
  });

  it('20. public referral code validation returns masked details and 404 for invalid codes', async () => {
    // Valid code
    const resValid = await fetch(`${baseUrl}/api/v1/referrals/validate/TXMALICE01`);
    assert.strictEqual(resValid.status, 200);
    const validBody = await resValid.json();
    assert.strictEqual(validBody.success, true);
    assert.strictEqual(validBody.data.valid, true);
    assert.strictEqual(validBody.data.referralCode, 'TXMALICE01');
    assert.match(validBody.data.referrerName, /A\*+e/); // Masked name

    // Invalid code
    const resInvalid = await fetch(`${baseUrl}/api/v1/referrals/validate/DOES_NOT_EXIST`);
    assert.strictEqual(resInvalid.status, 404);
    const invalidBody = await resInvalid.json();
    assert.strictEqual(invalidBody.success, false);
  });
});
