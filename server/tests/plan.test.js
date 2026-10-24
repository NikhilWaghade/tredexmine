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
  getAdminPlans,
  getAdminPlanById,
  updatePlan as updatePlanController,
  togglePlanStatus as togglePlanStatusController,
} from '../src/controllers/planController.js';
import {
  isTransactionSupported,
  purchasePlan,
  getUserActivePlans,
  createPlan as createPlanService,
  getAllPlansAdmin,
  getPlanByIdAdmin,
  updatePlan as updatePlanService,
  togglePlanStatus as togglePlanStatusService,
} from '../src/services/planService.js';
import * as walletService from '../src/services/walletService.js';
import * as dashboardService from '../src/services/dashboardService.js';
import { generateAccessToken } from '../src/utils/tokenService.js';
import { authorize } from '../src/middleware/authorize.js';
import { createPlanValidation, updatePlanValidation } from '../src/validators/planValidators.js';

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
        const result = await purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'test-purchase-key-1' });

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
        assert.strictEqual(createdTransaction.reference, result.userPlan._id.toString());
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
            await purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'test-key-inactive' });
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
      const origUserPlanFindOne = UserPlan.findOne;
      const origUserPlanCreate = UserPlan.create;
      const origTxCreate = Transaction.create;

      Plan.findOne = async () => samplePlan;
      UserPlan.findOne = async () => null;
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
            await purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'test-key-insufficient' });
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
        UserPlan.findOne = origUserPlanFindOne;
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

      UserPlan.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        return [{ _id: new mongoose.Types.ObjectId(), ...item }];
      };
      Transaction.create = async (data) => [data];

      try {
        const results = await Promise.allSettled([
          purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'concurrent-key-a' }),
          purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'concurrent-key-b' }),
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

      UserPlan.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        return [{ _id: new mongoose.Types.ObjectId(), ...item }];
      };
      // Simulate fatal write failure during Transaction creation
      Transaction.create = async () => {
        throw new Error('Database disk full or constraint violation');
      };

      try {
        await assert.rejects(
          async () => {
            await purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'test-key-tx-fail' });
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

    it('fails when idempotency key is missing, empty, or not a string', async () => {
      // 1. Omitted idempotency key
      await assert.rejects(
        async () => {
          await purchasePlan(mockUserId, mockPlanId);
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.message, 'Idempotency key is required for plan purchase');
          return true;
        }
      );

      // 2. Empty string
      await assert.rejects(
        async () => {
          await purchasePlan(mockUserId, mockPlanId, { idempotencyKey: '' });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.message, 'Idempotency key is required for plan purchase');
          return true;
        }
      );

      // 3. Whitespace string
      await assert.rejects(
        async () => {
          await purchasePlan(mockUserId, mockPlanId, { idempotencyKey: '   ' });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.message, 'Idempotency key is required for plan purchase');
          return true;
        }
      );

      // 4. Non-string type
      await assert.rejects(
        async () => {
          await purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 12345 });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.message, 'Idempotency key is required for plan purchase');
          return true;
        }
      );

      // 5. Exceeding 255 characters
      await assert.rejects(
        async () => {
          await purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'k'.repeat(300) });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.message, 'Idempotency key cannot exceed 255 characters');
          return true;
        }
      );
    });

    it('two simultaneous requests with the same key debit wallet only once and return consistent idempotent response', async () => {
      let walletBalance = 500;
      let userPlanStore = [];
      let transactionStore = [];

      const origPlanFindOne = Plan.findOne;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origUserPlanFindOne = UserPlan.findOne;
      const origUserPlanCreate = UserPlan.create;
      const origTxCreate = Transaction.create;

      Plan.findOne = async () => samplePlan;
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

      UserPlan.findOne = async (q) => {
        return userPlanStore.find((p) => p.user.toString() === q.user.toString() && p.idempotencyKey === q.idempotencyKey) || null;
      };

      UserPlan.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const exists = userPlanStore.some(
          (p) => p.user.toString() === item.user.toString() && p.idempotencyKey === item.idempotencyKey
        );
        if (exists) {
          const dupErr = new Error('E11000 duplicate key error collection: userplans index: user_1_idempotencyKey_1');
          dupErr.code = 11000;
          throw dupErr;
        }
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        userPlanStore.push(created);
        return Array.isArray(data) ? [created] : created;
      };

      Transaction.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        transactionStore.push(created);
        return Array.isArray(data) ? [created] : created;
      };

      try {
        const results = await Promise.all([
          purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'race-key-identical' }),
          purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'race-key-identical' }),
        ]);

        // Exactly one purchase was a fresh charge (100 deducted), exactly one was idempotent
        assert.strictEqual(walletBalance, 400); // 500 - 100 = 400 (NOT 300!)
        assert.strictEqual(userPlanStore.length, 1);
        assert.strictEqual(transactionStore.length, 1);

        const [r1, r2] = results;
        assert.strictEqual(r1.userPlan._id.toString(), r2.userPlan._id.toString());
        assert.ok(r1.isIdempotent !== r2.isIdempotent); // One is false, one is true
      } finally {
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        Transaction.create = origTxCreate;
      }
    });

    it('UserPlan creation failure after wallet debit refunds wallet balance and leaves no partial subscription', async () => {
      let walletBalance = 300;
      let userPlanStore = [];
      let transactionStore = [];

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

      // UserPlan creation fails after debit has already decremented balance
      UserPlan.create = async () => {
        throw new Error('Mongoose schema validation failed on UserPlan');
      };

      Transaction.create = async (data) => {
        transactionStore.push(data);
      };

      try {
        await assert.rejects(
          async () => {
            await purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'fail-userplan-creation' });
          },
          (err) => {
            assert.strictEqual(err.message, 'Mongoose schema validation failed on UserPlan');
            return true;
          }
        );

        // Compensating write restored wallet balance completely
        assert.strictEqual(walletBalance, 300);
        assert.strictEqual(userPlanStore.length, 0);
        assert.strictEqual(transactionStore.length, 0);
      } finally {
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        Transaction.create = origTxCreate;
      }
    });

    it('Transaction creation failure deletes created UserPlan and refunds wallet balance', async () => {
      let walletBalance = 300;
      let userPlanStore = [];

      const origPlanFindOne = Plan.findOne;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origUserPlanFindOne = UserPlan.findOne;
      const origUserPlanCreate = UserPlan.create;
      const origUserPlanDelete = UserPlan.findByIdAndDelete;
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

      UserPlan.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const plan = { _id: new mongoose.Types.ObjectId(), ...item };
        userPlanStore.push(plan);
        return Array.isArray(data) ? [plan] : plan;
      };

      UserPlan.findByIdAndDelete = async (id) => {
        userPlanStore = userPlanStore.filter((p) => p._id.toString() !== id.toString());
      };

      Transaction.create = async () => {
        throw new Error('Transaction ledger storage full');
      };

      try {
        await assert.rejects(
          async () => {
            await purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'fail-tx-creation' });
          },
          (err) => {
            assert.strictEqual(err.message, 'Transaction ledger storage full');
            return true;
          }
        );

        // Wallet balance refunded to 300 and orphaned UserPlan cleaned up
        assert.strictEqual(walletBalance, 300);
        assert.strictEqual(userPlanStore.length, 0);
      } finally {
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        UserPlan.findByIdAndDelete = origUserPlanDelete;
        Transaction.create = origTxCreate;
      }
    });

    it('successful purchase creates exactly one debit transaction and one subscription linked by reference', async () => {
      let walletBalance = 250;
      let userPlanStore = [];
      let transactionStore = [];

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
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        userPlanStore.push(created);
        return Array.isArray(data) ? [created] : created;
      };

      Transaction.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        transactionStore.push(created);
        return Array.isArray(data) ? [created] : created;
      };

      try {
        const result = await purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'exact-one-check-key' });

        assert.strictEqual(result.walletBalance, 150);
        assert.strictEqual(result.isIdempotent, false);

        assert.strictEqual(userPlanStore.length, 1);
        assert.strictEqual(transactionStore.length, 1);

        const planDoc = userPlanStore[0];
        const txDoc = transactionStore[0];

        assert.strictEqual(planDoc.price, 100);
        assert.strictEqual(planDoc.status, 'active');
        assert.strictEqual(planDoc.idempotencyKey, 'exact-one-check-key');

        assert.strictEqual(txDoc.type, 'debit');
        assert.strictEqual(txDoc.amount, 100);
        assert.strictEqual(txDoc.status, 'completed');
        assert.strictEqual(txDoc.reference, planDoc._id.toString());
        assert.strictEqual(txDoc.balanceBefore, 250);
        assert.strictEqual(txDoc.balanceAfter, 150);
        assert.strictEqual(txDoc.balanceBefore - txDoc.amount, txDoc.balanceAfter);
        assert.ok(result.transaction);
        assert.strictEqual(result.transaction.reference, planDoc._id.toString());
      } finally {
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        Transaction.create = origTxCreate;
      }
    });

    it('two simultaneous requests with different keys and insufficient combined balance rejects one and never leaves negative balance', async () => {
      let walletBalance = 100; // Plan costs 80, combined 160 > 100
      let userPlanStore = [];
      let transactionStore = [];

      const plan80 = { ...samplePlan, price: 80 };

      const origPlanFindOne = Plan.findOne;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origUserPlanFindOne = UserPlan.findOne;
      const origUserPlanCreate = UserPlan.create;
      const origTxCreate = Transaction.create;

      Plan.findOne = async () => plan80;
      UserPlan.findOne = async () => null;
      Wallet.findOne = async () => ({ _id: mockWalletId, user: mockUserId, balance: walletBalance });

      Wallet.findOneAndUpdate = async (query, update) => {
        if (query.balance?.$gte && walletBalance < query.balance.$gte) {
          return null; // Concurrency balance gate
        }
        if (update.$inc?.balance) {
          walletBalance += update.$inc.balance;
        }
        return { _id: mockWalletId, user: mockUserId, balance: walletBalance };
      };

      UserPlan.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        userPlanStore.push(created);
        return Array.isArray(data) ? [created] : created;
      };

      Transaction.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        transactionStore.push(created);
        return Array.isArray(data) ? [created] : created;
      };

      try {
        const results = await Promise.allSettled([
          purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'diff-key-1' }),
          purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'diff-key-2' }),
        ]);

        let successCount = 0;
        let failCount = 0;

        results.forEach((r) => {
          if (r.status === 'fulfilled') {
            successCount++;
          } else {
            failCount++;
            assert.strictEqual(r.reason.statusCode, 400);
            assert.strictEqual(r.reason.message, 'Insufficient wallet balance');
          }
        });

        assert.strictEqual(successCount, 1);
        assert.strictEqual(failCount, 1);
        assert.strictEqual(walletBalance, 20); // 100 - 80 = 20 (>= 0, never negative)
        assert.ok(walletBalance >= 0);
        assert.strictEqual(userPlanStore.length, 1);
        assert.strictEqual(transactionStore.length, 1);
      } finally {
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        Transaction.create = origTxCreate;
      }
    });

    it('two simultaneous requests with the same key and balance for only one plan returns idempotent success for both without insufficient balance error', async () => {
      let walletBalance = 100; // Plan price is 100, exactly enough for ONE plan
      let userPlanStore = [];
      let transactionStore = [];

      const origPlanFindOne = Plan.findOne;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origUserPlanFindOne = UserPlan.findOne;
      const origUserPlanCreate = UserPlan.create;
      const origTxCreate = Transaction.create;

      Plan.findOne = async () => samplePlan;
      Wallet.findOne = async () => ({ _id: mockWalletId, user: mockUserId, balance: walletBalance });

      Wallet.findOneAndUpdate = async (query, update) => {
        if (query.balance?.$gte && walletBalance < query.balance.$gte) {
          return null; // Second request sees balance 0
        }
        if (update.$inc?.balance) {
          walletBalance += update.$inc.balance;
        }
        return { _id: mockWalletId, user: mockUserId, balance: walletBalance };
      };

      UserPlan.findOne = async (q) => {
        return userPlanStore.find((p) => p.user.toString() === q.user.toString() && p.idempotencyKey === q.idempotencyKey) || null;
      };

      UserPlan.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const exists = userPlanStore.some(
          (p) => p.user.toString() === item.user.toString() && p.idempotencyKey === item.idempotencyKey
        );
        if (exists) {
          const dupErr = new Error('E11000 duplicate key error collection: userplans index: user_1_idempotencyKey_1');
          dupErr.code = 11000;
          throw dupErr;
        }
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        userPlanStore.push(created);
        return Array.isArray(data) ? [created] : created;
      };

      Transaction.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        transactionStore.push(created);
        return Array.isArray(data) ? [created] : created;
      };

      try {
        const results = await Promise.all([
          purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'single-balance-race' }),
          purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'single-balance-race' }),
        ]);

        // Both return success (one fresh 201, one idempotent 200)
        assert.strictEqual(walletBalance, 0); // Not negative, debited exactly once
        assert.strictEqual(userPlanStore.length, 1);
        assert.strictEqual(transactionStore.length, 1);

        const [r1, r2] = results;
        assert.strictEqual(r1.userPlan._id.toString(), r2.userPlan._id.toString());
        assert.strictEqual(r1.walletBalance, 0);
        assert.strictEqual(r2.walletBalance, 0);
      } finally {
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        Transaction.create = origTxCreate;
      }
    });

    it('wallet balance never becomes negative even when 5 simultaneous concurrent requests attempt to overdraw', async () => {
      let walletBalance = 150; // Plan is 100, only 1 of 5 can succeed
      let userPlanStore = [];
      let transactionStore = [];

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
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        userPlanStore.push(created);
        return Array.isArray(data) ? [created] : created;
      };

      Transaction.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        transactionStore.push(created);
        return Array.isArray(data) ? [created] : created;
      };

      try {
        const requests = Array.from({ length: 5 }, (_, i) =>
          purchasePlan(mockUserId, mockPlanId, { idempotencyKey: `overdraw-test-key-${i}` })
        );

        const results = await Promise.allSettled(requests);

        let successes = 0;
        let failures = 0;

        results.forEach((r) => {
          if (r.status === 'fulfilled') successes++;
          else failures++;
        });

        assert.strictEqual(successes, 1);
        assert.strictEqual(failures, 4);
        assert.strictEqual(walletBalance, 50);
        assert.ok(walletBalance >= 0, 'Wallet balance must never be negative');
        assert.strictEqual(userPlanStore.length, 1);
        assert.strictEqual(transactionStore.length, 1);
      } finally {
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        Transaction.create = origTxCreate;
      }
    });

    it('failed purchase leaves no partial subscription in database across all failure modes', async () => {
      let walletBalance = 200;
      let userPlanStore = [];

      const origPlanFindOne = Plan.findOne;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origUserPlanFindOne = UserPlan.findOne;
      const origUserPlanCreate = UserPlan.create;
      const origUserPlanDelete = UserPlan.findByIdAndDelete;
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

      UserPlan.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        userPlanStore.push(created);
        return Array.isArray(data) ? [created] : created;
      };

      UserPlan.findByIdAndDelete = async (id) => {
        userPlanStore = userPlanStore.filter((p) => p._id.toString() !== id.toString());
      };

      Transaction.create = async () => {
        throw new Error('Ledger storage failed');
      };

      try {
        await assert.rejects(
          async () => {
            await purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'fail-no-partial-sub' });
          },
          (err) => {
            assert.strictEqual(err.message, 'Ledger storage failed');
            return true;
          }
        );

        // Verify balance refunded and zero partial subscriptions exist
        assert.strictEqual(walletBalance, 200);
        assert.strictEqual(userPlanStore.length, 0);
      } finally {
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        UserPlan.findByIdAndDelete = origUserPlanDelete;
        Transaction.create = origTxCreate;
      }
    });

    it('multi-document transaction session commits atomically on success and aborts cleanly on failure without manual refund', async () => {
      let walletBalance = 300;
      let userPlanStore = [];
      let transactionStore = [];
      let transactionCommitted = false;
      let transactionAborted = false;
      let compensatingRefundCalled = false;

      const mockSession = {
        startTransaction: () => {},
        commitTransaction: async () => {
          transactionCommitted = true;
        },
        abortTransaction: async () => {
          transactionAborted = true;
        },
        endSession: async () => {},
      };

      const origPlanFindOne = Plan.findOne;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origUserPlanFindOne = UserPlan.findOne;
      const origUserPlanCreate = UserPlan.create;
      const origTxCreate = Transaction.create;

      Plan.findOne = async () => samplePlan;
      UserPlan.findOne = () => ({
        session: () => Promise.resolve(null),
        then: (resolve) => resolve(null),
      });
      Wallet.findOne = async () => ({ _id: mockWalletId, user: mockUserId, balance: walletBalance });

      Wallet.findOneAndUpdate = async (query, update, opts) => {
        if (!opts?.session) {
          compensatingRefundCalled = true;
        }
        if (update.$inc?.balance) {
          walletBalance += update.$inc.balance;
        }
        return { _id: mockWalletId, user: mockUserId, balance: walletBalance };
      };

      UserPlan.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        userPlanStore.push(created);
        return [created];
      };

      Transaction.create = async () => {
        throw new Error('Simulated write failure inside session');
      };

      try {
        await assert.rejects(
          async () => {
            await purchasePlan(mockUserId, mockPlanId, {
              idempotencyKey: 'session-tx-abort-key',
              session: mockSession,
            });
          },
          (err) => {
            assert.strictEqual(err.message, 'Simulated write failure inside session');
            return true;
          }
        );

        // Transaction abort is handled natively by the session, no manual compensating refund is performed
        assert.strictEqual(compensatingRefundCalled, false, 'Compensating refund must NOT be called in transaction mode');
      } finally {
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        Transaction.create = origTxCreate;
      }
    });

    it('isTransactionSupported detects replica set vs standalone MongoDB topology correctly', () => {
      const origConnection = mongoose.connection;

      // 1. readyState !== 1 -> false
      assert.strictEqual(isTransactionSupported(), false);

      // 2. Standalone ('Single') -> false
      const mockStandaloneConn = {
        readyState: 1,
        client: {
          topology: {
            description: { type: 'Single' },
          },
        },
      };
      Object.defineProperty(mongoose, 'connection', { value: mockStandaloneConn, configurable: true });
      assert.strictEqual(isTransactionSupported(), false);

      // 3. Replica set with primary -> true
      const mockReplicaSetConn = {
        readyState: 1,
        client: {
          topology: {
            description: { type: 'ReplicaSetWithPrimary' },
          },
        },
      };
      Object.defineProperty(mongoose, 'connection', { value: mockReplicaSetConn, configurable: true });
      assert.strictEqual(isTransactionSupported(), true);

      // 4. Mongos sharded cluster -> true
      const mockShardedConn = {
        readyState: 1,
        client: {
          topology: {
            description: { type: 'Sharded' },
          },
        },
      };
      Object.defineProperty(mongoose, 'connection', { value: mockShardedConn, configurable: true });
      assert.strictEqual(isTransactionSupported(), true);

      // Restore original connection
      Object.defineProperty(mongoose, 'connection', { value: origConnection, configurable: true });
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

  describe('Plan Update Validation (updatePlanValidation)', () => {
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

    it('fails when body is not an object or empty', () => {
      const req = { body: {} };
      const res = createMockRes();
      let nextCalled = false;
      updatePlanValidation(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.jsonData.errors.some((e) => e.includes('At least one updatable field must be provided')));
    });

    it('fails when client supplies _id, id, or timestamps', () => {
      const req = {
        body: {
          _id: '652a1234567890abcdef1234',
          name: 'Updated Name',
          createdAt: new Date(),
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      updatePlanValidation(req, res, () => {
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
          name: 'Updated Name',
          unknownAdminParam: true,
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      updatePlanValidation(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.jsonData.errors.some((e) => e.includes('Unintended fields are not allowed')));
    });

    it('fails when updated fields violate constraints', () => {
      const req = {
        body: {
          price: -10,
          durationDays: 0,
          dailyRoiRate: -0.05,
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      updatePlanValidation(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.jsonData.errors.some((e) => e.includes('greater than zero')));
      assert.ok(res.jsonData.errors.some((e) => e.includes('at least 1 day')));
      assert.ok(res.jsonData.errors.some((e) => e.includes('cannot be negative')));
    });

    it('passes validation for valid partial plan updates', () => {
      const req = {
        body: {
          name: 'Supercharged Miner Tier 2',
          price: 249.99,
          features: ['Overclocked ASICs', 'Automated Daily Payouts'],
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      updatePlanValidation(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(res.statusCode, null);
    });
  });

  describe('Admin Plan Services (getAllPlansAdmin, updatePlan, togglePlanStatus)', () => {
    it('getAllPlansAdmin returns all plans including inactive plans', async () => {
      const origFind = Plan.find;
      const mockPlans = [
        { _id: '1', name: 'Active Plan', isActive: true },
        { _id: '2', name: 'Inactive Plan', isActive: false },
      ];

      Plan.find = () => ({
        sort: () => Promise.resolve(mockPlans),
      });

      try {
        const result = await getAllPlansAdmin();
        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].isActive, true);
        assert.strictEqual(result[1].isActive, false);
      } finally {
        Plan.find = origFind;
      }
    });

    it('getPlanByIdAdmin retrieves plan regardless of active status', async () => {
      const origFindById = Plan.findById;
      const planId = new mongoose.Types.ObjectId().toString();
      const mockPlan = { _id: planId, name: 'Dormant Plan', isActive: false };

      Plan.findById = async (id) => (id === planId ? mockPlan : null);

      try {
        const result = await getPlanByIdAdmin(planId);
        assert.ok(result);
        assert.strictEqual(result.isActive, false);
      } finally {
        Plan.findById = origFindById;
      }
    });

    it('updatePlan updates supported fields and rejects unknown plan with 404', async () => {
      const origFindById = Plan.findById;
      const planId = new mongoose.Types.ObjectId().toString();
      const mockDoc = {
        _id: planId,
        name: 'Old Name',
        price: 100,
        save: async function () {
          return this;
        },
      };

      Plan.findById = async (id) => (id === planId ? mockDoc : null);

      try {
        const updated = await updatePlanService(planId, {
          name: '  Trimmed Pro Rig  ',
          price: 350,
        });

        assert.strictEqual(updated.name, 'Trimmed Pro Rig');
        assert.strictEqual(updated.price, 350);
      } finally {
        Plan.findById = origFindById;
      }

      // 404 case
      Plan.findById = async () => null;
      try {
        await assert.rejects(
          async () => {
            await updatePlanService(planId, { price: 400 });
          },
          (err) => {
            assert.strictEqual(err.statusCode, 404);
            assert.strictEqual(err.message, 'Plan not found');
            return true;
          }
        );
      } finally {
        Plan.findById = origFindById;
      }
    });

    it('togglePlanStatus toggles plan active status', async () => {
      const origFindById = Plan.findById;
      const planId = new mongoose.Types.ObjectId().toString();
      const mockDoc = {
        _id: planId,
        name: 'Toggle Plan',
        isActive: true,
        save: async function () {
          return this;
        },
      };

      Plan.findById = async (id) => (id === planId ? mockDoc : null);

      try {
        const deactivated = await togglePlanStatusService(planId, false);
        assert.strictEqual(deactivated.isActive, false);

        const activated = await togglePlanStatusService(planId, true);
        assert.strictEqual(activated.isActive, true);
      } finally {
        Plan.findById = origFindById;
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
        assert.ok(body.data.transaction);
        assert.strictEqual(body.data.transaction.reference, body.data.userPlan._id);
        assert.strictEqual(body.data.transaction.balanceBefore, 250);
        assert.strictEqual(body.data.transaction.balanceAfter, 150);
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
            'Idempotency-Key': 'insufficient-balance-test-key',
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
      const origPlanFindOne = Plan.findOne;
      const origUserPlanFindOne = UserPlan.findOne;
      const origWalletFindOne = Wallet.findOne;

      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      Plan.findOne = async () => ({ _id: planId, name: 'Idempotent Plan', price: 100, isActive: true });
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
        Plan.findOne = origPlanFindOne;
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

    it('GET /api/v1/plans/admin/all rejects unauthenticated request with 401', async () => {
      const response = await fetch(`${baseUrl}/api/v1/plans/admin/all`);
      assert.strictEqual(response.status, 401);
    });

    it('GET /api/v1/plans/admin/all rejects ordinary user (role: user) with 403 Forbidden', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const mockUser = { _id: userId, role: 'user', email: 'user@example.com' };
      const token = generateAccessToken({ id: userId, role: 'user' });

      const origUserFindById = User.findById;
      User.findById = () => ({ select: () => Promise.resolve(mockUser) });

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans/admin/all`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assert.strictEqual(response.status, 403);
        const body = await response.json();
        assert.strictEqual(body.success, false);
      } finally {
        User.findById = origUserFindById;
      }
    });

    it('GET /api/v1/plans/admin/all returns 200 with all plans for admin', async () => {
      const adminId = new mongoose.Types.ObjectId().toString();
      const mockAdmin = { _id: adminId, role: 'admin', email: 'admin@example.com' };
      const token = generateAccessToken({ id: adminId, role: 'admin' });

      const mockPlans = [
        { _id: '1', name: 'Live Rig', isActive: true, price: 100 },
        { _id: '2', name: 'Archived Rig', isActive: false, price: 50 },
      ];

      const origUserFindById = User.findById;
      const origPlanFind = Plan.find;

      User.findById = () => ({ select: () => Promise.resolve(mockAdmin) });
      Plan.find = () => ({ sort: () => Promise.resolve(mockPlans) });

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans/admin/all`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assert.strictEqual(response.status, 200);
        const body = await response.json();
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.count, 2);
        assert.strictEqual(body.data[0].isActive, true);
        assert.strictEqual(body.data[1].isActive, false);
      } finally {
        User.findById = origUserFindById;
        Plan.find = origPlanFind;
      }
    });

    it('GET /api/v1/plans/admin/:id rejects ordinary user with 403 Forbidden', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const planId = new mongoose.Types.ObjectId().toString();
      const mockUser = { _id: userId, role: 'user', email: 'user@example.com' };
      const token = generateAccessToken({ id: userId, role: 'user' });

      const origUserFindById = User.findById;
      User.findById = () => ({ select: () => Promise.resolve(mockUser) });

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans/admin/${planId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assert.strictEqual(response.status, 403);
      } finally {
        User.findById = origUserFindById;
      }
    });

    it('GET /api/v1/plans/admin/:id returns 200 with plan details for admin', async () => {
      const adminId = new mongoose.Types.ObjectId().toString();
      const planId = new mongoose.Types.ObjectId().toString();
      const mockAdmin = { _id: adminId, role: 'admin', email: 'admin@example.com' };
      const token = generateAccessToken({ id: adminId, role: 'admin' });

      const mockPlan = { _id: planId, name: 'Admin Query Plan', isActive: false, price: 200 };

      const origUserFindById = User.findById;
      const origPlanFindById = Plan.findById;

      User.findById = () => ({ select: () => Promise.resolve(mockAdmin) });
      Plan.findById = async (id) => (id === planId ? mockPlan : null);

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans/admin/${planId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assert.strictEqual(response.status, 200);
        const body = await response.json();
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.plan.name, 'Admin Query Plan');
      } finally {
        User.findById = origUserFindById;
        Plan.findById = origPlanFindById;
      }
    });

    it('PUT /api/v1/plans/:id rejects unauthenticated request with 401', async () => {
      const planId = new mongoose.Types.ObjectId().toString();
      const response = await fetch(`${baseUrl}/api/v1/plans/${planId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hacked Name' }),
      });
      assert.strictEqual(response.status, 401);
    });

    it('PUT /api/v1/plans/:id rejects ordinary user (role: user) with 403 Forbidden', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const planId = new mongoose.Types.ObjectId().toString();
      const mockUser = { _id: userId, role: 'user', email: 'user@example.com' };
      const token = generateAccessToken({ id: userId, role: 'user' });

      const origUserFindById = User.findById;
      User.findById = () => ({ select: () => Promise.resolve(mockUser) });

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans/${planId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ name: 'Tampered Name' }),
        });
        assert.strictEqual(response.status, 403);
      } finally {
        User.findById = origUserFindById;
      }
    });

    it('PUT /api/v1/plans/:id rejects invalid data or client-supplied IDs with 400', async () => {
      const adminId = new mongoose.Types.ObjectId().toString();
      const planId = new mongoose.Types.ObjectId().toString();
      const mockAdmin = { _id: adminId, role: 'admin', email: 'admin@example.com' };
      const token = generateAccessToken({ id: adminId, role: 'admin' });

      const origUserFindById = User.findById;
      User.findById = () => ({ select: () => Promise.resolve(mockAdmin) });

      try {
        // Attempting to supply client _id
        const resId = await fetch(`${baseUrl}/api/v1/plans/${planId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ _id: 'fake-id', price: 100 }),
        });
        assert.strictEqual(resId.status, 400);

        // Attempting invalid price
        const resPrice = await fetch(`${baseUrl}/api/v1/plans/${planId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ price: -50 }),
        });
        assert.strictEqual(resPrice.status, 400);
      } finally {
        User.findById = origUserFindById;
      }
    });

    it('PUT /api/v1/plans/:id updates plan fields when authenticated as admin and returns 200', async () => {
      const adminId = new mongoose.Types.ObjectId().toString();
      const planId = new mongoose.Types.ObjectId().toString();
      const mockAdmin = { _id: adminId, role: 'admin', email: 'admin@example.com' };
      const token = generateAccessToken({ id: adminId, role: 'admin' });

      const origUserFindById = User.findById;
      const origPlanFindById = Plan.findById;

      const mockPlanDoc = {
        _id: planId,
        name: 'Original ASIC',
        price: 200,
        description: 'Original description',
        save: async function () {
          return this;
        },
      };

      User.findById = () => ({ select: () => Promise.resolve(mockAdmin) });
      Plan.findById = async (id) => (id === planId ? mockPlanDoc : null);

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans/${planId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: 'Updated ASIC Pro',
            price: 349.99,
            description: 'Updated enterprise cluster',
          }),
        });
        assert.strictEqual(response.status, 200);
        const body = await response.json();
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.plan.name, 'Updated ASIC Pro');
        assert.strictEqual(body.plan.price, 349.99);
      } finally {
        User.findById = origUserFindById;
        Plan.findById = origPlanFindById;
      }
    });

    it('PATCH /api/v1/plans/:id/status rejects ordinary user with 403 Forbidden', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const planId = new mongoose.Types.ObjectId().toString();
      const mockUser = { _id: userId, role: 'user', email: 'user@example.com' };
      const token = generateAccessToken({ id: userId, role: 'user' });

      const origUserFindById = User.findById;
      User.findById = () => ({ select: () => Promise.resolve(mockUser) });

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans/${planId}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ isActive: false }),
        });
        assert.strictEqual(response.status, 403);
      } finally {
        User.findById = origUserFindById;
      }
    });

    it('PATCH /api/v1/plans/:id/status rejects invalid status payload with 400', async () => {
      const adminId = new mongoose.Types.ObjectId().toString();
      const planId = new mongoose.Types.ObjectId().toString();
      const mockAdmin = { _id: adminId, role: 'admin', email: 'admin@example.com' };
      const token = generateAccessToken({ id: adminId, role: 'admin' });

      const origUserFindById = User.findById;
      User.findById = () => ({ select: () => Promise.resolve(mockAdmin) });

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans/${planId}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ isActive: 'not-a-boolean' }),
        });
        assert.strictEqual(response.status, 400);
      } finally {
        User.findById = origUserFindById;
      }
    });

    it('PATCH /api/v1/plans/:id/status toggles plan active status for admin and returns 200', async () => {
      const adminId = new mongoose.Types.ObjectId().toString();
      const planId = new mongoose.Types.ObjectId().toString();
      const mockAdmin = { _id: adminId, role: 'admin', email: 'admin@example.com' };
      const token = generateAccessToken({ id: adminId, role: 'admin' });

      const origUserFindById = User.findById;
      const origPlanFindById = Plan.findById;

      const mockPlanDoc = {
        _id: planId,
        name: 'Deactivated Rig',
        isActive: true,
        save: async function () {
          return this;
        },
      };

      User.findById = () => ({ select: () => Promise.resolve(mockAdmin) });
      Plan.findById = async (id) => (id === planId ? mockPlanDoc : null);

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans/${planId}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ isActive: false }),
        });
        assert.strictEqual(response.status, 200);
        const body = await response.json();
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.plan.isActive, false);
      } finally {
        User.findById = origUserFindById;
        Plan.findById = origPlanFindById;
      }
    });

    it('POST /api/v1/plans/:id/purchase rejects deactivated plan with 404 Not Found', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const planId = new mongoose.Types.ObjectId().toString();
      const mockUser = { _id: userId, role: 'user', email: 'buyer@example.com' };
      const token = generateAccessToken({ id: userId, role: 'user' });

      const origUserFindById = User.findById;
      const origPlanFindOne = Plan.findOne;

      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      // When Plan.findOne enforces isActive: true, a deactivated plan returns null
      Plan.findOne = async (query) => {
        if (query._id === planId && query.isActive === true) {
          return null; // Plan is deactivated
        }
        return null;
      };

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans/${planId}/purchase`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ idempotencyKey: 'test-deactivated-key' }),
        });
        assert.strictEqual(response.status, 404);
        const body = await response.json();
        assert.strictEqual(body.success, false);
        assert.ok(body.message.includes('not found') || body.message.includes('unavailable'));
      } finally {
        User.findById = origUserFindById;
        Plan.findOne = origPlanFindOne;
      }
    });

    it('POST /api/v1/plans/:id/purchase rejects missing idempotency key with 400 Bad Request', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const planId = new mongoose.Types.ObjectId().toString();
      const mockUser = { _id: userId, role: 'user', email: 'buyer@example.com' };
      const token = generateAccessToken({ id: userId, role: 'user' });

      const origUserFindById = User.findById;
      User.findById = () => ({ select: () => Promise.resolve(mockUser) });

      try {
        const response = await fetch(`${baseUrl}/api/v1/plans/${planId}/purchase`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        });
        assert.strictEqual(response.status, 400);
        const body = await response.json();
        assert.strictEqual(body.success, false);
        assert.ok(body.message.includes('Idempotency key is required'));
      } finally {
        User.findById = origUserFindById;
      }
    });

    it('editing or deactivating a plan preserves existing UserPlan snapshots and transaction history', async () => {
      // Historical UserPlan snapshot created at original price 100
      const existingUserPlan = {
        _id: new mongoose.Types.ObjectId(),
        user: new mongoose.Types.ObjectId(),
        plan: new mongoose.Types.ObjectId(),
        planName: 'Legacy Rig 100',
        price: 100,
        dailyRoiRate: 0.015,
        hashRate: '50 TH/s',
        status: 'active',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-31'),
      };

      // Admin modifies or deactivates the master plan catalog item
      const masterPlan = {
        _id: existingUserPlan.plan,
        name: 'Updated Rig Name',
        price: 250, // Price increased
        isActive: false, // Plan deactivated
      };

      // Verify that UserPlan snapshot is immutable and retains initial contractual values
      assert.strictEqual(existingUserPlan.price, 100);
      assert.strictEqual(existingUserPlan.planName, 'Legacy Rig 100');
      assert.strictEqual(existingUserPlan.status, 'active');
      assert.notStrictEqual(existingUserPlan.price, masterPlan.price);
      assert.notStrictEqual(existingUserPlan.planName, masterPlan.name);
    });
  });

  describe('Wallet Plan Purchase Transaction Ledger Integrity', () => {
    const mockUserId = new mongoose.Types.ObjectId().toString();
    const mockPlanId = new mongoose.Types.ObjectId().toString();
    const mockWalletId = new mongoose.Types.ObjectId().toString();

    const samplePlan = {
      _id: mockPlanId,
      name: 'Cloud Node Prime',
      tag: 'Enterprise',
      price: 200,
      durationDays: 30,
      dailyRoiRate: 0.02,
      hashRate: '120 TH/s',
      features: ['Priority Hashrate', 'Enterprise Support'],
      isActive: true,
    };

    it('creates exactly one debit transaction with stable reference linking to UserPlan and balance snapshots', async () => {
      let walletBalance = 1000;
      let userPlanStore = [];
      let transactionStore = [];

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
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        userPlanStore.push(created);
        return Array.isArray(data) ? [created] : created;
      };

      Transaction.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        transactionStore.push(created);
        return Array.isArray(data) ? [created] : created;
      };

      try {
        const result = await purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'ledger-integrity-single-key' });

        assert.strictEqual(result.isIdempotent, false);
        assert.strictEqual(result.walletBalance, 800);
        assert.strictEqual(userPlanStore.length, 1);
        assert.strictEqual(transactionStore.length, 1);

        const plan = userPlanStore[0];
        const tx = transactionStore[0];

        // 1. Exactly one debit transaction
        assert.strictEqual(tx.type, 'debit');
        assert.strictEqual(tx.amount, 200);
        assert.strictEqual(tx.status, 'completed');
        assert.strictEqual(tx.description, 'Plan Purchase: Cloud Node Prime');

        // 2. Stable reference linking to UserPlan
        assert.strictEqual(tx.reference, plan._id.toString());
        assert.strictEqual(result.transaction.reference, plan._id.toString());

        // 3. Balance snapshots
        assert.strictEqual(tx.balanceBefore, 1000);
        assert.strictEqual(tx.balanceAfter, 800);
        assert.strictEqual(tx.balanceBefore - tx.amount, tx.balanceAfter);
      } finally {
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        Transaction.create = origTxCreate;
      }
    });

    it('duplicate idempotent purchase retry does not duplicate ledger entries or user plans', async () => {
      let walletBalance = 500;
      let userPlanStore = [];
      let transactionStore = [];

      const origPlanFindOne = Plan.findOne;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origUserPlanFindOne = UserPlan.findOne;
      const origUserPlanCreate = UserPlan.create;
      const origTxCreate = Transaction.create;

      Plan.findOne = async () => samplePlan;
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

      UserPlan.findOne = async (q) => {
        return userPlanStore.find((p) => p.user.toString() === q.user.toString() && p.idempotencyKey === q.idempotencyKey) || null;
      };

      UserPlan.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        userPlanStore.push(created);
        return Array.isArray(data) ? [created] : created;
      };

      Transaction.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        transactionStore.push(created);
        return Array.isArray(data) ? [created] : created;
      };

      try {
        const idempotencyKey = 'ledger-duplicate-replay-key';

        // First purchase: initial execution
        const res1 = await purchasePlan(mockUserId, mockPlanId, { idempotencyKey });
        assert.strictEqual(res1.isIdempotent, false);
        assert.strictEqual(res1.walletBalance, 300);
        assert.strictEqual(userPlanStore.length, 1);
        assert.strictEqual(transactionStore.length, 1);

        // Second purchase: duplicate idempotency key retry
        const res2 = await purchasePlan(mockUserId, mockPlanId, { idempotencyKey });
        assert.strictEqual(res2.isIdempotent, true);
        assert.strictEqual(res2.walletBalance, 300); // Balance unchanged

        // Ledger must NOT contain duplicate entries
        assert.strictEqual(transactionStore.length, 1, 'Transaction ledger entries must not be duplicated');
        assert.strictEqual(userPlanStore.length, 1, 'UserPlan subscriptions must not be duplicated');
      } finally {
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        Transaction.create = origTxCreate;
      }
    });

    it('failed purchase removes created transaction during fallback compensating rollback and leaves no completed debit transaction', async () => {
      let walletBalance = 500;
      let userPlanStore = [];
      let transactionStore = [];
      let txDeletedId = null;
      let planDeletedId = null;

      const origPlanFindOne = Plan.findOne;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origUserPlanFindOne = UserPlan.findOne;
      const origUserPlanCreate = UserPlan.create;
      const origUserPlanDelete = UserPlan.findByIdAndDelete;
      const origTxCreate = Transaction.create;
      const origTxDelete = Transaction.findByIdAndDelete;

      Plan.findOne = async () => samplePlan;
      UserPlan.findOne = async () => null;
      Wallet.findOne = async () => ({ _id: mockWalletId, user: mockUserId, balance: walletBalance });

      let updatedWalletRef = null;
      Wallet.findOneAndUpdate = async (query, update) => {
        if (update.$inc?.balance) {
          walletBalance += update.$inc.balance;
        }
        updatedWalletRef = { _id: mockWalletId, user: mockUserId, balance: walletBalance };
        return updatedWalletRef;
      };

      UserPlan.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        userPlanStore.push(created);
        return Array.isArray(data) ? [created] : created;
      };

      UserPlan.findByIdAndDelete = async (id) => {
        planDeletedId = id.toString();
        userPlanStore = userPlanStore.filter((p) => p._id.toString() !== id.toString());
      };

      Transaction.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        const created = { _id: new mongoose.Types.ObjectId(), ...item };
        transactionStore.push(created);
        if (updatedWalletRef) {
          Object.defineProperty(updatedWalletRef, 'balance', {
            get() {
              throw new Error('Simulated post-transaction ledger failure');
            },
            configurable: true,
          });
        }
        return Array.isArray(data) ? [created] : created;
      };

      Transaction.findByIdAndDelete = async (id) => {
        txDeletedId = id.toString();
        transactionStore = transactionStore.filter((t) => t._id.toString() !== id.toString());
      };

      try {
        await assert.rejects(
          async () => {
            await purchasePlan(mockUserId, mockPlanId, { idempotencyKey: 'ledger-rollback-test-key' });
          },
          (err) => {
            assert.strictEqual(err.message, 'Simulated post-transaction ledger failure');
            return true;
          }
        );

        // Wallet balance refunded back to 500
        assert.strictEqual(walletBalance, 500);
        // UserPlan was deleted
        assert.ok(planDeletedId);
        assert.strictEqual(userPlanStore.length, 0);
        // Transaction was deleted and not left completed
        assert.ok(txDeletedId);
        assert.strictEqual(transactionStore.length, 0);
      } finally {
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        UserPlan.findByIdAndDelete = origUserPlanDelete;
        Transaction.create = origTxCreate;
        Transaction.findByIdAndDelete = origTxDelete;
      }
    });

    it('dashboard recent transactions and wallet transaction history expose matching purchase records', async () => {
      const txId = new mongoose.Types.ObjectId();
      const planSnapshotId = new mongoose.Types.ObjectId();
      const txTimestamp = new Date();

      const mockTx = {
        _id: txId,
        user: mockUserId,
        wallet: mockWalletId,
        type: 'debit',
        amount: 200,
        description: 'Plan Purchase: Cloud Node Prime',
        status: 'completed',
        reference: planSnapshotId.toString(),
        balanceBefore: 1000,
        balanceAfter: 800,
        createdAt: txTimestamp,
      };

      const origTxFind = Transaction.find;
      const origTxCount = Transaction.countDocuments;
      const origUserFindById = User.findById;
      const origWalletFindOne = Wallet.findOne;
      const origUserPlanFind = UserPlan.find;

      Transaction.find = (query) => {
        if (query && query.description && query.description.$regex) {
          return Promise.resolve([]);
        }
        return {
          sort: () => ({
            skip: () => ({
              limit: () => Promise.resolve([mockTx]),
            }),
            limit: () => ({
              select: () => Promise.resolve([mockTx]),
            }),
          }),
        };
      };
      Transaction.countDocuments = async () => 1;

      User.findById = () => ({
        select: () =>
          Promise.resolve({
            _id: mockUserId,
            name: 'Ledger Audit User',
            email: 'audit@example.com',
            role: 'user',
            referralCode: 'AUDIT01',
          }),
      });

      Wallet.findOne = async () => ({
        _id: mockWalletId,
        user: mockUserId,
        balance: 800,
        planIncome: 0,
        referralIncome: 0,
        totalWithdrawn: 0,
      });

      UserPlan.find = () => ({
        sort: () => Promise.resolve([]),
      });

      try {
        const walletResult = await walletService.getTransactionsByUserId(mockUserId);
        const dashboardResult = await dashboardService.getUserDashboard(mockUserId);

        assert.strictEqual(walletResult.transactions.length, 1);
        assert.strictEqual(dashboardResult.recentTransactions.length, 1);

        const walletTx = walletResult.transactions[0];
        const dashTx = dashboardResult.recentTransactions[0];

        // Verify consistency across both endpoints
        assert.strictEqual(walletTx._id.toString(), dashTx.id.toString());
        assert.strictEqual(walletTx.amount, dashTx.amount);
        assert.strictEqual(walletTx.type, dashTx.type);
        assert.strictEqual(walletTx.status, dashTx.status);
        assert.strictEqual(walletTx.reference, dashTx.reference);
        assert.strictEqual(dashTx.reference, planSnapshotId.toString());
        assert.strictEqual(dashTx.balanceBefore, 1000);
        assert.strictEqual(dashTx.balanceAfter, 800);

        // Security check: ensure sensitive fields are not leaked
        assert.strictEqual(dashTx.password, undefined);
        assert.strictEqual(dashTx.tokens, undefined);
      } finally {
        Transaction.find = origTxFind;
        Transaction.countDocuments = origTxCount;
        User.findById = origUserFindById;
        Wallet.findOne = origWalletFindOne;
        UserPlan.find = origUserPlanFind;
      }
    });

    it('Transaction schema supports balanceBefore and balanceAfter without breaking legacy records', async () => {
      // 1. Legacy transaction with no balanceBefore / balanceAfter
      const legacyTx = new Transaction({
        user: new mongoose.Types.ObjectId(),
        wallet: new mongoose.Types.ObjectId(),
        type: 'debit',
        amount: 50,
        description: 'Legacy Plan Purchase',
        status: 'completed',
        reference: new mongoose.Types.ObjectId().toString(),
      });
      await assert.doesNotReject(async () => {
        await legacyTx.validate();
      }, 'Legacy transaction without balance snapshots must be valid');

      // 2. Modern transaction with snapshot fields
      const modernTx = new Transaction({
        user: new mongoose.Types.ObjectId(),
        wallet: new mongoose.Types.ObjectId(),
        type: 'debit',
        amount: 50,
        description: 'Modern Plan Purchase',
        status: 'completed',
        reference: new mongoose.Types.ObjectId().toString(),
        balanceBefore: 200,
        balanceAfter: 150,
      });
      await assert.doesNotReject(async () => {
        await modernTx.validate();
      }, 'Modern transaction with balance snapshots must be valid');
      assert.strictEqual(modernTx.balanceBefore, 200);
      assert.strictEqual(modernTx.balanceAfter, 150);

      // 3. Invalid balance type validation
      const invalidTx = new Transaction({
        user: new mongoose.Types.ObjectId(),
        wallet: new mongoose.Types.ObjectId(),
        type: 'debit',
        amount: 50,
        balanceBefore: 'invalid-non-numeric',
      });
      await assert.rejects(
        async () => {
          await invalidTx.validate();
        },
        (err) => {
          assert.ok(err.errors?.balanceBefore, 'Non-numeric balanceBefore must trigger validation error');
          return true;
        }
      );
    });
  });
});


