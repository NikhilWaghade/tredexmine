import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { UserPlan } from '../src/models/UserPlan.js';
import { Transaction } from '../src/models/Transaction.js';
import { generateAccessToken } from '../src/utils/tokenService.js';
import * as dashboardService from '../src/services/dashboardService.js';

describe('User Dashboard Integration Tests (GET /api/v1/dashboard)', () => {
  let server;
  let baseUrl;

  const userAId = new mongoose.Types.ObjectId();
  const userBId = new mongoose.Types.ObjectId();

  const userA = {
    _id: userAId,
    name: 'Alice User',
    email: 'alice@example.com',
    role: 'user',
    referralCode: 'TXMALICE',
  };

  const userB = {
    _id: userBId,
    name: 'Bob User',
    email: 'bob@example.com',
    role: 'user',
    referralCode: 'TXMBOB00',
  };

  let tokenA;
  let tokenB;

  before(async () => {
    tokenA = generateAccessToken({ id: userAId, role: userA.role });
    tokenB = generateAccessToken({ id: userBId, role: userB.role });

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

  describe('Authentication Enforcement', () => {
    it('rejects unauthenticated request to /api/v1/dashboard with 401', async () => {
      const res = await fetch(`${baseUrl}/api/v1/dashboard`);
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /access token missing/);
    });

    it('rejects request with invalid token with 401', async () => {
      const res = await fetch(`${baseUrl}/api/v1/dashboard`, {
        headers: { Authorization: 'Bearer invalid_tampered_token' },
      });
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    });
  });

  describe('User Isolation & Data Boundaries', () => {
    it('returns only authenticated user data and isolates from other users', async () => {
      const origUserFindById = User.findById;
      const origWalletFindOne = Wallet.findOne;
      const origUserPlanFind = UserPlan.find;
      const origTxFind = Transaction.find;

      User.findById = (id) => ({
        select: () => {
          if (id.toString() === userAId.toString()) {
            return Promise.resolve(userA);
          }
          if (id.toString() === userBId.toString()) {
            return Promise.resolve(userB);
          }
          return Promise.resolve(null);
        },
      });

      Wallet.findOne = (query) => {
        if (query.user.toString() === userAId.toString()) {
          return Promise.resolve({ user: userAId, balance: 1500, planIncome: 0, referralIncome: 0 });
        }
        if (query.user.toString() === userBId.toString()) {
          return Promise.resolve({ user: userBId, balance: 50, planIncome: 0, referralIncome: 0 });
        }
        return Promise.resolve(null);
      };

      UserPlan.find = (query) => {
        const mockPlans = [
          {
            _id: new mongoose.Types.ObjectId(),
            user: userAId,
            planName: 'Professional',
            price: 1000,
            durationDays: 30,
            hashRate: '70 MH/s',
            status: 'active',
            startDate: new Date(),
            endDate: new Date(Date.now() + 86400000 * 20),
          },
          {
            _id: new mongoose.Types.ObjectId(),
            user: userBId,
            planName: 'Starter',
            price: 300,
            durationDays: 30,
            hashRate: '15 MH/s',
            status: 'active',
            startDate: new Date(),
            endDate: new Date(Date.now() + 86400000 * 10),
          },
        ];

        const filtered = mockPlans.filter((p) => p.user.toString() === query.user.toString());
        return {
          sort: () => Promise.resolve(filtered),
        };
      };

      Transaction.find = (query) => {
        if (query && query.description && query.description.$regex) {
          return Promise.resolve([]);
        }
        // Return transactions strictly matching query.user
        return {
          sort: () => ({
            limit: () => ({
              select: () =>
                Promise.resolve(
                  query.user.toString() === userAId.toString()
                    ? [
                        {
                          _id: new mongoose.Types.ObjectId(),
                          user: userAId,
                          type: 'debit',
                          amount: 1000,
                          description: 'Plan Purchase: Professional',
                          status: 'completed',
                          createdAt: new Date(),
                        },
                      ]
                    : [
                        {
                          _id: new mongoose.Types.ObjectId(),
                          user: userBId,
                          type: 'debit',
                          amount: 300,
                          description: 'Plan Purchase: Starter',
                          status: 'completed',
                          createdAt: new Date(),
                        },
                      ]
                ),
            }),
          }),
        };
      };

      try {
        // Request as User A
        const resA = await fetch(`${baseUrl}/api/v1/dashboard`, {
          headers: { Authorization: `Bearer ${tokenA}` },
        });

        assert.strictEqual(resA.status, 200);
        const dataA = await resA.json();
        assert.strictEqual(dataA.success, true);
        assert.strictEqual(dataA.data.user.email, 'alice@example.com');
        assert.strictEqual(dataA.data.wallet.balance, 1500);
        assert.strictEqual(dataA.data.activePlans.count, 1);
        assert.strictEqual(dataA.data.activePlans.plans[0].name, 'Professional');
        assert.strictEqual(dataA.data.recentTransactions[0].description, 'Plan Purchase: Professional');

        // Request as User B
        const resB = await fetch(`${baseUrl}/api/v1/dashboard`, {
          headers: { Authorization: `Bearer ${tokenB}` },
        });

        assert.strictEqual(resB.status, 200);
        const dataB = await resB.json();
        assert.strictEqual(dataB.success, true);
        assert.strictEqual(dataB.data.user.email, 'bob@example.com');
        assert.strictEqual(dataB.data.wallet.balance, 50);
        assert.strictEqual(dataB.data.activePlans.count, 1);
        assert.strictEqual(dataB.data.activePlans.plans[0].name, 'Starter');
        assert.strictEqual(dataB.data.recentTransactions[0].description, 'Plan Purchase: Starter');
      } finally {
        User.findById = origUserFindById;
        Wallet.findOne = origWalletFindOne;
        UserPlan.find = origUserPlanFind;
        Transaction.find = origTxFind;
      }
    });

    it('excludes expired plans from active plans count and details', async () => {
      const origUserFindById = User.findById;
      const origWalletFindOne = Wallet.findOne;
      const origUserPlanFind = UserPlan.find;
      const origTxFind = Transaction.find;

      User.findById = () => ({
        select: () => Promise.resolve(userA),
      });

      Wallet.findOne = () => Promise.resolve({ user: userAId, balance: 500 });

      // Simulate one active plan (endDate in future) and one expired plan (endDate in past)
      UserPlan.find = (query) => {
        assert.ok(query.endDate);
        assert.ok(query.endDate.$gt); // Confirms service filtered for active endDate > now

        // Return only the unexpired plan
        return {
          sort: () =>
            Promise.resolve([
              {
                _id: new mongoose.Types.ObjectId(),
                user: userAId,
                planName: 'Active Node',
                price: 500,
                durationDays: 30,
                status: 'active',
                startDate: new Date(),
                endDate: new Date(Date.now() + 86400000 * 5),
              },
            ]),
        };
      };

      Transaction.find = (query) => {
        if (query && query.description && query.description.$regex) {
          return Promise.resolve([]);
        }
        return {
          sort: () => ({ limit: () => ({ select: () => Promise.resolve([]) }) }),
        };
      };

      try {
        const res = await fetch(`${baseUrl}/api/v1/dashboard`, {
          headers: { Authorization: `Bearer ${tokenA}` },
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.data.activePlans.count, 1);
        assert.strictEqual(data.data.activePlans.plans[0].name, 'Active Node');
      } finally {
        User.findById = origUserFindById;
        Wallet.findOne = origWalletFindOne;
        UserPlan.find = origUserPlanFind;
        Transaction.find = origTxFind;
      }
    });
  });

  describe('Earnings Ledger & Honest Accounting Tests', () => {
    it('returns not_configured status when no verified income records exist (does not invent earnings)', async () => {
      const origUserFindById = User.findById;
      const origWalletFindOne = Wallet.findOne;
      const origUserPlanFind = UserPlan.find;
      const origTxFind = Transaction.find;

      User.findById = () => ({
        select: () => Promise.resolve(userA),
      });

      Wallet.findOne = () =>
        Promise.resolve({
          user: userAId,
          balance: 1000,
          planIncome: 0,
          referralIncome: 0,
        });

      UserPlan.find = () => ({ sort: () => Promise.resolve([]) });

      // Only deposit or plan debit transactions (no earnings)
      Transaction.find = (query) => {
        if (query.description && query.description.$regex) {
          // Income query returns empty
          return Promise.resolve([]);
        }
        return {
          sort: () => ({ limit: () => ({ select: () => Promise.resolve([]) }) }),
        };
      };

      try {
        const res = await fetch(`${baseUrl}/api/v1/dashboard`, {
          headers: { Authorization: `Bearer ${tokenA}` },
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.data.earnings.today, 0);
        assert.strictEqual(data.data.earnings.total, 0);
        assert.strictEqual(data.data.earnings.status, 'not_configured');
        assert.strictEqual(data.data.earnings.isConfigured, false);
        assert.match(data.data.earnings.message, /not configured/i);
      } finally {
        User.findById = origUserFindById;
        Wallet.findOne = origWalletFindOne;
        UserPlan.find = origUserPlanFind;
        Transaction.find = origTxFind;
      }
    });

    it('does not treat wallet top-up credits or plan debits as earnings', async () => {
      const origUserFindById = User.findById;
      const origWalletFindOne = Wallet.findOne;
      const origUserPlanFind = UserPlan.find;
      const origTxFind = Transaction.find;

      User.findById = () => ({
        select: () => Promise.resolve(userA),
      });

      Wallet.findOne = () =>
        Promise.resolve({
          user: userAId,
          balance: 2000,
          planIncome: 0,
          referralIncome: 0,
        });

      UserPlan.find = () => ({ sort: () => Promise.resolve([]) });

      // Transactions have top-ups and plan purchases
      Transaction.find = (query) => {
        if (query.description && query.description.$regex) {
          // Income query checks regex: /(yield|income|payout|roi|reward|dividend)/i
          // Top-up descriptions will NOT match
          return Promise.resolve([]);
        }
        return {
          sort: () => ({
            limit: () => ({
              select: () =>
                Promise.resolve([
                  {
                    _id: new mongoose.Types.ObjectId(),
                    type: 'credit',
                    amount: 2000,
                    description: 'Wallet Top-up: Net Banking',
                    status: 'completed',
                    createdAt: new Date(),
                  },
                  {
                    _id: new mongoose.Types.ObjectId(),
                    type: 'debit',
                    amount: 500,
                    description: 'Plan Purchase: Basic Plus',
                    status: 'completed',
                    createdAt: new Date(),
                  },
                ]),
            }),
          }),
        };
      };

      try {
        const res = await fetch(`${baseUrl}/api/v1/dashboard`, {
          headers: { Authorization: `Bearer ${tokenA}` },
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        // Earnings must still be 0 because neither top-up nor plan purchase is income
        assert.strictEqual(data.data.earnings.today, 0);
        assert.strictEqual(data.data.earnings.total, 0);
        assert.strictEqual(data.data.earnings.isConfigured, false);
      } finally {
        User.findById = origUserFindById;
        Wallet.findOne = origWalletFindOne;
        UserPlan.find = origUserPlanFind;
        Transaction.find = origTxFind;
      }
    });

    it('correctly sums today and total earnings when verified completed income transactions exist', async () => {
      const origUserFindById = User.findById;
      const origWalletFindOne = Wallet.findOne;
      const origUserPlanFind = UserPlan.find;
      const origTxFind = Transaction.find;

      User.findById = () => ({
        select: () => Promise.resolve(userA),
      });

      Wallet.findOne = () =>
        Promise.resolve({
          user: userAId,
          balance: 500,
          planIncome: 150,
          referralIncome: 50,
        });

      UserPlan.find = () => ({ sort: () => Promise.resolve([]) });

      const now = new Date();
      const yesterday = new Date(Date.now() - 86400000);

      const incomeTransactions = [
        {
          _id: new mongoose.Types.ObjectId(),
          user: userAId,
          type: 'credit',
          amount: 25,
          description: 'Verified Mining Yield Payout #1',
          status: 'completed',
          createdAt: now, // Today
        },
        {
          _id: new mongoose.Types.ObjectId(),
          user: userAId,
          type: 'credit',
          amount: 35,
          description: 'Referral Income Settlement',
          status: 'completed',
          createdAt: now, // Today
        },
        {
          _id: new mongoose.Types.ObjectId(),
          user: userAId,
          type: 'credit',
          amount: 40,
          description: 'Verified Mining Yield Payout #0',
          status: 'completed',
          createdAt: yesterday, // Yesterday
        },
      ];

      Transaction.find = (query) => {
        if (query.description && query.description.$regex) {
          return Promise.resolve(incomeTransactions);
        }
        return {
          sort: () => ({ limit: () => ({ select: () => Promise.resolve(incomeTransactions) }) }),
        };
      };

      try {
        const res = await fetch(`${baseUrl}/api/v1/dashboard`, {
          headers: { Authorization: `Bearer ${tokenA}` },
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.data.earnings.isConfigured, true);
        assert.strictEqual(data.data.earnings.status, 'verified');
        assert.strictEqual(data.data.earnings.today, 60); // 25 + 35 = 60
        // Total is max of totalTx (100) or walletRecordedIncome (200)
        assert.strictEqual(data.data.earnings.total, 200);
      } finally {
        User.findById = origUserFindById;
        Wallet.findOne = origWalletFindOne;
        UserPlan.find = origUserPlanFind;
        Transaction.find = origTxFind;
      }
    });
  });
});
