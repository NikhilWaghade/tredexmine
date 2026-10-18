import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { Plan } from '../src/models/Plan.js';
import { UserPlan } from '../src/models/UserPlan.js';
import { Wallet } from '../src/models/Wallet.js';
import { Transaction } from '../src/models/Transaction.js';
import { User } from '../src/models/User.js';
import {
  getPlans,
  getPlanById,
  purchasePlan as purchasePlanController,
  getMyActivePlans,
  createPlan as createPlanController,
} from '../src/controllers/planController.js';
import {
  purchasePlan,
  getUserActivePlans,
  createPlan as createPlanService,
} from '../src/services/planService.js';
import * as walletService from '../src/services/walletService.js';
import { generateAccessToken } from '../src/utils/tokenService.js';
import { authorize } from '../src/middleware/authorize.js';
import { createPlanValidation } from '../src/validators/planValidators.js';

describe('Plans Module Tests', () => {
  describe('Plan Model Schema Validation', () => {
    it('validates a properly formatted plan object in-memory', async () => {
      const plan = new Plan({
        name: 'Standard Compute',
        tag: 'Popular',
        description: 'Mid-tier cloud computing cluster',
        price: 99.99,
        durationDays: 30,
        dailyRoiRate: 0.015,
        hashRate: '50 TH/s',
        features: ['24/7 Monitoring', 'Daily Yield Calculation'],
      });

      await plan.validate();
      assert.strictEqual(plan.isActive, true);
      assert.strictEqual(plan.sortOrder, 0);
    });

    it('fails validation when plan name is missing', async () => {
      const plan = new Plan({
        price: 50,
        durationDays: 14,
      });

      await assert.rejects(
        async () => {
          await plan.validate();
        },
        (err) => {
          assert.ok(err.errors.name);
          assert.strictEqual(err.errors.name.message, 'Plan name is required');
          return true;
        }
      );
    });

    it('fails validation when price is zero or negative', async () => {
      const planZeroPrice = new Plan({
        name: 'Zero Price Plan',
        price: 0,
        durationDays: 30,
      });

      await assert.rejects(
        async () => {
          await planZeroPrice.validate();
        },
        (err) => {
          assert.ok(err.errors.price);
          return true;
        }
      );

      const planNegativePrice = new Plan({
        name: 'Negative Price Plan',
        price: -10,
        durationDays: 30,
      });

      await assert.rejects(
        async () => {
          await planNegativePrice.validate();
        },
        (err) => {
          assert.ok(err.errors.price);
          return true;
        }
      );
    });

    it('fails validation when durationDays is not an integer or is less than 1', async () => {
      const planFractional = new Plan({
        name: 'Fractional Days Plan',
        price: 100,
        durationDays: 14.5,
      });

      await assert.rejects(
        async () => {
          await planFractional.validate();
        },
        (err) => {
          assert.ok(err.errors.durationDays);
          return true;
        }
      );

      const planZeroDays = new Plan({
        name: 'Zero Days Plan',
        price: 100,
        durationDays: 0,
      });

      await assert.rejects(
        async () => {
          await planZeroDays.validate();
        },
        (err) => {
          assert.ok(err.errors.durationDays);
          return true;
        }
      );
    });

    it('fails validation when dailyRoiRate is negative', async () => {
      const planNegativeRoi = new Plan({
        name: 'Negative ROI Plan',
        price: 100,
        durationDays: 30,
        dailyRoiRate: -0.05,
      });

      await assert.rejects(
        async () => {
          await planNegativeRoi.validate();
        },
        (err) => {
          assert.ok(err.errors.dailyRoiRate);
          return true;
        }
      );
    });
  });

  describe('UserPlan Model Schema Validation', () => {
    it('validates a properly formatted user plan object in-memory', async () => {
      const userPlan = new UserPlan({
        user: new mongoose.Types.ObjectId(),
        plan: new mongoose.Types.ObjectId(),
        planName: 'Cloud Cluster Pro',
        price: 150,
        durationDays: 60,
        startDate: new Date(),
        endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      });

      await userPlan.validate();
      assert.strictEqual(userPlan.status, 'active');
      assert.strictEqual(userPlan.dailyRoiRate, 0);
    });

    it('fails validation when required snapshots are missing', async () => {
      const userPlan = new UserPlan({
        user: new mongoose.Types.ObjectId(),
      });

      await assert.rejects(
        async () => {
          await userPlan.validate();
        },
        (err) => {
          assert.ok(err.errors.plan);
          assert.ok(err.errors.planName);
          assert.ok(err.errors.price);
          assert.ok(err.errors.durationDays);
          assert.ok(err.errors.endDate);
          return true;
        }
      );
    });
  });

  describe('Plan Purchase Service & Financial Integrity', () => {
    const mockUserId = new mongoose.Types.ObjectId().toString();
    const mockPlanId = new mongoose.Types.ObjectId().toString();
    const mockWalletId = new mongoose.Types.ObjectId().toString();

    const samplePlan = {
      _id: mockPlanId,
      name: 'High-Yield Mining Node',
      price: 100,
      durationDays: 30,
      dailyRoiRate: 0.02,
      hashRate: '60 TH/s',
      features: ['Priority Hashrate'],
      isActive: true,
    };

    it('successfully purchases plan: deducts wallet balance, creates UserPlan, creates debit Transaction', async () => {
      let walletBalance = 250;
      let createdUserPlan = null;
      let createdTransaction = null;

      const origPlanFindOne = Plan.findOne;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origUserPlanFindOne = UserPlan.findOne;
      const origUserPlanCreate = UserPlan.create;
      const origTxCreate = Transaction.create;

      Plan.findOne = async () => samplePlan;
      UserPlan.findOne = async () => null;
      Wallet.findOne = async () => ({ _id: mockWalletId, user: mockUserId, balance: walletBalance });

      Wallet.findOneAndUpdate = async (query, update) => {
        if (query.balance?.$gte && walletBalance < query.balance.$gte) {
          return null;
        }
        if (update.$inc?.balance) {
          walletBalance += update.$inc.balance;
        }
        return { _id: mockWalletId, user: mockUserId, balance: walletBalance };
      };

      UserPlan.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        createdUserPlan = { _id: new mongoose.Types.ObjectId(), ...item };
        return Array.isArray(data) ? [createdUserPlan] : createdUserPlan;
      };

      Transaction.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        createdTransaction = { _id: new mongoose.Types.ObjectId(), ...item };
        return Array.isArray(data) ? [createdTransaction] : createdTransaction;
      };

      try {
        const result = await purchasePlan(mockUserId, mockPlanId);

        assert.strictEqual(result.walletBalance, 150);
        assert.strictEqual(result.userPlan.price, 100);
        assert.strictEqual(result.userPlan.planName, samplePlan.name);
        assert.strictEqual(result.userPlan.status, 'active');
        assert.strictEqual(result.isIdempotent, false);

        assert.ok(createdTransaction);
        assert.strictEqual(createdTransaction.type, 'debit');
        assert.strictEqual(createdTransaction.amount, 100);
        assert.strictEqual(createdTransaction.status, 'completed');
        assert.strictEqual(createdTransaction.wallet.toString(), mockWalletId.toString());
      } finally {
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        Transaction.create = origTxCreate;
      }
    });

    it('fails when plan ID format is invalid', async () => {
      await assert.rejects(
        async () => {
          await purchasePlan(mockUserId, 'invalid-mongo-id');
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.message, 'Invalid plan ID format');
          return true;
        }
      );
    });

    it('fails when plan is inactive or missing', async () => {
      const origPlanFindOne = Plan.findOne;
      Plan.findOne = async () => null;

      try {
        await assert.rejects(
          async () => {
            await purchasePlan(mockUserId, mockPlanId);
          },
          (err) => {
            assert.strictEqual(err.statusCode, 404);
            assert.strictEqual(err.message, 'Plan not found or is currently inactive');
            return true;
          }
        );
      } finally {
        Plan.findOne = origPlanFindOne;
      }
    });

    it('fails when user has insufficient balance and leaves wallet unchanged', async () => {
      let walletBalance = 50; // Plan price is 100
      let userPlanCreated = false;
      let txCreated = false;

      const origPlanFindOne = Plan.findOne;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origUserPlanCreate = UserPlan.create;
      const origTxCreate = Transaction.create;

      Plan.findOne = async () => samplePlan;
      Wallet.findOne = async () => ({ _id: mockWalletId, user: mockUserId, balance: walletBalance });

      Wallet.findOneAndUpdate = async (query, update) => {
        if (query.balance?.$gte && walletBalance < query.balance.$gte) {
          return null; // Atomic failure
        }
        if (update.$inc?.balance) {
          walletBalance += update.$inc.balance;
        }
        return { _id: mockWalletId, user: mockUserId, balance: walletBalance };
      };

      UserPlan.create = async () => {
        userPlanCreated = true;
      };
      Transaction.create = async () => {
        txCreated = true;
      };

      try {
        await assert.rejects(
          async () => {
            await purchasePlan(mockUserId, mockPlanId);
          },
          (err) => {
            assert.strictEqual(err.statusCode, 400);
            assert.strictEqual(err.message, 'Insufficient wallet balance');
            return true;
          }
        );

        // Verify wallet remains exactly unchanged
        assert.strictEqual(walletBalance, 50);
        assert.strictEqual(userPlanCreated, false);
        assert.strictEqual(txCreated, false);
      } finally {
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.create = origUserPlanCreate;
        Transaction.create = origTxCreate;
      }
    });

    it('prevents concurrent purchases from overspending available balance', async () => {
      let walletBalance = 100; // Only enough for exactly one purchase of 100
      let successfulPurchases = 0;
      let failedPurchases = 0;

      const origPlanFindOne = Plan.findOne;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origUserPlanFindOne = UserPlan.findOne;
      const origUserPlanCreate = UserPlan.create;
      const origTxCreate = Transaction.create;

      Plan.findOne = async () => samplePlan;
      UserPlan.findOne = async () => null;
      Wallet.findOne = async () => ({ _id: mockWalletId, user: mockUserId, balance: walletBalance });

      // Simulate atomic document-level lock in MongoDB
      Wallet.findOneAndUpdate = async (query, update) => {
        if (query.balance?.$gte && walletBalance < query.balance.$gte) {
          return null;
        }
        if (update.$inc?.balance) {
          walletBalance += update.$inc.balance;
        }
        return { _id: mockWalletId, user: mockUserId, balance: walletBalance };
      };

      UserPlan.create = async (data) => [data];
      Transaction.create = async (data) => [data];

      try {
        const results = await Promise.allSettled([
          purchasePlan(mockUserId, mockPlanId),
          purchasePlan(mockUserId, mockPlanId),
        ]);

        results.forEach((r) => {
          if (r.status === 'fulfilled') {
            successfulPurchases++;
          } else {
            failedPurchases++;
            assert.strictEqual(r.reason.statusCode, 400);
          }
        });

        // Exactly one purchase succeeded, the second was rejected
        assert.strictEqual(successfulPurchases, 1);
        assert.strictEqual(failedPurchases, 1);
        assert.strictEqual(walletBalance, 0); // Not negative
      } finally {
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        Transaction.create = origTxCreate;
      }
    });

    it('failed database transaction rolls back all related writes', async () => {
      let walletBalance = 200;

      const origPlanFindOne = Plan.findOne;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origUserPlanFindOne = UserPlan.findOne;
      const origUserPlanCreate = UserPlan.create;
      const origTxCreate = Transaction.create;

      Plan.findOne = async () => samplePlan;
      UserPlan.findOne = async () => null;
      Wallet.findOne = async () => ({ _id: mockWalletId, user: mockUserId, balance: walletBalance });

      Wallet.findOneAndUpdate = async (query, update) => {
        if (update.$inc?.balance) {
          walletBalance += update.$inc.balance;
        }
        return { _id: mockWalletId, user: mockUserId, balance: walletBalance };
      };

      UserPlan.create = async (data) => [data];
      // Simulate fatal write failure during Transaction creation
      Transaction.create = async () => {
        throw new Error('Database disk full or constraint violation');
      };

      try {
        await assert.rejects(
          async () => {
            await purchasePlan(mockUserId, mockPlanId);
          },
          (err) => {
            assert.strictEqual(err.message, 'Database disk full or constraint violation');
            return true;
          }
        );

        // Verify balance was rolled back to original 200
        assert.strictEqual(walletBalance, 200);
      } finally {
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        Transaction.create = origTxCreate;
      }
    });

    it('idempotent retry with the same key does not double-charge balance', async () => {
      let walletBalance = 300;
      let existingPlan = null;

      const origPlanFindOne = Plan.findOne;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origUserPlanFindOne = UserPlan.findOne;
      const origUserPlanCreate = UserPlan.create;
      const origTxCreate = Transaction.create;

      Plan.findOne = async () => samplePlan;
      Wallet.findOne = async () => ({ _id: mockWalletId, user: mockUserId, balance: walletBalance });

      Wallet.findOneAndUpdate = async (query, update) => {
        if (update.$inc?.balance) {
          walletBalance += update.$inc.balance;
        }
        return { _id: mockWalletId, user: mockUserId, balance: walletBalance };
      };

      UserPlan.findOne = async (q) => (q.idempotencyKey === 'unique-client-key-999' ? existingPlan : null);
      UserPlan.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        existingPlan = { _id: new mongoose.Types.ObjectId(), ...item };
        return Array.isArray(data) ? [existingPlan] : existingPlan;
      };
      Transaction.create = async (data) => [data];

      try {
        // First purchase with key
        const first = await purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'unique-client-key-999' });
        assert.strictEqual(first.walletBalance, 200);
        assert.strictEqual(first.isIdempotent, false);

        // Retry with same key
        const second = await purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'unique-client-key-999' });
        assert.strictEqual(second.walletBalance, 200); // Balance NOT deducted again!
        assert.strictEqual(second.isIdempotent, true);
        assert.strictEqual(second.userPlan._id.toString(), first.userPlan._id.toString());
      } finally {
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        Transaction.create = origTxCreate;
      }
    });

    it('users cannot retrieve another user active plan records', async () => {
      const userAId = new mongoose.Types.ObjectId().toString();
      const userBId = new mongoose.Types.ObjectId().toString();

      const origUserPlanFind = UserPlan.find;

      UserPlan.find = (query) => {
        const mockStore = [
          { _id: new mongoose.Types.ObjectId(), user: userAId, planName: 'Plan A', status: 'active' },
          { _id: new mongoose.Types.ObjectId(), user: userBId, planName: 'Plan B', status: 'active' },
        ];
        return {
          sort: () => Promise.resolve(mockStore.filter((p) => p.user === query.user && p.status === query.status)),
        };
      };

      try {
        const userAPlans = await getUserActivePlans(userAId);
        assert.strictEqual(userAPlans.length, 1);
        assert.strictEqual(userAPlans[0].planName, 'Plan A');
        assert.strictEqual(userAPlans[0].user, userAId);

        const userBPlans = await getUserActivePlans(userBId);
        assert.strictEqual(userBPlans.length, 1);
        assert.strictEqual(userBPlans[0].planName, 'Plan B');
        assert.strictEqual(userBPlans[0].user, userBId);
      } finally {
        UserPlan.find = origUserPlanFind;
      }
    });
  });

  describe('Role-Based Authorization Middleware (authorize)', () => {
    it('returns 401 when req.user is missing', () => {
      const req = {};
      const res = {
        statusCode: null,
        jsonData: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.jsonData = data;
          return this;
        },
      };
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      const authMiddleware = authorize('admin');
      authMiddleware(req, res, next);

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.jsonData.success, false);
      assert.ok(res.jsonData.message.includes('authentication required'));
    });

    it('returns 403 Forbidden when req.user.role is not authorized', () => {
      const req = { user: { role: 'user' } };
      const res = {
        statusCode: null,
        jsonData: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.jsonData = data;
          return this;
        },
      };
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      const authMiddleware = authorize('admin');
      authMiddleware(req, res, next);

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.jsonData.success, false);
      assert.ok(res.jsonData.message.includes('Forbidden'));
    });

    it('calls next() when req.user.role matches allowed role', () => {
      const req = { user: { role: 'admin' } };
      const res = {
        statusCode: null,
        jsonData: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.jsonData = data;
          return this;
        },
      };
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      const authMiddleware = authorize('admin');
      authMiddleware(req, res, next);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(res.statusCode, null);
    });
  });

  describe('Plan Creation Validation (createPlanValidation)', () => {
    const createMockRes = () => ({
      statusCode: null,
      jsonData: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.jsonData = data;
        return this;
      },
    });

    it('fails when body is not an object', () => {
      const req = { body: null };
      const res = createMockRes();
      let nextCalled = false;
      createPlanValidation(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.jsonData.success, false);
    });

    it('fails when client supplies _id or timestamps', () => {
      const req = {
        body: {
          _id: '652a1234567890abcdef1234',
          createdAt: new Date(),
          name: 'Pro Miner',
          price: 150,
          durationDays: 30,
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      createPlanValidation(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.jsonData.errors.some((e) => e.includes('Client-supplied ID')));
      assert.ok(res.jsonData.errors.some((e) => e.includes('timestamps')));
    });

    it('fails when unintended extra fields are present', () => {
      const req = {
        body: {
          name: 'Pro Miner',
          price: 150,
          durationDays: 30,
          customMaliciousField: true,
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      createPlanValidation(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.jsonData.errors.some((e) => e.includes('Unintended fields are not allowed')));
    });

    it('fails when required fields are missing or invalid', () => {
      const req = {
        body: {
          name: 'A',
          price: -50,
          durationDays: 0.5,
          dailyRoiRate: -0.01,
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      createPlanValidation(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.jsonData.errors.some((e) => e.includes('between 2 and 100 characters')));
      assert.ok(res.jsonData.errors.some((e) => e.includes('greater than zero')));
      assert.ok(res.jsonData.errors.some((e) => e.includes('must be an integer')));
      assert.ok(res.jsonData.errors.some((e) => e.includes('Daily ROI rate cannot be negative')));
    });

    it('passes validation for valid plan creation data', () => {
      const req = {
        body: {
          name: 'Enterprise Mining Cluster',
          tag: 'Best Value',
          description: 'High capacity mining cluster',
          price: 499.99,
          durationDays: 60,
          dailyRoiRate: 0.02,
          hashRate: '150 TH/s',
          features: ['Dedicated Rig', 'Priority Support'],
          isActive: true,
          sortOrder: 1,
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      createPlanValidation(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(res.statusCode, null);
    });
  });

  describe('Plan Creation Service (createPlan)', () => {
    it('creates a new plan with sanitized properties', async () => {
      const origPlanCreate = Plan.create;
      let capturedPayload = null;

      Plan.create = async (payload) => {
        capturedPayload = payload;
        return {
          _id: new mongoose.Types.ObjectId(),
          ...payload,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      };

      try {
        const plan = await createPlanService({
          name: '  Gold Miner Plan  ',
          tag: 'Gold',
          description: 'Top grade performance',
          price: 250,
          durationDays: 45,
          dailyRoiRate: 0.018,
          hashRate: '80 TH/s',
          features: ['Automated Reinvestment'],
          isActive: true,
          sortOrder: 2,
        });

        assert.strictEqual(capturedPayload.name, 'Gold Miner Plan');
        assert.strictEqual(capturedPayload.price, 250);
        assert.strictEqual(capturedPayload.durationDays, 45);
        assert.strictEqual(capturedPayload.dailyRoiRate, 0.018);
        assert.strictEqual(plan.name, 'Gold Miner Plan');
      } finally {
        Plan.create = origPlanCreate;
      }
    });
  });

  describe('Plan HTTP Endpoint Integration Tests', () => {
    let server;
    let baseUrl;

    before(async () => {
      process.env.NODE_ENV = 'test';
      server = http.createServer(app);
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          baseUrl = `http://127.0.0.1:${address.port}`;
          resolve();
        });
      });
    });

    after(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it('GET /api/v1/plans returns 200 with active plans list', async () => {
      const originalFind = Plan.find;
      const mockPlans = [
        { _id: '652a1111111111abcdef1111', name: 'Starter', price: 50, sortOrder: 1, isActive: true },
      ];
      Plan.find = () => ({
        sort: () => Promise.resolve(mockPlans),
      });

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans`);
        assert.strictEqual(response.status, 200);

        const body = await response.json();
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.count, 1);
        assert.strictEqual(body.plans[0].name, 'Starter');
      } finally {
        Plan.find = originalFind;
      }
    });

    it('GET /api/v1/plans/invalid-format returns 400 Bad Request', async () => {
      const response = await fetch(`${baseUrl}/api/v1/plans/invalid-format`);
      assert.strictEqual(response.status, 400);

      const body = await response.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Invalid plan ID format');
    });

    it('GET /api/v1/plans/652a1234567890abcdef1234 returns 404 Not Found when plan not in DB', async () => {
      const originalFindOne = Plan.findOne;
      Plan.findOne = async () => null;

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans/652a1234567890abcdef1234`);
        assert.strictEqual(response.status, 404);

        const body = await response.json();
        assert.strictEqual(body.success, false);
        assert.strictEqual(body.message, 'Plan not found');
      } finally {
        Plan.findOne = originalFindOne;
      }
    });

    it('POST /api/v1/plans/:id/purchase rejects unauthenticated request with 401', async () => {
      const response = await fetch(`${baseUrl}/api/v1/plans/652a1234567890abcdef1234/purchase`, {
        method: 'POST',
      });
      assert.strictEqual(response.status, 401);

      const body = await response.json();
      assert.strictEqual(body.success, false);
      assert.ok(body.message.includes('token missing') || body.message.includes('Not authorized'));
    });

    it('GET /api/v1/plans/my/active rejects unauthenticated request with 401', async () => {
      const response = await fetch(`${baseUrl}/api/v1/plans/my/active`);
      assert.strictEqual(response.status, 401);

      const body = await response.json();
      assert.strictEqual(body.success, false);
      assert.ok(body.message.includes('token missing') || body.message.includes('Not authorized'));
    });

    it('POST /api/v1/plans rejects unauthenticated request with 401', async () => {
      const response = await fetch(`${baseUrl}/api/v1/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Unauth Plan',
          price: 100,
          durationDays: 30,
        }),
      });
      assert.strictEqual(response.status, 401);

      const body = await response.json();
      assert.strictEqual(body.success, false);
      assert.ok(body.message.includes('token missing') || body.message.includes('Not authorized'));
    });

    it('POST /api/v1/plans rejects ordinary user (role: user) with 403 Forbidden', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const mockUser = {
        _id: userId,
        name: 'Regular User',
        email: 'user@example.com',
        role: 'user',
      };
      const token = generateAccessToken({ id: userId, role: 'user' });

      const origUserFindById = User.findById;
      User.findById = () => ({
        select: () => Promise.resolve(mockUser),
      });

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: 'Attempted User Plan',
            price: 100,
            durationDays: 30,
          }),
        });
        assert.strictEqual(response.status, 403);

        const body = await response.json();
        assert.strictEqual(body.success, false);
        assert.ok(body.message.includes('Forbidden'));
      } finally {
        User.findById = origUserFindById;
      }
    });

    it('POST /api/v1/plans rejects admin request with missing or invalid fields with 400', async () => {
      const adminId = new mongoose.Types.ObjectId().toString();
      const mockAdmin = {
        _id: adminId,
        name: 'Admin User',
        email: 'admin@example.com',
        role: 'admin',
      };
      const token = generateAccessToken({ id: adminId, role: 'admin' });

      const origUserFindById = User.findById;
      User.findById = () => ({
        select: () => Promise.resolve(mockAdmin),
      });

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: '',
            price: -10,
            durationDays: 0,
          }),
        });
        assert.strictEqual(response.status, 400);

        const body = await response.json();
        assert.strictEqual(body.success, false);
        assert.strictEqual(body.message, 'Validation failed');
        assert.ok(Array.isArray(body.errors));
      } finally {
        User.findById = origUserFindById;
      }
    });

    it('POST /api/v1/plans rejects admin request with unintended or client-supplied ID fields with 400', async () => {
      const adminId = new mongoose.Types.ObjectId().toString();
      const mockAdmin = {
        _id: adminId,
        name: 'Admin User',
        email: 'admin@example.com',
        role: 'admin',
      };
      const token = generateAccessToken({ id: adminId, role: 'admin' });

      const origUserFindById = User.findById;
      User.findById = () => ({
        select: () => Promise.resolve(mockAdmin),
      });

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            _id: '652a1234567890abcdef1234',
            name: 'Hacked ID Plan',
            price: 100,
            durationDays: 30,
          }),
        });
        assert.strictEqual(response.status, 400);

        const body = await response.json();
        assert.strictEqual(body.success, false);
        assert.ok(body.errors.some((e) => e.includes('Client-supplied ID')));
      } finally {
        User.findById = origUserFindById;
      }
    });

    it('POST /api/v1/plans successfully creates plan when authenticated as admin and returns 201', async () => {
      const adminId = new mongoose.Types.ObjectId().toString();
      const mockAdmin = {
        _id: adminId,
        name: 'Admin User',
        email: 'admin@example.com',
        role: 'admin',
      };
      const token = generateAccessToken({ id: adminId, role: 'admin' });

      const origUserFindById = User.findById;
      const origPlanCreate = Plan.create;

      User.findById = () => ({
        select: () => Promise.resolve(mockAdmin),
      });

      Plan.create = async (payload) => ({
        _id: '652a9876543210fedcba9876',
        ...payload,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: 'Cloud ASIC Pro',
            tag: 'Top Seller',
            description: 'Commercial ASIC miner lease',
            price: 299.99,
            durationDays: 30,
            dailyRoiRate: 0.015,
            hashRate: '120 TH/s',
            features: ['Instant setup', 'Daily payouts'],
            isActive: true,
            sortOrder: 1,
          }),
        });
        assert.strictEqual(response.status, 201);

        const body = await response.json();
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.message, 'Plan created successfully');
        assert.strictEqual(body.plan.name, 'Cloud ASIC Pro');
        assert.strictEqual(body.plan.price, 299.99);
      } finally {
        User.findById = origUserFindById;
        Plan.create = origPlanCreate;
      }
    });

    it('POST /api/v1/plans handles database failure and passes error to error middleware', async () => {
      const adminId = new mongoose.Types.ObjectId().toString();
      const mockAdmin = {
        _id: adminId,
        name: 'Admin User',
        email: 'admin@example.com',
        role: 'admin',
      };
      const token = generateAccessToken({ id: adminId, role: 'admin' });

      const origUserFindById = User.findById;
      const origPlanCreate = Plan.create;

      User.findById = () => ({
        select: () => Promise.resolve(mockAdmin),
      });

      Plan.create = async () => {
        throw new Error('Database connection dropped unexpectedly');
      };

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: 'Crash Test Plan',
            price: 50,
            durationDays: 14,
          }),
        });
        assert.strictEqual(response.status, 500);

        const body = await response.json();
        assert.strictEqual(body.success, false);
        assert.ok(body.message.includes('Database connection dropped'));
      } finally {
        User.findById = origUserFindById;
        Plan.create = origPlanCreate;
      }
    });

    it('POST /api/v1/plans/:id/purchase succeeds when authenticated with sufficient balance', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const planId = new mongoose.Types.ObjectId().toString();
      const walletId = new mongoose.Types.ObjectId().toString();

      const mockUser = {
        _id: userId,
        name: 'Test Buyer',
        email: 'buyer@example.com',
        role: 'user',
      };
      const token = generateAccessToken({ id: userId, role: 'user' });

      const mockPlan = {
        _id: planId,
        name: 'Pro Mining Rig',
        price: 100,
        durationDays: 30,
        isActive: true,
      };

      const origUserFindById = User.findById;
      const origPlanFindOne = Plan.findOne;
      const origUserPlanFindOne = UserPlan.findOne;
      const origUserPlanCreate = UserPlan.create;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origTxCreate = Transaction.create;

      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      Plan.findOne = async () => mockPlan;
      UserPlan.findOne = async () => null;
      Wallet.findOne = async () => ({ _id: walletId, user: userId, balance: 250 });
      Wallet.findOneAndUpdate = async () => ({ _id: walletId, user: userId, balance: 150 });
      UserPlan.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const res = { _id: new mongoose.Types.ObjectId(), ...item };
        return Array.isArray(data) ? [res] : res;
      };
      Transaction.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const res = { _id: new mongoose.Types.ObjectId(), ...item };
        return Array.isArray(data) ? [res] : res;
      };

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans/${planId}/purchase`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'Idempotency-Key': 'client-test-key-1',
          },
        });
        assert.strictEqual(response.status, 201);

        const body = await response.json();
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.message, 'Plan purchased successfully');
        assert.strictEqual(body.data.walletBalance, 150);
        assert.strictEqual(body.data.userPlan.planName, 'Pro Mining Rig');
      } finally {
        User.findById = origUserFindById;
        Plan.findOne = origPlanFindOne;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        Transaction.create = origTxCreate;
      }
    });

    it('POST /api/v1/plans/:id/purchase returns 400 when user has insufficient balance', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const planId = new mongoose.Types.ObjectId().toString();
      const walletId = new mongoose.Types.ObjectId().toString();

      const mockUser = {
        _id: userId,
        name: 'Broke Buyer',
        email: 'broke@example.com',
        role: 'user',
      };
      const token = generateAccessToken({ id: userId, role: 'user' });

      const mockPlan = {
        _id: planId,
        name: 'Expensive Cluster',
        price: 500,
        durationDays: 30,
        isActive: true,
      };

      const origUserFindById = User.findById;
      const origPlanFindOne = Plan.findOne;
      const origWalletFindOne = Wallet.findOne;
      const origUserPlanFindOne = UserPlan.findOne;

      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      Plan.findOne = async () => mockPlan;
      UserPlan.findOne = async () => null;
      Wallet.findOne = async () => ({ _id: walletId, user: userId, balance: 50 });

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans/${planId}/purchase`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });
        assert.strictEqual(response.status, 400);

        const body = await response.json();
        assert.strictEqual(body.success, false);
        assert.strictEqual(body.message, 'Insufficient wallet balance');
      } finally {
        User.findById = origUserFindById;
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        UserPlan.findOne = origUserPlanFindOne;
      }
    });

    it('POST /api/v1/plans/:id/purchase returns 200 idempotent response for duplicate idempotency key', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const planId = new mongoose.Types.ObjectId().toString();

      const mockUser = {
        _id: userId,
        name: 'Retry Buyer',
        email: 'retry@example.com',
        role: 'user',
      };
      const token = generateAccessToken({ id: userId, role: 'user' });

      const existingPlan = {
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        plan: planId,
        planName: 'Idempotent Plan',
        price: 100,
        idempotencyKey: 'idemp-duplicate-key',
        status: 'active',
      };

      const origUserFindById = User.findById;
      const origUserPlanFindOne = UserPlan.findOne;
      const origWalletFindOne = Wallet.findOne;

      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      UserPlan.findOne = async () => existingPlan;
      Wallet.findOne = async () => ({ user: userId, balance: 150 });

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans/${planId}/purchase`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'Idempotency-Key': 'idemp-duplicate-key',
          },
        });
        assert.strictEqual(response.status, 200);

        const body = await response.json();
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.message, 'Plan purchase already processed');
        assert.strictEqual(body.data.walletBalance, 150);
        assert.strictEqual(body.data.userPlan.planName, 'Idempotent Plan');
      } finally {
        User.findById = origUserFindById;
        UserPlan.findOne = origUserPlanFindOne;
        Wallet.findOne = origWalletFindOne;
      }
    });

    it('GET /api/v1/plans/my/active returns 200 with user active plans when authenticated', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const mockUser = {
        _id: userId,
        name: 'Active User',
        email: 'active@example.com',
        role: 'user',
      };
      const token = generateAccessToken({ id: userId, role: 'user' });

      const mockUserPlans = [
        {
          _id: new mongoose.Types.ObjectId(),
          user: userId,
          planName: 'Cloud Supernode',
          price: 250,
          status: 'active',
        },
      ];

      const origUserFindById = User.findById;
      const origUserPlanFind = UserPlan.find;

      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      UserPlan.find = () => ({
        sort: () => Promise.resolve(mockUserPlans),
      });

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans/my/active`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        assert.strictEqual(response.status, 200);

        const body = await response.json();
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.count, 1);
        assert.strictEqual(body.userPlans[0].planName, 'Cloud Supernode');
      } finally {
        User.findById = origUserFindById;
        UserPlan.find = origUserPlanFind;
      }
    });

    it('GET /api/v1/wallet returns 200 with wallet balance when authenticated', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const mockUser = {
        _id: userId,
        name: 'Wallet User',
        email: 'wallet@example.com',
        role: 'user',
      };
      const token = generateAccessToken({ id: userId, role: 'user' });

      const origUserFindById = User.findById;
      const origWalletFindOne = Wallet.findOne;

      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      Wallet.findOne = async () => ({
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        balance: 350.75,
        currency: 'USD',
      });

      try {
        const response = await fetch(`${baseUrl}/api/v1/wallet`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        assert.strictEqual(response.status, 200);

        const body = await response.json();
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.wallet.balance, 350.75);
      } finally {
        User.findById = origUserFindById;
        Wallet.findOne = origWalletFindOne;
      }
    });

    it('GET /api/v1/wallet/transactions returns 200 with user transaction history', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const mockUser = {
        _id: userId,
        name: 'Tx User',
        email: 'tx@example.com',
        role: 'user',
      };
      const token = generateAccessToken({ id: userId, role: 'user' });

      const mockTxs = [
        {
          _id: new mongoose.Types.ObjectId(),
          user: userId,
          type: 'debit',
          amount: 100,
          description: 'Plan Purchase: Pro Mining Rig',
          status: 'completed',
        },
      ];

      const origUserFindById = User.findById;
      const origTxFind = Transaction.find;
      const origTxCount = Transaction.countDocuments;

      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      Transaction.find = () => ({
        sort: () => ({
          skip: () => ({
            limit: () => Promise.resolve(mockTxs),
          }),
        }),
      });
      Transaction.countDocuments = async () => 1;

      try {
        const response = await fetch(`${baseUrl}/api/v1/wallet/transactions`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        assert.strictEqual(response.status, 200);

        const body = await response.json();
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.total, 1);
        assert.strictEqual(body.transactions[0].type, 'debit');
        assert.strictEqual(body.transactions[0].amount, 100);
      } finally {
        User.findById = origUserFindById;
        Transaction.find = origTxFind;
        Transaction.countDocuments = origTxCount;
      }
    });
  });
});


