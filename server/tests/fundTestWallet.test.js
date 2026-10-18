import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { Transaction } from '../src/models/Transaction.js';
import {
  assertNotProduction,
  parseFundingArgs,
  validateFundingInputs,
  fundTestWallet,
} from '../scripts/fundTestWallet.js';

describe('Development Wallet Funding Script Tests (fundTestWallet)', () => {
  const mockUserId = new mongoose.Types.ObjectId();
  const mockWalletId = new mongoose.Types.ObjectId();

  const mockUser = {
    _id: mockUserId,
    name: 'Dev Tester',
    email: 'devtester@example.com',
    role: 'user',
  };

  describe('Production Environment Guard', () => {
    it('refuses execution when environment is production', () => {
      assert.throws(
        () => assertNotProduction('production'),
        (err) => {
          assert.strictEqual(err.code, 'ERR_PRODUCTION_BLOCKED');
          assert.match(err.message, /Execution is blocked in production/);
          return true;
        }
      );
    });

    it('passes assertion when environment is development or test', () => {
      assert.doesNotThrow(() => assertNotProduction('development'));
      assert.doesNotThrow(() => assertNotProduction('test'));
    });

    it('fundTestWallet rejects immediately if invoked with env=production', async () => {
      await assert.rejects(
        async () => {
          await fundTestWallet({
            userId: mockUserId.toString(),
            amount: 100,
            env: 'production',
          });
        },
        (err) => {
          assert.strictEqual(err.code, 'ERR_PRODUCTION_BLOCKED');
          return true;
        }
      );
    });
  });

  describe('CLI and Environment Argument Parsing', () => {
    it('parses named flags correctly (--user, --amount, --reference)', () => {
      const parsed = parseFundingArgs([
        '--user',
        mockUserId.toString(),
        '--amount',
        '250.50',
        '--reference',
        'test-ref-001',
      ]);

      assert.strictEqual(parsed.userId, mockUserId.toString());
      assert.strictEqual(parsed.amount, 250.5);
      assert.strictEqual(parsed.reference, 'test-ref-001');
      assert.strictEqual(parsed.showHelp, false);
    });

    it('parses short flags correctly (-u, -a, -r)', () => {
      const parsed = parseFundingArgs([
        '-u',
        mockUserId.toString(),
        '-a',
        '500',
        '-r',
        'short-ref-1',
      ]);

      assert.strictEqual(parsed.userId, mockUserId.toString());
      assert.strictEqual(parsed.amount, 500);
      assert.strictEqual(parsed.reference, 'short-ref-1');
    });

    it('parses positional arguments correctly ([userId, amount, reference])', () => {
      const parsed = parseFundingArgs([mockUserId.toString(), '100', 'pos-ref']);

      assert.strictEqual(parsed.userId, mockUserId.toString());
      assert.strictEqual(parsed.amount, 100);
      assert.strictEqual(parsed.reference, 'pos-ref');
    });

    it('reads from environment variables when CLI arguments are omitted', () => {
      const env = {
        TEST_USER_ID: mockUserId.toString(),
        FUND_AMOUNT: '750',
        FUNDING_REFERENCE: 'env-ref-99',
      };

      const parsed = parseFundingArgs([], env);

      assert.strictEqual(parsed.userId, mockUserId.toString());
      assert.strictEqual(parsed.amount, 750);
      assert.strictEqual(parsed.reference, 'env-ref-99');
    });

    it('detects help flags (--help, -h)', () => {
      assert.strictEqual(parseFundingArgs(['--help']).showHelp, true);
      assert.strictEqual(parseFundingArgs(['-h']).showHelp, true);
    });
  });

  describe('Input Validation', () => {
    it('rejects when userId is missing', () => {
      assert.throws(
        () => validateFundingInputs({ userId: '', amount: 100 }),
        (err) => {
          assert.strictEqual(err.code, 'ERR_INVALID_USER_ID');
          return true;
        }
      );
    });

    it('rejects when userId is an invalid ObjectId format', () => {
      assert.throws(
        () => validateFundingInputs({ userId: 'not-a-valid-id', amount: 100 }),
        (err) => {
          assert.strictEqual(err.code, 'ERR_INVALID_USER_ID');
          return true;
        }
      );
    });

    it('rejects when amount is non-numeric, zero, or negative', () => {
      for (const invalidAmount of [NaN, 0, -50, null, undefined]) {
        assert.throws(
          () => validateFundingInputs({ userId: mockUserId.toString(), amount: invalidAmount }),
          (err) => {
            assert.strictEqual(err.code, 'ERR_INVALID_AMOUNT');
            return true;
          }
        );
      }
    });

    it('passes validation for valid user ID and positive amount', () => {
      assert.doesNotThrow(() =>
        validateFundingInputs({ userId: mockUserId.toString(), amount: 50.25 })
      );
    });
  });

  describe('User Verification and Database State Checks', () => {
    it('fails when user does not exist in the database', async () => {
      const origUserFindById = User.findById;
      User.findById = async () => null;

      try {
        await assert.rejects(
          async () => {
            await fundTestWallet({
              userId: mockUserId.toString(),
              amount: 500,
              env: 'development',
            });
          },
          (err) => {
            assert.strictEqual(err.code, 'ERR_USER_NOT_FOUND');
            assert.match(err.message, new RegExp(mockUserId.toString()));
            return true;
          }
        );
      } finally {
        User.findById = origUserFindById;
      }
    });

    it('fails safely and explains limitation when MongoDB session transactions are unavailable', async () => {
      const origUserFindById = User.findById;
      const origTxFindOne = Transaction.findOne;
      const origStartSession = mongoose.startSession;

      User.findById = async () => mockUser;
      Transaction.findOne = async () => null;
      // Simulate standalone MongoDB where startSession throws
      mongoose.startSession = async () => {
        throw new Error('Transaction numbers are only allowed on a replica set member or mongos');
      };

      try {
        await assert.rejects(
          async () => {
            await fundTestWallet({
              userId: mockUserId.toString(),
              amount: 500,
              env: 'development',
            });
          },
          (err) => {
            assert.strictEqual(err.code, 'TRANSACTIONS_UNAVAILABLE');
            assert.match(err.message, /replica set or mongos/);
            return true;
          }
        );
      } finally {
        User.findById = origUserFindById;
        Transaction.findOne = origTxFindOne;
        mongoose.startSession = origStartSession;
      }
    });
  });

  describe('Atomic Wallet Funding & Transaction Ledgering', () => {
    const createMockSession = () => {
      let inTransaction = false;
      let committed = false;
      let aborted = false;

      return {
        startTransaction() {
          inTransaction = true;
        },
        async commitTransaction() {
          committed = true;
          inTransaction = false;
        },
        async abortTransaction() {
          aborted = true;
          inTransaction = false;
        },
        async endSession() {},
        get inTransaction() {
          return inTransaction;
        },
        get committed() {
          return committed;
        },
        get aborted() {
          return aborted;
        },
      };
    };

    const mockQuery = (result) => {
      const p = Promise.resolve(result);
      p.session = () => Promise.resolve(result);
      return p;
    };

    it('successfully funds wallet atomically and creates matching credit transaction ledger record', async () => {
      let walletBalance = 100;
      let createdTransaction = null;
      const mockSession = createMockSession();

      const origUserFindById = User.findById;
      const origTxFindOne = Transaction.findOne;
      const origTxCreate = Transaction.create;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;

      User.findById = async () => mockUser;
      // No existing transaction for this reference (resolves to null both directly and via .session())
      Transaction.findOne = () => mockQuery(null);

      Wallet.findOne = () =>
        mockQuery({ _id: mockWalletId, user: mockUserId, balance: walletBalance });

      Wallet.findOneAndUpdate = async (query, update) => {
        if (update.$inc?.balance) {
          walletBalance += update.$inc.balance;
        }
        return { _id: mockWalletId, user: mockUserId, balance: walletBalance };
      };

      Transaction.create = async (data) => {
        const item = Array.isArray(data) ? data[0] : data;
        createdTransaction = { _id: new mongoose.Types.ObjectId(), ...item };
        return Array.isArray(data) ? [createdTransaction] : createdTransaction;
      };

      try {
        const result = await fundTestWallet({
          userId: mockUserId.toString(),
          amount: 500,
          reference: 'unit-test-fund-01',
          env: 'development',
          session: mockSession,
        });

        // Assert return structure
        assert.strictEqual(result.isIdempotent, false);
        assert.strictEqual(result.reference, 'unit-test-fund-01');
        assert.strictEqual(result.wallet.balance, 600);
        assert.strictEqual(result.user.id, mockUserId.toString());
        assert.strictEqual(result.user.email, mockUser.email);

        // Assert matching transaction ledger record
        assert.ok(createdTransaction);
        assert.strictEqual(createdTransaction.type, 'credit');
        assert.strictEqual(createdTransaction.amount, 500);
        assert.strictEqual(createdTransaction.status, 'completed');
        assert.strictEqual(createdTransaction.wallet.toString(), mockWalletId.toString());
        assert.strictEqual(createdTransaction.user.toString(), mockUserId.toString());
        assert.strictEqual(createdTransaction.reference, 'unit-test-fund-01');
        assert.match(createdTransaction.description, /Development test wallet funding/);
      } finally {
        User.findById = origUserFindById;
        Transaction.findOne = origTxFindOne;
        Transaction.create = origTxCreate;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
      }
    });

    it('is idempotent: rerunning with the same reference does not credit wallet balance twice', async () => {
      const initialBalance = 600;
      let walletBalance = initialBalance;
      const existingTx = {
        _id: new mongoose.Types.ObjectId(),
        user: mockUserId,
        wallet: mockWalletId,
        type: 'credit',
        amount: 500,
        status: 'completed',
        reference: 'unit-test-fund-01',
        description: 'Development test wallet funding: +$500.00 [Ref: unit-test-fund-01]',
      };

      const origUserFindById = User.findById;
      const origTxFindOne = Transaction.findOne;
      const origTxCreate = Transaction.create;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;

      User.findById = async () => mockUser;
      Transaction.findOne = () => mockQuery(existingTx);
      Wallet.findOne = () =>
        mockQuery({ _id: mockWalletId, user: mockUserId, balance: walletBalance });

      Wallet.findOneAndUpdate = async (query, update) => {
        if (update.$inc?.balance) {
          walletBalance += update.$inc.balance;
        }
        return { _id: mockWalletId, user: mockUserId, balance: walletBalance };
      };

      Transaction.create = async () => {
        assert.fail('Transaction.create should not be called for duplicate idempotent request');
      };

      try {
        const result = await fundTestWallet({
          userId: mockUserId.toString(),
          amount: 500,
          reference: 'unit-test-fund-01',
          env: 'development',
        });

        assert.strictEqual(result.isIdempotent, true);
        assert.strictEqual(result.reference, 'unit-test-fund-01');
        assert.strictEqual(result.wallet.balance, 600); // Balance unchanged
        assert.strictEqual(walletBalance, initialBalance); // Balance not incremented
        assert.strictEqual(result.transaction.reference, 'unit-test-fund-01');
        assert.match(result.message, /already been processed/);
      } finally {
        User.findById = origUserFindById;
        Transaction.findOne = origTxFindOne;
        Transaction.create = origTxCreate;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
      }
    });

    it('aborts transaction and does not commit changes if write fails midway', async () => {
      let walletBalance = 100;
      const mockSession = createMockSession();

      const origUserFindById = User.findById;
      const origTxFindOne = Transaction.findOne;
      const origTxCreate = Transaction.create;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;

      User.findById = async () => mockUser;
      Transaction.findOne = () => mockQuery(null);

      Wallet.findOne = () =>
        mockQuery({ _id: mockWalletId, user: mockUserId, balance: walletBalance });

      // Simulate failure during Transaction creation
      Transaction.create = async () => {
        throw new Error('Database write error: write concern failed');
      };

      try {
        await assert.rejects(
          async () => {
            await fundTestWallet({
              userId: mockUserId.toString(),
              amount: 500,
              reference: 'failing-test-ref',
              env: 'development',
              session: mockSession,
            });
          },
          (err) => {
            assert.strictEqual(err.message, 'Database write error: write concern failed');
            return true;
          }
        );

        // Wallet balance was never touched
        assert.strictEqual(walletBalance, 100);
      } finally {
        User.findById = origUserFindById;
        Transaction.findOne = origTxFindOne;
        Transaction.create = origTxCreate;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
      }
    });
  });
});
