/**
 * Admin Hub & Governance Dashboard Integration Tests
 *
 * NOTE: This test suite performs mocked HTTP and controller integration testing.
 * It stubs Mongoose model methods with an isolated, deterministic in-memory store
 * to thoroughly exercise authentication, role-based authorization, aggregations,
 * pagination, filtering, and API response structures without requiring an active
 * external MongoDB instance or leaking real database calls.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { UserPlan } from '../src/models/UserPlan.js';
import { Deposit } from '../src/models/Deposit.js';
import { Withdrawal } from '../src/models/Withdrawal.js';
import { Payment } from '../src/models/Payment.js';
import { ReferralReward } from '../src/models/ReferralReward.js';
import { Transaction } from '../src/models/Transaction.js';
import { WebhookEvent } from '../src/models/WebhookEvent.js';
import { generateAccessToken } from '../src/utils/tokenService.js';

describe('Admin Hub & Governance Dashboard Integration Tests (Mocked DB Environment)', () => {
  let server;
  let baseUrl;

  const adminId = new mongoose.Types.ObjectId();
  const regularUserId = new mongoose.Types.ObjectId();
  const newUserId = new mongoose.Types.ObjectId();
  const planId300 = new mongoose.Types.ObjectId();
  const userPlanId300 = new mongoose.Types.ObjectId();

  let adminToken;
  let userToken;

  // In-memory collections for deterministic isolated testing
  let users = new Map();
  let wallets = new Map();
  let userPlans = new Map();
  let deposits = new Map();
  let withdrawals = new Map();
  let payments = new Map();
  let referralRewards = new Map();
  let transactions = [];

  // Mongoose stubs originals
  let origUserFind;
  let origUserFindById;
  let origUserCountDocuments;
  let origWalletFind;
  let origWalletCountDocuments;
  let origUserPlanFind;
  let origUserPlanCountDocuments;
  let origUserPlanAggregate;
  let origDepositFind;
  let origDepositCountDocuments;
  let origDepositAggregate;
  let origWithdrawalFind;
  let origWithdrawalFindById;
  let origWithdrawalCountDocuments;
  let origWithdrawalAggregate;
  let origPaymentFind;
  let origPaymentCountDocuments;
  let origPaymentAggregate;
  let origReferralRewardFind;
  let origReferralRewardCountDocuments;
  let origReferralRewardAggregate;
  let origTransactionFind;
  let origTransactionAggregate;
  let origWebhookEventCountDocuments;

  /**
   * Helper to create a chainable Mongoose-compatible query stub supporting:
   * .populate(), .sort(), .skip(), .limit(), .select(), and .then() (Promise resolution)
   */
  function createQuery(getItemsFn) {
    let skipVal = 0;
    let limitVal = Infinity;
    const populatePaths = [];
    const q = {
      populate: (path) => {
        populatePaths.push(path);
        return q;
      },
      sort: () => q,
      select: () => q,
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
          const raw = getItemsFn(populatePaths);
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

    adminToken = generateAccessToken({ id: adminId, role: 'admin' });
    userToken = generateAccessToken({ id: regularUserId, role: 'user' });

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Save originals for bulletproof restoration
    origUserFind = User.find;
    origUserFindById = User.findById;
    origUserCountDocuments = User.countDocuments;
    origWalletFind = Wallet.find;
    origWalletCountDocuments = Wallet.countDocuments;
    origUserPlanFind = UserPlan.find;
    origUserPlanCountDocuments = UserPlan.countDocuments;
    origUserPlanAggregate = UserPlan.aggregate;
    origDepositFind = Deposit.find;
    origDepositCountDocuments = Deposit.countDocuments;
    origDepositAggregate = Deposit.aggregate;
    origWithdrawalFind = Withdrawal.find;
    origWithdrawalFindById = Withdrawal.findById;
    origWithdrawalCountDocuments = Withdrawal.countDocuments;
    origWithdrawalAggregate = Withdrawal.aggregate;
    origPaymentFind = Payment.find;
    origPaymentCountDocuments = Payment.countDocuments;
    origPaymentAggregate = Payment.aggregate;
    origReferralRewardFind = ReferralReward.find;
    origReferralRewardCountDocuments = ReferralReward.countDocuments;
    origReferralRewardAggregate = ReferralReward.aggregate;
    origTransactionFind = Transaction.find;
    origTransactionAggregate = Transaction.aggregate;
    origWebhookEventCountDocuments = WebhookEvent.countDocuments;
  });

  after(async () => {
    try {
      User.find = origUserFind;
      User.findById = origUserFindById;
      User.countDocuments = origUserCountDocuments;
      Wallet.find = origWalletFind;
      Wallet.countDocuments = origWalletCountDocuments;
      UserPlan.find = origUserPlanFind;
      UserPlan.countDocuments = origUserPlanCountDocuments;
      UserPlan.aggregate = origUserPlanAggregate;
      Deposit.find = origDepositFind;
      Deposit.countDocuments = origDepositCountDocuments;
      Deposit.aggregate = origDepositAggregate;
      Withdrawal.find = origWithdrawalFind;
      Withdrawal.findById = origWithdrawalFindById;
      Withdrawal.countDocuments = origWithdrawalCountDocuments;
      Withdrawal.aggregate = origWithdrawalAggregate;
      Payment.find = origPaymentFind;
      Payment.countDocuments = origPaymentCountDocuments;
      Payment.aggregate = origPaymentAggregate;
      ReferralReward.find = origReferralRewardFind;
      ReferralReward.countDocuments = origReferralRewardCountDocuments;
      ReferralReward.aggregate = origReferralRewardAggregate;
      Transaction.find = origTransactionFind;
      Transaction.aggregate = origTransactionAggregate;
      WebhookEvent.countDocuments = origWebhookEventCountDocuments;
    } finally {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  });

  beforeEach(() => {
    users.clear();
    wallets.clear();
    userPlans.clear();
    deposits.clear();
    withdrawals.clear();
    payments.clear();
    referralRewards.clear();
    transactions = [];

    // 1. Seed mock admin
    const adminDoc = {
      _id: adminId,
      name: 'System Admin',
      email: 'admin@minetrades.test',
      role: 'admin',
      referralCode: 'TXMADMIN01',
      isActive: true,
      createdAt: new Date('2026-10-01T10:00:00Z'),
    };
    users.set(String(adminId), adminDoc);

    // 2. Seed mock regular user (purchased ₹300 plan)
    const userDoc = {
      _id: regularUserId,
      name: 'Nikku Investor',
      email: 'nikku@example.com',
      role: 'user',
      referralCode: 'TXMNIKKU01',
      referredBy: adminId,
      isActive: true,
      createdAt: new Date('2026-11-01T12:00:00Z'),
    };
    users.set(String(regularUserId), userDoc);

    // 3. Seed mock wallet
    wallets.set(String(regularUserId), {
      _id: new mongoose.Types.ObjectId(),
      user: regularUserId,
      balance: 1500,
      planIncome: 50,
      referralIncome: 100,
      totalWithdrawn: 300,
      updatedAt: new Date('2026-11-20T08:00:00Z'),
      createdAt: new Date('2026-11-01T12:00:00Z'),
    });

    // 4. Seed ₹300 UserPlan (Active Investment)
    userPlans.set(String(userPlanId300), {
      _id: userPlanId300,
      user: regularUserId,
      plan: planId300,
      planName: 'Starter Plan',
      price: 300,
      durationDays: 30,
      dailyRoiRate: 1.0,
      hashRate: '15 MH/s',
      status: 'active',
      startDate: new Date('2026-11-20T06:00:00Z'),
      endDate: new Date('2026-12-20T06:00:00Z'),
      createdAt: new Date('2026-11-20T06:00:00Z'),
    });

    // 5. Seed Payment for ₹300
    const paymentId = new mongoose.Types.ObjectId();
    payments.set(String(paymentId), {
      _id: paymentId,
      user: regularUserId,
      plan: planId300,
      orderId: 'order_test_rzp_300',
      paymentId: 'pay_test_rzp_300',
      amount: 300,
      status: 'captured',
      gateway: 'razorpay',
      createdAt: new Date('2026-11-20T06:00:00Z'),
    });

    // 6. Seed Completed Deposit of ₹1,000
    const depositId = new mongoose.Types.ObjectId();
    deposits.set(String(depositId), {
      _id: depositId,
      user: regularUserId,
      amount: 1000,
      depositReference: 'DEP-TEST-1000',
      paymentId: 'pay_dep_mock_1',
      provider: 'razorpay',
      status: 'completed',
      creditedAt: new Date('2026-11-15T10:00:00Z'),
      createdAt: new Date('2026-11-15T09:55:00Z'),
    });

    // 7. Seed Completed Withdrawal of ₹300
    const withdrawalId = new mongoose.Types.ObjectId();
    withdrawals.set(String(withdrawalId), {
      _id: withdrawalId,
      user: regularUserId,
      amount: 300,
      status: 'COMPLETED',
      payoutMethod: 'UPI',
      payoutDetails: { upiId: 'nikku@upi' },
      createdAt: new Date('2026-11-16T10:00:00Z'),
      updatedAt: new Date('2026-11-16T11:00:00Z'),
    });

    // 8. Seed Referral Reward of ₹100
    const rewardId = new mongoose.Types.ObjectId();
    referralRewards.set(String(rewardId), {
      _id: rewardId,
      referrer: adminId,
      referredUser: regularUserId,
      rewardReference: 'REF-TEST-100',
      rewardAmount: 100,
      level: 1,
      status: 'CREDITED',
      createdAt: new Date('2026-11-20T07:00:00Z'),
    });

    // 9. Seed Transaction record
    transactions.push({
      _id: new mongoose.Types.ObjectId(),
      user: regularUserId,
      type: 'credit',
      amount: 1000,
      description: 'Wallet Deposit',
      status: 'completed',
      reference: 'DEP-TEST-1000',
      createdAt: new Date('2026-11-15T10:00:00Z'),
    });

    // =========================================================================
    // DYNAMIC MONGOOSE MODEL STUBS
    // =========================================================================

    // User Stubs
    User.findById = (id) => {
      const u = users.get(String(id)) || null;
      return createQuery(() => (u ? { ...u, toObject: () => ({ ...u }) } : null));
    };

    User.find = (query = {}) => {
      return createQuery((populatePaths) => {
        let result = [...users.values()];
        if (query.role) {
          result = result.filter((u) => u.role === query.role);
        }
        if (query.$or) {
          result = result.filter((u) =>
            query.$or.some((cond) => {
              if (cond.name?.$regex) return new RegExp(cond.name.$regex, cond.name.$options || 'i').test(u.name);
              if (cond.email?.$regex) return new RegExp(cond.email.$regex, cond.email.$options || 'i').test(u.email);
              if (cond.referralCode?.$regex) return new RegExp(cond.referralCode.$regex, cond.referralCode.$options || 'i').test(u.referralCode);
              return false;
            })
          );
        }
        return result.map((u) => {
          const doc = {
            ...u,
            referredBy: populatePaths.includes('referredBy') && u.referredBy ? users.get(String(u.referredBy)) : u.referredBy,
          };
          doc.toObject = () => ({ ...doc });
          return doc;
        });
      });
    };

    User.countDocuments = async (query = {}) => {
      let count = 0;
      for (const u of users.values()) {
        if (query.role && u.role !== query.role) continue;
        if (query.isActive !== undefined && u.isActive !== query.isActive) continue;
        count++;
      }
      return count;
    };

    // Wallet Stubs
    Wallet.find = (query = {}) => {
      return createQuery((populatePaths) => {
        let result = [...wallets.values()];
        if (query.user?.$in) {
          const allowed = query.user.$in.map(String);
          result = result.filter((w) => allowed.includes(String(w.user)));
        }
        return result.map((w) => {
          const shouldPopulate = populatePaths.includes('user');
          const userDoc = users.get(String(w.user));
          const userVal = shouldPopulate
            ? { ...(userDoc || { _id: w.user, name: 'User', email: 'user@test.com' }), toString: () => String(w.user) }
            : w.user;
          const doc = {
            ...w,
            user: userVal,
          };
          doc.toObject = () => ({ ...doc });
          return doc;
        });
      });
    };

    Wallet.countDocuments = async () => wallets.size;

    // UserPlan Stubs
    UserPlan.find = (query = {}) => {
      return createQuery((populatePaths) => {
        let result = [...userPlans.values()];
        if (query.status && query.status !== 'all') {
          result = result.filter((p) => p.status === query.status);
        }
        if (query.user?.$in) {
          const allowed = query.user.$in.map(String);
          result = result.filter((p) => allowed.includes(String(p.user)));
        }
        return result.map((p) => {
          const shouldPopulateUser = populatePaths.includes('user');
          const shouldPopulatePlan = populatePaths.includes('plan');
          const userDoc = users.get(String(p.user));
          const userVal = shouldPopulateUser
            ? { ...(userDoc || { _id: p.user, name: 'Nikku Investor', email: 'nikku@example.com' }), toString: () => String(p.user) }
            : p.user;
          const planVal = shouldPopulatePlan
            ? {
                _id: p.plan || planId300,
                name: p.planName || 'Starter Plan',
                price: p.price || 300,
                durationDays: p.durationDays || 30,
                hashRate: p.hashRate || '15 MH/s',
              }
            : p.plan;
          const doc = {
            ...p,
            user: userVal,
            plan: planVal,
          };
          doc.toObject = () => ({ ...doc });
          return doc;
        });
      });
    };

    UserPlan.countDocuments = async (query = {}) => {
      let count = 0;
      for (const p of userPlans.values()) {
        if (query.status && query.status !== 'all' && p.status !== query.status) continue;
        count++;
      }
      return count;
    };

    UserPlan.aggregate = async (pipeline = []) => {
      const matchStage = pipeline.find((s) => s.$match)?.$match;
      let items = [...userPlans.values()];
      if (matchStage?.status) {
        items = items.filter((p) => p.status === matchStage.status);
      }
      const total = items.reduce((acc, p) => acc + Number(p.price || 0), 0);
      return [{ _id: null, total }];
    };

    // Deposit Stubs
    Deposit.find = (query = {}) => {
      return createQuery((populatePaths) => {
        let result = [...deposits.values()];
        if (query.status && query.status !== 'all') {
          result = result.filter((d) => d.status === query.status);
        }
        return result.map((d) => {
          const shouldPopulateUser = populatePaths.includes('user');
          const userDoc = users.get(String(d.user));
          const userVal = shouldPopulateUser
            ? { ...(userDoc || { _id: d.user, name: 'Nikku Investor', email: 'nikku@example.com' }), toString: () => String(d.user) }
            : d.user;
          const doc = {
            ...d,
            user: userVal,
          };
          doc.toObject = () => ({ ...doc });
          return doc;
        });
      });
    };

    Deposit.countDocuments = async (query = {}) => {
      let items = [...deposits.values()];
      if (query.status) {
        if (typeof query.status === 'string') {
          items = items.filter((d) => d.status === query.status);
        } else if (query.status.$in) {
          items = items.filter((d) => query.status.$in.includes(d.status));
        }
      }
      return items.length;
    };

    Deposit.aggregate = async (pipeline = []) => {
      const matchStage = pipeline.find((s) => s.$match)?.$match;
      const groupStage = pipeline.find((s) => s.$group)?.$group;

      let items = [...deposits.values()];
      if (matchStage) {
        if (matchStage.status) {
          items = items.filter((d) => d.status === matchStage.status);
        }
        if (matchStage.user?.$in) {
          const allowed = matchStage.user.$in.map(String);
          items = items.filter((d) => allowed.includes(String(d.user)));
        }
      }

      if (groupStage) {
        if (groupStage._id === '$user') {
          const userSums = new Map();
          items.forEach((d) => {
            const uId = String(d.user);
            userSums.set(uId, (userSums.get(uId) || 0) + Number(d.amount || 0));
          });
          return [...userSums.entries()].map(([uId, totalDeposits]) => ({
            _id: uId,
            totalDeposits,
          }));
        }
        if (groupStage._id === null) {
          const total = items.reduce((acc, d) => acc + Number(d.amount || 0), 0);
          return [{ _id: null, total, count: items.length }];
        }
      }
      return [];
    };

    // Withdrawal Stubs (fully dynamic based on in-memory collection)
    Withdrawal.find = (query = {}) => {
      return createQuery((populatePaths) => {
        let result = [...withdrawals.values()];
        if (query.status && query.status !== 'all') {
          result = result.filter((w) => w.status === query.status);
        }
        if (query['metadata.reconciliationRequiresManualReview']) {
          result = result.filter((w) => w.metadata?.reconciliationRequiresManualReview);
        }
        return result.map((w) => {
          const shouldPopulateUser = populatePaths.includes('user');
          const userDoc = users.get(String(w.user));
          const userVal = shouldPopulateUser
            ? { ...(userDoc || { _id: w.user, name: 'Nikku Investor', email: 'nikku@example.com', role: 'user' }), toString: () => String(w.user) }
            : w.user;
          const doc = {
            ...w,
            user: userVal,
          };
          doc.toObject = () => ({ ...doc });
          return doc;
        });
      });
    };

    Withdrawal.findById = (id) => {
      const w = withdrawals.get(String(id)) || null;
      return createQuery(() => {
        if (!w) return null;
        const doc = {
          ...w,
          user: users.get(String(w.user)) || { _id: w.user, name: 'Nikku Investor', email: 'nikku@example.com', role: 'user' },
          reviewedBy: w.reviewedBy ? users.get(String(w.reviewedBy)) : null,
        };
        doc.toObject = () => ({ ...doc });
        return doc;
      });
    };

    Withdrawal.countDocuments = async (query = {}) => {
      let items = [...withdrawals.values()];
      if (query.status) {
        if (typeof query.status === 'string') {
          items = items.filter((w) => w.status === query.status);
        } else if (query.status.$in) {
          items = items.filter((w) => query.status.$in.includes(w.status));
        }
      }
      if (query.$or) {
        items = items.filter((w) =>
          query.$or.some((c) => {
            if (c.status && w.status === c.status) return true;
            if (c['metadata.reconciliationRequiresManualReview'] && w.metadata?.reconciliationRequiresManualReview) return true;
            return false;
          })
        );
      }
      return items.length;
    };

    Withdrawal.aggregate = async (pipeline = []) => {
      const matchStage = pipeline.find((s) => s.$match)?.$match;
      const groupStage = pipeline.find((s) => s.$group)?.$group;

      let items = [...withdrawals.values()];
      if (matchStage) {
        if (matchStage.status) {
          const s = matchStage.status;
          if (typeof s === 'string') {
            items = items.filter((w) => w.status === s);
          } else if (s.$in) {
            items = items.filter((w) => s.$in.includes(w.status));
          }
        }
        if (matchStage.user?.$in) {
          const allowed = matchStage.user.$in.map(String);
          items = items.filter((w) => allowed.includes(String(w.user)));
        }
      }

      if (groupStage) {
        if (groupStage._id === '$user') {
          const userSums = new Map();
          items.forEach((w) => {
            const uId = String(w.user);
            userSums.set(uId, (userSums.get(uId) || 0) + Number(w.amount || 0));
          });
          return [...userSums.entries()].map(([uId, totalWithdrawals]) => ({
            _id: uId,
            totalWithdrawals,
          }));
        }
        if (groupStage._id === null) {
          const total = items.reduce((acc, w) => acc + Number(w.amount || 0), 0);
          return [{ _id: null, total, count: items.length }];
        }
      }
      return [];
    };

    // Payment Stubs
    Payment.find = (query = {}) => {
      return createQuery((populatePaths) => {
        let result = [...payments.values()];
        if (query.status && query.status !== 'all') {
          result = result.filter((p) => p.status === query.status);
        }
        return result.map((p) => {
          const userDoc = users.get(String(p.user));
          const doc = {
            ...p,
            user: populatePaths.includes('user')
              ? { ...(userDoc || { _id: p.user, name: 'Nikku Investor', email: 'nikku@example.com' }), toString: () => String(p.user) }
              : p.user,
            plan: populatePaths.includes('plan')
              ? { name: 'Starter Plan', price: 300, durationDays: 30, hashRate: '15 MH/s' }
              : p.plan,
            userPlan: populatePaths.includes('userPlan')
              ? userPlans.get(String(userPlanId300))
              : p.userPlan,
          };
          doc.toObject = () => ({ ...doc });
          return doc;
        });
      });
    };

    Payment.countDocuments = async (query = {}) => {
      let items = [...payments.values()];
      if (query.status && query.status !== 'all') {
        items = items.filter((p) => p.status === query.status);
      }
      return items.length;
    };

    Payment.aggregate = async (pipeline = []) => {
      const matchStage = pipeline.find((s) => s.$match)?.$match;
      let items = [...payments.values()];
      if (matchStage?.status) {
        items = items.filter((p) => p.status === matchStage.status);
      }
      const total = items.reduce((acc, p) => acc + Number(p.amount || 0), 0);
      return [{ _id: null, total, count: items.length }];
    };

    // ReferralReward Stubs
    ReferralReward.find = (query = {}) => {
      return createQuery((populatePaths) => {
        let result = [...referralRewards.values()];
        return result.map((r) => {
          const referrerDoc = users.get(String(r.referrer));
          const referredDoc = users.get(String(r.referredUser));
          const doc = {
            ...r,
            referrer: populatePaths.includes('referrer')
              ? { ...(referrerDoc || { _id: r.referrer, name: 'System Admin', email: 'admin@minetrades.test', referralCode: 'TXMADMIN01' }), toString: () => String(r.referrer) }
              : r.referrer,
            referredUser: populatePaths.includes('referredUser')
              ? { ...(referredDoc || { _id: r.referredUser, name: 'Nikku Investor', email: 'nikku@example.com', referralCode: 'TXMNIKKU01' }), toString: () => String(r.referredUser) }
              : r.referredUser,
          };
          doc.toObject = () => ({ ...doc });
          return doc;
        });
      });
    };

    ReferralReward.countDocuments = async () => referralRewards.size;

    ReferralReward.aggregate = async (pipeline = []) => {
      const matchStage = pipeline.find((s) => s.$match)?.$match;
      let items = [...referralRewards.values()];
      if (matchStage?.status?.$in) {
        items = items.filter((r) => matchStage.status.$in.includes(r.status));
      }
      const total = items.reduce((acc, r) => acc + Number(r.rewardAmount || 0), 0);
      return [{ _id: null, total, count: items.length }];
    };

    // WebhookEvent Stub
    WebhookEvent.countDocuments = async () => 0;

    // Transaction Stubs
    Transaction.find = (query = {}) => {
      return createQuery(() => {
        let result = [...transactions];
        if (query.user) {
          result = result.filter((t) => String(t.user) === String(query.user));
        }
        return result.map((t) => ({ ...t, toObject: () => ({ ...t }) }));
      });
    };

    Transaction.aggregate = async (pipeline = []) => {
      const matchStage = pipeline.find((s) => s.$match)?.$match;
      const groupStage = pipeline.find((s) => s.$group)?.$group;

      let items = [...transactions];
      if (matchStage?.user?.$in) {
        const allowed = matchStage.user.$in.map(String);
        items = items.filter((t) => allowed.includes(String(t.user)));
      }

      if (groupStage?._id === '$user') {
        const userLastTx = new Map();
        items.forEach((t) => {
          const uId = String(t.user);
          if (!userLastTx.has(uId)) {
            userLastTx.set(uId, t.createdAt);
          }
        });
        return [...userLastTx.entries()].map(([uId, lastDate]) => ({
          _id: uId,
          lastDate,
        }));
      }
      return [];
    };
  });

  // =========================================================================
  // 1. SECURITY & AUTHORIZATION TESTS
  // =========================================================================

  it('1. rejects unauthenticated access to admin users endpoint with 401', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/users`);
    assert.strictEqual(res.status, 401);
  });

  it('2. rejects regular user (role: "user") from accessing admin hub with 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res.status, 403);
  });

  it('3. allows authenticated admin (role: "admin") to access admin endpoints with 200 and returns verified overview metrics', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data);

    // Dynamic overview metrics matching seeded in-memory state
    assert.strictEqual(body.data.users.total, 2);
    assert.strictEqual(body.data.users.active, 2);
    assert.strictEqual(body.data.investments.activePlansCount, 1);
    assert.strictEqual(body.data.investments.totalInvestmentAmount, 300);
    assert.strictEqual(body.data.wallets.totalSystemBalance, 1500);
    assert.strictEqual(body.data.deposits.totalAmount, 1000);
    assert.strictEqual(body.data.deposits.totalCount, 1);
    assert.strictEqual(body.data.deposits.pendingCount, 0);
    assert.strictEqual(body.data.withdrawals.totalCompletedAmount, 300);
    assert.strictEqual(body.data.withdrawals.totalCompletedCount, 1);
    assert.strictEqual(body.data.withdrawals.pendingCount, 0);
    assert.strictEqual(body.data.withdrawals.quarantinedCount, 0);
    assert.strictEqual(body.data.referrals.totalRewardedAmount, 100);
    assert.strictEqual(body.data.referrals.totalRewardedCount, 1);
  });

  // =========================================================================
  // 2. USERS MANAGEMENT TESTS (HISTORICAL & FUTURE USERS)
  // =========================================================================

  it('4. returns all registered users including historical users with authoritative wallet data', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);

    const usersList = body.data?.users || body.users;
    assert.ok(Array.isArray(usersList));
    assert.strictEqual(usersList.length, 2);

    const investor = usersList.find((u) => u.email === 'nikku@example.com');
    assert.ok(investor, 'Investor must be present in users list');
    assert.strictEqual(investor.name, 'Nikku Investor');
    assert.strictEqual(investor.role, 'user');
    assert.strictEqual(investor.referralCode, 'TXMNIKKU01');
    assert.strictEqual(investor.walletBalance, 1500);
    assert.strictEqual(investor.planIncome, 50);
    assert.strictEqual(investor.referralIncome, 100);
    assert.strictEqual(investor.totalWithdrawn, 300);
    assert.strictEqual(investor.activePlansCount, 1);
  });

  it('5. automatically includes new users registered in the future without manual config', async () => {
    // Add new user dynamically to in-memory store
    users.set(String(newUserId), {
      _id: newUserId,
      name: 'Future Member',
      email: 'future@minetrades.test',
      role: 'user',
      referralCode: 'TXMFUTURE99',
      isActive: true,
      createdAt: new Date(),
    });

    const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const usersList = body.data?.users || body.users;
    assert.strictEqual(usersList.length, 3);
    assert.ok(usersList.some((u) => u.email === 'future@minetrades.test'));
  });

  it('6. filters users by role correctly (role: admin)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/users?role=admin`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const usersList = body.data?.users || body.users;
    assert.strictEqual(usersList.length, 1);
    assert.strictEqual(usersList[0].role, 'admin');
  });

  // =========================================================================
  // 3. ACTIVE INVESTMENTS TESTS (₹300 PLAN PURCHASE & HISTORICAL RECORDS)
  // =========================================================================

  it('7. displays purchased ₹300 Starter Plan investment under the correct user', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/active-investments`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);

    const investments = body.data?.investments || body.investments;
    assert.ok(Array.isArray(investments));
    assert.strictEqual(investments.length, 1);

    const inv = investments[0];
    assert.strictEqual(inv.planName, 'Starter Plan');
    assert.strictEqual(inv.planAmount, 300);
    assert.strictEqual(inv.price, 300);
    assert.strictEqual(inv.status, 'active');
    assert.strictEqual(inv.user.email, 'nikku@example.com');
    assert.strictEqual(inv.user.name, 'Nikku Investor');
    assert.strictEqual(String(inv.investmentId), String(userPlanId300));
    assert.strictEqual(inv.dailyYield, 3);
    assert.ok(inv.startDate);
    assert.ok(inv.endDate);
  });

  it('8. filters out cancelled or completed investments when status=active', async () => {
    // Add completed plan to in-memory store
    const completedPlanId = new mongoose.Types.ObjectId();
    userPlans.set(String(completedPlanId), {
      _id: completedPlanId,
      user: regularUserId,
      planName: 'Expired Mining Node',
      price: 500,
      status: 'completed',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-10-01'),
      createdAt: new Date('2026-09-01'),
    });

    const res = await fetch(`${baseUrl}/api/v1/admin/active-investments?status=active`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const investments = body.data?.investments || body.investments;

    // Completed plan must NOT appear in active query
    assert.strictEqual(investments.length, 1);
    assert.strictEqual(investments[0].status, 'active');
  });

  // =========================================================================
  // 4. WALLET MANAGEMENT & FINANCIAL INTEGRITY TESTS
  // =========================================================================

  it('9. serves authoritative wallet balances and dynamic aggregations without fabrication', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/wallets`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const walletsList = body.data?.wallets || body.wallets;

    assert.ok(Array.isArray(walletsList));
    assert.strictEqual(walletsList.length, 1);

    const w = walletsList[0];
    assert.strictEqual(w.balance, 1500);
    assert.strictEqual(w.availableBalance, 1500);
    assert.strictEqual(w.planIncome, 50);
    assert.strictEqual(w.referralIncome, 100);
    assert.strictEqual(w.totalDeposits, 1000);
    assert.strictEqual(w.totalWithdrawals, 300);
    assert.ok(w.lastTransactionDate);
  });

  // =========================================================================
  // 5. DEPOSIT, PAYMENT, REFERRAL & WITHDRAWAL RECORDS TESTS
  // =========================================================================

  it('10. returns verified deposits with reference ID, provider, and status', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/deposits`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const depositsList = body.data?.deposits || body.deposits;

    assert.ok(Array.isArray(depositsList));
    assert.strictEqual(depositsList.length, 1);
    assert.strictEqual(depositsList[0].depositReference, 'DEP-TEST-1000');
    assert.strictEqual(depositsList[0].amount, 1000);
    assert.strictEqual(depositsList[0].status, 'completed');
    assert.strictEqual(depositsList[0].user.email, 'nikku@example.com');
  });

  it('11. returns payments with gateway order ID, captured status, and user association', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/payments`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const paymentsList = body.data?.payments || body.payments;

    assert.ok(Array.isArray(paymentsList));
    assert.strictEqual(paymentsList.length, 1);
    assert.strictEqual(paymentsList[0].orderId, 'order_test_rzp_300');
    assert.strictEqual(paymentsList[0].amount, 300);
    assert.strictEqual(paymentsList[0].status, 'captured');
    assert.strictEqual(paymentsList[0].user.email, 'nikku@example.com');
  });

  it('12. returns referrals roster with referrer, referred user, and reward amounts', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/referrals`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const rewardsList = body.data?.rewards || body.rewards;

    assert.ok(Array.isArray(rewardsList));
    assert.strictEqual(rewardsList.length, 1);
    assert.strictEqual(rewardsList[0].rewardReference, 'REF-TEST-100');
    assert.strictEqual(rewardsList[0].rewardAmount, 100);
    assert.strictEqual(rewardsList[0].status, 'CREDITED');
    assert.strictEqual(rewardsList[0].referrer.email, 'admin@minetrades.test');
    assert.strictEqual(rewardsList[0].referredUser.email, 'nikku@example.com');
  });

  it('13. returns admin withdrawals roster with status, user details, and payout details', async () => {
    const res = await fetch(`${baseUrl}/api/v1/wallet/admin/withdrawals`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);

    const withdrawalsList = body.withdrawals;
    assert.ok(Array.isArray(withdrawalsList));
    assert.strictEqual(withdrawalsList.length, 1);
    assert.strictEqual(withdrawalsList[0].amount, 300);
    assert.strictEqual(withdrawalsList[0].status, 'COMPLETED');
    assert.strictEqual(withdrawalsList[0].payoutMethod, 'UPI');
    assert.strictEqual(withdrawalsList[0].user.email, 'nikku@example.com');
  });
});
