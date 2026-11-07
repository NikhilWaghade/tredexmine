import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { Transaction } from '../src/models/Transaction.js';
import { Deposit } from '../src/models/Deposit.js';
import { Withdrawal } from '../src/models/Withdrawal.js';
import { generateAccessToken } from '../src/utils/tokenService.js';
import {
  createDepositIntent,
  verifyDeposit,
  createWithdrawalRequest,
  cancelWithdrawalRequest,
  approveWithdrawalAdmin,
  rejectWithdrawalAdmin,
  updateWithdrawalStatusAdmin,
  generateMockDepositSignature,
  verifyMockDepositSignature,
  maskPayoutIdentifier,
} from '../src/services/walletService.js';
import { getUserDashboard } from '../src/services/dashboardService.js';

describe('Wallet Deposit, Withdrawal & Ledger Foundation Tests', () => {
  let server;
  let baseUrl;

  const mockUserId = new mongoose.Types.ObjectId().toString();
  const mockOtherUserId = new mongoose.Types.ObjectId().toString();
  const mockAdminId = new mongoose.Types.ObjectId().toString();

  const mockUser = {
    _id: mockUserId,
    name: 'Standard User',
    email: 'user@example.com',
    role: 'user',
  };

  const mockOtherUser = {
    _id: mockOtherUserId,
    name: 'Other User',
    email: 'other@example.com',
    role: 'user',
  };

  const mockAdminUser = {
    _id: mockAdminId,
    name: 'System Admin',
    email: 'admin@example.com',
    role: 'admin',
  };

  let userToken;
  let otherUserToken;
  let adminToken;
  let origUserFindById;

  before(async () => {
    origUserFindById = User.findById;
    User.findById = (id) => ({
      select: () => {
        const idStr = id?.toString ? id.toString() : String(id);
        if (idStr === mockAdminId) {
          return Promise.resolve(mockAdminUser);
        }
        if (idStr === mockOtherUserId) {
          return Promise.resolve(mockOtherUser);
        }
        return Promise.resolve(mockUser);
      },
    });

    userToken = generateAccessToken(mockUser);
    otherUserToken = generateAccessToken(mockOtherUser);
    adminToken = generateAccessToken(mockAdminUser);

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
    User.findById = origUserFindById;
    await new Promise((resolve) => server.close(resolve));
  });

  /* ==========================================================================
     1. HELPER & CRYPTO SIGNATURE UNIT TESTS
     ========================================================================== */
  describe('Helper & Signature Unit Tests', () => {
    it('generates and verifies mock deposit cryptographic signatures correctly', () => {
      const depRef = 'DEP-TEST-1001';
      const orderId = 'mock_ord_test_001';
      const signature = generateMockDepositSignature(depRef, orderId);

      assert.strictEqual(typeof signature, 'string');
      assert.strictEqual(signature.length, 64);

      const isValid = verifyMockDepositSignature(depRef, orderId, signature);
      assert.strictEqual(isValid, true);
    });

    it('rejects tampered or forged mock deposit signatures', () => {
      const depRef = 'DEP-TEST-1001';
      const orderId = 'mock_ord_test_001';
      const forgedSig = '0000000000000000000000000000000000000000000000000000000000000000';

      const isValid = verifyMockDepositSignature(depRef, orderId, forgedSig);
      assert.strictEqual(isValid, false);
    });

    it('masks sensitive payout identifiers properly', () => {
      assert.strictEqual(maskPayoutIdentifier('testuser@okhdfcbank'), 't***r@okhdfcbank');
      assert.strictEqual(maskPayoutIdentifier('123456789012'), '******9012');
      assert.strictEqual(maskPayoutIdentifier(''), '');
      assert.strictEqual(maskPayoutIdentifier(null), '');
    });
  });

  /* ==========================================================================
     2. DEPOSIT HTTP ENDPOINT INTEGRATION TESTS
     ========================================================================== */
  describe('Deposit HTTP Endpoint Integration Tests', () => {
    it('POST /api/v1/wallet/deposit/intent rejects unauthenticated requests with 401', async () => {
      const res = await fetch(`${baseUrl}/api/v1/wallet/deposit/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500 }),
      });
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    it('POST /api/v1/wallet/deposit/intent rejects invalid deposit amounts (< 100, negative, strings) with 400', async () => {
      // Below min (50)
      const res1 = await fetch(`${baseUrl}/api/v1/wallet/deposit/intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({ amount: 50 }),
      });
      assert.strictEqual(res1.status, 400);

      // Negative amount
      const res2 = await fetch(`${baseUrl}/api/v1/wallet/deposit/intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({ amount: -100 }),
      });
      assert.strictEqual(res2.status, 400);

      // Non-numeric amount
      const res3 = await fetch(`${baseUrl}/api/v1/wallet/deposit/intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({ amount: 'invalid' }),
      });
      assert.strictEqual(res3.status, 400);
    });

    it('POST /api/v1/wallet/deposit/intent rejects client-supplied status or balance fields with 400', async () => {
      const res = await fetch(`${baseUrl}/api/v1/wallet/deposit/intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({ amount: 500, status: 'completed', balance: 999999 }),
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.errors[0], /Client-supplied/);
    });

    it('POST /api/v1/wallet/deposit/intent returns 503 when Razorpay gateway is unconfigured', async () => {
      const origKeyId = process.env.RAZORPAY_KEY_ID;
      const origSecret = process.env.RAZORPAY_KEY_SECRET;

      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;

      const origUserFindById = User.findById;
      const origWalletFindOne = Wallet.findOne;
      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      Wallet.findOne = async () => ({ _id: new mongoose.Types.ObjectId(), user: mockUserId, balance: 100 });

      try {
        const res = await fetch(`${baseUrl}/api/v1/wallet/deposit/intent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${userToken}`,
          },
          body: JSON.stringify({ amount: 500, provider: 'razorpay' }),
        });
        assert.strictEqual(res.status, 503);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.match(data.message, /unconfigured/);
      } finally {
        process.env.RAZORPAY_KEY_ID = origKeyId;
        process.env.RAZORPAY_KEY_SECRET = origSecret;
        User.findById = origUserFindById;
        Wallet.findOne = origWalletFindOne;
      }
    });

    it('POST /api/v1/wallet/deposit/intent succeeds with mock provider in development mode', async () => {
      const origUserFindById = User.findById;
      const origWalletFindOne = Wallet.findOne;
      const origDepositCreate = Deposit.create;
      const origDepositFindOne = Deposit.findOne;

      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      Wallet.findOne = async () => ({ _id: new mongoose.Types.ObjectId(), user: mockUserId, balance: 100 });
      Deposit.findOne = async () => null;
      Deposit.create = async (doc) => ({
        ...doc,
        _id: new mongoose.Types.ObjectId(),
      });

      try {
        const res = await fetch(`${baseUrl}/api/v1/wallet/deposit/intent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${userToken}`,
          },
          body: JSON.stringify({ amount: 1000, provider: 'mock' }),
        });
        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.data.amount, 1000);
        assert.strictEqual(data.data.provider, 'mock');
        assert.strictEqual(data.data.isTest, true);
        assert.match(data.data.depositReference, /^DEP-/);
        assert.strictEqual(typeof data.data.mockSignature, 'string');
      } finally {
        User.findById = origUserFindById;
        Wallet.findOne = origWalletFindOne;
        Deposit.create = origDepositCreate;
        Deposit.findOne = origDepositFindOne;
      }
    });

    it('POST /api/v1/wallet/deposit/verify rejects invalid signature with 400 and marks deposit failed', async () => {
      const mockDeposit = {
        _id: new mongoose.Types.ObjectId(),
        user: new mongoose.Types.ObjectId(mockUserId),
        wallet: new mongoose.Types.ObjectId(),
        amount: 1000,
        depositReference: 'DEP-TEST-VERIFY-01',
        orderId: 'mock_ord_001',
        provider: 'mock',
        status: 'created',
        save: async function () {
          return this;
        },
      };

      const origUserFindById = User.findById;
      const origDepositFindOne = Deposit.findOne;

      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      Deposit.findOne = async () => mockDeposit;

      try {
        const res = await fetch(`${baseUrl}/api/v1/wallet/deposit/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${userToken}`,
          },
          body: JSON.stringify({
            depositReference: 'DEP-TEST-VERIFY-01',
            signature: 'invalid_forged_signature_hex_12345',
          }),
        });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(mockDeposit.status, 'failed');
        assert.match(mockDeposit.failureReason, /signature/i);
      } finally {
        User.findById = origUserFindById;
        Deposit.findOne = origDepositFindOne;
      }
    });

    it('POST /api/v1/wallet/deposit/verify succeeds with valid signature, credits wallet, and creates ledger entry', async () => {
      const depRef = 'DEP-TEST-SUCCESS-01';
      const orderId = 'mock_ord_success_001';
      const validSig = generateMockDepositSignature(depRef, orderId);

      const mockDeposit = {
        _id: new mongoose.Types.ObjectId(),
        user: new mongoose.Types.ObjectId(mockUserId),
        wallet: new mongoose.Types.ObjectId(),
        amount: 500,
        depositReference: depRef,
        orderId,
        provider: 'mock',
        status: 'created',
        save: async function () {
          return this;
        },
      };

      let walletBalance = 200;
      let createdTransaction = null;

      const origUserFindById = User.findById;
      const origDepositFindOne = Deposit.findOne;
      const origDepositFindOneAndUpdate = Deposit.findOneAndUpdate;
      const origDepositUpdateOne = Deposit.updateOne;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origTxFindOne = Transaction.findOne;
      const origTxCreate = Transaction.create;

      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      Deposit.findOne = async () => mockDeposit;
      Deposit.findOneAndUpdate = async () => {
        mockDeposit.status = 'completed';
        mockDeposit.creditedAt = new Date();
        return mockDeposit;
      };
      Deposit.updateOne = async () => ({ acknowledged: true });
      Wallet.findOne = async () => ({ _id: mockDeposit.wallet, user: mockUserId, balance: walletBalance });
      Wallet.findOneAndUpdate = async (query, update) => {
        walletBalance += update.$inc.balance;
        return { _id: mockDeposit.wallet, user: mockUserId, balance: walletBalance };
      };
      Transaction.findOne = async () => null;
      Transaction.create = async (doc) => {
        createdTransaction = Array.isArray(doc) ? doc[0] : doc;
        return createdTransaction;
      };

      try {
        const res = await fetch(`${baseUrl}/api/v1/wallet/deposit/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${userToken}`,
          },
          body: JSON.stringify({
            depositReference: depRef,
            signature: validSig,
          }),
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.wallet.balance, 700);
        assert.strictEqual(mockDeposit.status, 'completed');

        // Verify ledger entry
        assert.ok(createdTransaction);
        assert.strictEqual(createdTransaction.type, 'credit');
        assert.strictEqual(createdTransaction.amount, 500);
        assert.strictEqual(createdTransaction.reference, depRef);
        assert.strictEqual(createdTransaction.balanceBefore, 200);
        assert.strictEqual(createdTransaction.balanceAfter, 700);
      } finally {
        User.findById = origUserFindById;
        Deposit.findOne = origDepositFindOne;
        Deposit.findOneAndUpdate = origDepositFindOneAndUpdate;
        Deposit.updateOne = origDepositUpdateOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        Transaction.findOne = origTxFindOne;
        Transaction.create = origTxCreate;
      }
    });

    it('POST /api/v1/wallet/deposit/verify is idempotent: returns success without double-crediting if already completed', async () => {
      const depRef = 'DEP-ALREADY-COMPLETED';
      const mockDeposit = {
        _id: new mongoose.Types.ObjectId(),
        user: new mongoose.Types.ObjectId(mockUserId),
        wallet: new mongoose.Types.ObjectId(),
        amount: 500,
        depositReference: depRef,
        status: 'completed',
      };

      let creditCalled = false;
      const origUserFindById = User.findById;
      const origDepositFindOne = Deposit.findOne;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;

      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      Deposit.findOne = async () => mockDeposit;
      Wallet.findOne = async () => ({ balance: 1000 });
      Wallet.findOneAndUpdate = async () => {
        creditCalled = true;
      };

      try {
        const res = await fetch(`${baseUrl}/api/v1/wallet/deposit/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${userToken}`,
          },
          body: JSON.stringify({
            depositReference: depRef,
            signature: 'dummy_sig',
          }),
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.isAlreadyVerified, true);
        assert.strictEqual(creditCalled, false);
      } finally {
        User.findById = origUserFindById;
        Deposit.findOne = origDepositFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
      }
    });
  });

  /* ==========================================================================
     3. WITHDRAWAL REQUEST & BALANCE RESERVATION TESTS
     ========================================================================== */
  describe('Withdrawal Request & Balance Reservation Tests', () => {
    it('POST /api/v1/wallet/withdraw rejects unauthenticated requests with 401', async () => {
      const res = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 200, idempotencyKey: 'idemp-01' }),
      });
      assert.strictEqual(res.status, 401);
    });

    it('POST /api/v1/wallet/withdraw rejects missing idempotencyKey with 400', async () => {
      const res = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({ amount: 200 }),
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.errors[0], /Idempotency key/);
    });

    it('POST /api/v1/wallet/withdraw rejects client-supplied status, reference, or balance fields with 400', async () => {
      const res = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({
          amount: 200,
          idempotencyKey: 'idemp-02',
          status: 'APPROVED',
          balance: 100000,
        }),
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.errors[0], /Client-supplied/);
    });

    it('POST /api/v1/wallet/withdraw rejects request when withdrawable balance is insufficient', async () => {
      const origUserFindById = User.findById;
      const origWithdrawalFindOne = Withdrawal.findOne;
      const origWalletFindOne = Wallet.findOne;

      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      Withdrawal.findOne = async () => null;
      Wallet.findOne = async () => ({ _id: new mongoose.Types.ObjectId(), balance: 150 });

      try {
        const res = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${userToken}`,
          },
          body: JSON.stringify({ amount: 500, idempotencyKey: 'idemp-insufficient-01' }),
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.match(data.message, /Insufficient withdrawable wallet balance/);
      } finally {
        User.findById = origUserFindById;
        Withdrawal.findOne = origWithdrawalFindOne;
        Wallet.findOne = origWalletFindOne;
      }
    });

    it('POST /api/v1/wallet/withdraw atomically reserves balance, creates pending ledger entry, and returns 201', async () => {
      let walletBalance = 1000;
      let createdWithdrawal = null;
      let createdTransaction = null;

      const origUserFindById = User.findById;
      const origWithdrawalFindOne = Withdrawal.findOne;
      const origWithdrawalCreate = Withdrawal.create;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origTxCreate = Transaction.create;

      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      Withdrawal.findOne = async () => null;
      Wallet.findOne = async () => ({ _id: new mongoose.Types.ObjectId(), balance: walletBalance });
      Wallet.findOneAndUpdate = async (query, update) => {
        if (query.balance && query.balance.$gte && walletBalance < query.balance.$gte) {
          return null;
        }
        walletBalance += update.$inc.balance;
        return { _id: new mongoose.Types.ObjectId(), balance: walletBalance };
      };
      Withdrawal.create = async (doc) => {
        createdWithdrawal = Array.isArray(doc) ? doc[0] : doc;
        return createdWithdrawal;
      };
      Transaction.create = async (doc) => {
        createdTransaction = Array.isArray(doc) ? doc[0] : doc;
        return createdTransaction;
      };

      try {
        const res = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${userToken}`,
          },
          body: JSON.stringify({
            amount: 400,
            idempotencyKey: 'idemp-success-01',
            payoutMethod: 'upi',
            payoutDetails: { identifier: 'tester@upi' },
          }),
        });
        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.wallet.balance, 600);
        assert.strictEqual(walletBalance, 600);

        // Verify withdrawal record
        assert.ok(createdWithdrawal);
        assert.strictEqual(createdWithdrawal.status, 'PENDING');
        assert.strictEqual(createdWithdrawal.amount, 400);
        assert.strictEqual(createdWithdrawal.refundIssued, false);
        assert.strictEqual(createdWithdrawal.payoutDetails.maskedIdentifier, 't***r@upi');

        // Verify ledger entry
        assert.ok(createdTransaction);
        assert.strictEqual(createdTransaction.type, 'debit');
        assert.strictEqual(createdTransaction.status, 'pending');
        assert.strictEqual(createdTransaction.amount, 400);
        assert.strictEqual(createdTransaction.balanceBefore, 1000);
        assert.strictEqual(createdTransaction.balanceAfter, 600);
      } finally {
        User.findById = origUserFindById;
        Withdrawal.findOne = origWithdrawalFindOne;
        Withdrawal.create = origWithdrawalCreate;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        Transaction.create = origTxCreate;
      }
    });

    it('POST /api/v1/wallet/withdraw is idempotent: duplicate retry returns existing record without double-debiting', async () => {
      const existingWithdrawal = {
        _id: new mongoose.Types.ObjectId(),
        user: mockUserId,
        amount: 300,
        status: 'PENDING',
        withdrawalReference: 'WTH-EXISTING-01',
        idempotencyKey: 'idemp-duplicate-01',
      };

      let debitCalled = false;
      const origUserFindById = User.findById;
      const origWithdrawalFindOne = Withdrawal.findOne;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;

      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      Withdrawal.findOne = async () => existingWithdrawal;
      Wallet.findOne = async () => ({ balance: 700 });
      Wallet.findOneAndUpdate = async () => {
        debitCalled = true;
      };

      try {
        const res = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${userToken}`,
          },
          body: JSON.stringify({ amount: 300, idempotencyKey: 'idemp-duplicate-01' }),
        });
        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.strictEqual(data.isIdempotent, true);
        assert.strictEqual(data.withdrawal.withdrawalReference, 'WTH-EXISTING-01');
        assert.strictEqual(debitCalled, false);
      } finally {
        User.findById = origUserFindById;
        Withdrawal.findOne = origWithdrawalFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
      }
    });

    it('POST /api/v1/wallet/withdraw/:id/cancel allows user to cancel PENDING request and restores reserved balance exactly once', async () => {
      const withdrawalId = new mongoose.Types.ObjectId().toString();
      let walletBalance = 500;
      let createdRefundTx = null;

      const mockWithdrawal = {
        _id: withdrawalId,
        user: mockUserId,
        amount: 250,
        status: 'PENDING',
        withdrawalReference: 'WTH-CANCEL-01',
        refundIssued: false,
        save: async function () {
          return this;
        },
      };

      const origUserFindById = User.findById;
      const origWithdrawalFindOne = Withdrawal.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origTxCreate = Transaction.create;

      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      Withdrawal.findOne = async () => mockWithdrawal;
      Wallet.findOneAndUpdate = async (query, update) => {
        walletBalance += update.$inc.balance;
        return { balance: walletBalance };
      };
      Transaction.create = async (doc) => {
        createdRefundTx = Array.isArray(doc) ? doc[0] : doc;
        return createdRefundTx;
      };

      try {
        const res = await fetch(`${baseUrl}/api/v1/wallet/withdraw/${withdrawalId}/cancel`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${userToken}`,
          },
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(mockWithdrawal.status, 'CANCELLED');
        assert.strictEqual(mockWithdrawal.refundIssued, true);
        assert.strictEqual(walletBalance, 750);

        // Verify refund transaction
        assert.ok(createdRefundTx);
        assert.strictEqual(createdRefundTx.type, 'credit');
        assert.strictEqual(createdRefundTx.amount, 250);
        assert.strictEqual(createdRefundTx.reference, 'REFUND-WTH-CANCEL-01');
        assert.strictEqual(createdRefundTx.balanceBefore, 500);
        assert.strictEqual(createdRefundTx.balanceAfter, 750);
      } finally {
        User.findById = origUserFindById;
        Withdrawal.findOne = origWithdrawalFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        Transaction.create = origTxCreate;
      }
    });

    it('POST /api/v1/wallet/withdraw/:id/cancel rejects cancelling an already CANCELLED or COMPLETED request with 400', async () => {
      const mockWithdrawal = {
        _id: new mongoose.Types.ObjectId(),
        user: mockUserId,
        amount: 250,
        status: 'CANCELLED',
      };

      const origUserFindById = User.findById;
      const origWithdrawalFindOne = Withdrawal.findOne;

      User.findById = () => ({ select: () => Promise.resolve(mockUser) });
      Withdrawal.findOne = async () => mockWithdrawal;

      try {
        const res = await fetch(`${baseUrl}/api/v1/wallet/withdraw/${mockWithdrawal._id}/cancel`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${userToken}`,
          },
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.match(data.message, /Cannot cancel a withdrawal request that is already CANCELLED/);
      } finally {
        User.findById = origUserFindById;
        Withdrawal.findOne = origWithdrawalFindOne;
      }
    });
  });

  /* ==========================================================================
     4. ADMIN WITHDRAWAL REVIEW & STATE TRANSITION TESTS
     ========================================================================== */
  describe('Admin Withdrawal Review & State Transition Tests', () => {
    it('Admin endpoints reject ordinary user (role: user) with 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/v1/wallet/admin/withdrawals`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /Forbidden/);
    });

    it('PATCH /api/v1/wallet/admin/withdrawals/:id/approve successfully approves a PENDING request', async () => {
      const withdrawalId = new mongoose.Types.ObjectId().toString();
      const mockWithdrawal = {
        _id: withdrawalId,
        user: mockUserId,
        amount: 400,
        status: 'PENDING',
        save: async function () {
          return this;
        },
      };

      const origUserFindById = User.findById;
      const origWithdrawalFindById = Withdrawal.findById;

      User.findById = () => ({ select: () => Promise.resolve(mockAdminUser) });
      Withdrawal.findById = async () => mockWithdrawal;

      try {
        const res = await fetch(`${baseUrl}/api/v1/wallet/admin/withdrawals/${withdrawalId}/approve`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(mockWithdrawal.status, 'APPROVED');
        assert.strictEqual(mockWithdrawal.reviewedBy, mockAdminId);
        assert.ok(mockWithdrawal.reviewedAt);
      } finally {
        User.findById = origUserFindById;
        Withdrawal.findById = origWithdrawalFindById;
      }
    });

    it('PATCH /api/v1/wallet/admin/withdrawals/:id/approve rejects duplicate approval with 400', async () => {
      const mockWithdrawal = {
        _id: new mongoose.Types.ObjectId(),
        status: 'APPROVED',
      };

      const origUserFindById = User.findById;
      const origWithdrawalFindById = Withdrawal.findById;

      User.findById = () => ({ select: () => Promise.resolve(mockAdminUser) });
      Withdrawal.findById = async () => mockWithdrawal;

      try {
        const res = await fetch(`${baseUrl}/api/v1/wallet/admin/withdrawals/${mockWithdrawal._id}/approve`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.match(data.message, /already been approved/);
      } finally {
        User.findById = origUserFindById;
        Withdrawal.findById = origWithdrawalFindById;
      }
    });

    it('PATCH /api/v1/wallet/admin/withdrawals/:id/reject rejects request and refunds balance exactly once', async () => {
      const withdrawalId = new mongoose.Types.ObjectId().toString();
      let walletBalance = 300;
      let refundTx = null;

      const mockWithdrawal = {
        _id: withdrawalId,
        user: mockUserId,
        amount: 200,
        status: 'PENDING',
        withdrawalReference: 'WTH-ADMIN-REJ-01',
        refundIssued: false,
        save: async function () {
          return this;
        },
      };

      const origUserFindById = User.findById;
      const origWithdrawalFindById = Withdrawal.findById;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origTxCreate = Transaction.create;

      User.findById = () => ({ select: () => Promise.resolve(mockAdminUser) });
      Withdrawal.findById = async () => mockWithdrawal;
      Wallet.findOneAndUpdate = async (query, update) => {
        walletBalance += update.$inc.balance;
        return { balance: walletBalance };
      };
      Transaction.create = async (doc) => {
        refundTx = Array.isArray(doc) ? doc[0] : doc;
        return refundTx;
      };

      try {
        const res = await fetch(`${baseUrl}/api/v1/wallet/admin/withdrawals/${withdrawalId}/reject`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({ reason: 'Invalid UPI handle provided' }),
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(mockWithdrawal.status, 'REJECTED');
        assert.strictEqual(mockWithdrawal.rejectionReason, 'Invalid UPI handle provided');
        assert.strictEqual(mockWithdrawal.refundIssued, true);
        assert.strictEqual(walletBalance, 500);

        assert.ok(refundTx);
        assert.strictEqual(refundTx.type, 'credit');
        assert.strictEqual(refundTx.amount, 200);
        assert.strictEqual(refundTx.reference, 'REFUND-WTH-ADMIN-REJ-01');
      } finally {
        User.findById = origUserFindById;
        Withdrawal.findById = origWithdrawalFindById;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        Transaction.create = origTxCreate;
      }
    });

    it('PATCH /api/v1/wallet/admin/withdrawals/:id/reject rejects duplicate rejection with 400', async () => {
      const mockWithdrawal = {
        _id: new mongoose.Types.ObjectId(),
        status: 'REJECTED',
      };

      const origUserFindById = User.findById;
      const origWithdrawalFindById = Withdrawal.findById;

      User.findById = () => ({ select: () => Promise.resolve(mockAdminUser) });
      Withdrawal.findById = async () => mockWithdrawal;

      try {
        const res = await fetch(`${baseUrl}/api/v1/wallet/admin/withdrawals/${mockWithdrawal._id}/reject`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({ reason: 'Already rejected' }),
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.match(data.message, /already been rejected/);
      } finally {
        User.findById = origUserFindById;
        Withdrawal.findById = origWithdrawalFindById;
      }
    });

    it('PATCH /api/v1/wallet/admin/withdrawals/:id/status rejects invalid transitions (e.g. COMPLETED -> PROCESSING)', async () => {
      const mockWithdrawal = {
        _id: new mongoose.Types.ObjectId(),
        status: 'COMPLETED',
      };

      const origUserFindById = User.findById;
      const origWithdrawalFindById = Withdrawal.findById;

      User.findById = () => ({ select: () => Promise.resolve(mockAdminUser) });
      Withdrawal.findById = async () => mockWithdrawal;

      try {
        const res = await fetch(`${baseUrl}/api/v1/wallet/admin/withdrawals/${mockWithdrawal._id}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({ status: 'PROCESSING' }),
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.match(data.message, /Invalid state transition/);
      } finally {
        User.findById = origUserFindById;
        Withdrawal.findById = origWithdrawalFindById;
      }
    });

    it('PATCH /api/v1/wallet/admin/withdrawals/:id/status FAILED refunds balance exactly once', async () => {
      let walletBalance = 400;
      const mockWithdrawal = {
        _id: new mongoose.Types.ObjectId(),
        user: mockUserId,
        amount: 150,
        status: 'PROCESSING',
        withdrawalReference: 'WTH-FAIL-01',
        refundIssued: false,
        save: async function () {
          return this;
        },
      };

      const origUserFindById = User.findById;
      const origWithdrawalFindById = Withdrawal.findById;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origTxCreate = Transaction.create;

      User.findById = () => ({ select: () => Promise.resolve(mockAdminUser) });
      Withdrawal.findById = async () => mockWithdrawal;
      Wallet.findOneAndUpdate = async (query, update) => {
        walletBalance += update.$inc.balance;
        return { balance: walletBalance };
      };
      Transaction.create = async (doc) => doc;

      try {
        const res = await fetch(`${baseUrl}/api/v1/wallet/admin/withdrawals/${mockWithdrawal._id}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({ status: 'FAILED', adminNotes: 'Bank network timeout' }),
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(mockWithdrawal.status, 'FAILED');
        assert.strictEqual(mockWithdrawal.refundIssued, true);
        assert.strictEqual(walletBalance, 550);
      } finally {
        User.findById = origUserFindById;
        Withdrawal.findById = origWithdrawalFindById;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        Transaction.create = origTxCreate;
      }
    });
  });

  /* ==========================================================================
     5. LEDGER RECONCILIATION & EARNINGS SEPARATION INVARIANTS
     ========================================================================== */
  describe('Ledger Reconciliation & Verified Earnings Separation', () => {
    it('deposits and withdrawal refunds do NOT count as mining/yield earnings in dashboard', async () => {
      const origUserFindById = User.findById;
      const origWalletFindOne = Wallet.findOne;
      const origUserPlanFind = mongoose.model('UserPlan').find;
      const origTxFind = Transaction.find;

      User.findById = () => ({
        select: () =>
          Promise.resolve({
            _id: mockUserId,
            name: 'Audit User',
            email: 'audit@example.com',
            role: 'user',
            referralCode: 'TXM9999',
            createdAt: new Date(),
          }),
      });
      Wallet.findOne = async () => ({
        _id: new mongoose.Types.ObjectId(),
        user: mockUserId,
        balance: 1500,
        planIncome: 0,
        referralIncome: 0,
        totalWithdrawn: 0,
      });

      // No active plans
      mongoose.model('UserPlan').find = () => ({
        sort: () => Promise.resolve([]),
      });

      // Transaction find: includes a deposit and a withdrawal refund, but NO yield/roi/income transactions
      Transaction.find = (query) => {
        // If checking income transactions regex
        if (query && query.description && query.description.$regex) {
          // The regex is /(yield|income|payout|roi|reward|dividend)/i
          // Should return 0 matching transactions because deposits and refunds don't match
          return Promise.resolve([]);
        }
        // Recent transactions query
        return {
          sort: () => ({
            limit: () => ({
              select: () =>
                Promise.resolve([
                  {
                    _id: new mongoose.Types.ObjectId(),
                    type: 'credit',
                    amount: 1000,
                    description: 'Wallet Deposit (Development Test) - Ref: DEP-100',
                    status: 'completed',
                    reference: 'DEP-100',
                    balanceBefore: 0,
                    balanceAfter: 1000,
                    createdAt: new Date(),
                  },
                ]),
            }),
          }),
        };
      };

      try {
        const dashboard = await getUserDashboard(mockUserId);

        assert.strictEqual(dashboard.wallet.balance, 1500);
        assert.strictEqual(dashboard.earnings.today, 0);
        assert.strictEqual(dashboard.earnings.total, 0);
        assert.strictEqual(dashboard.earnings.status, 'not_configured');
        assert.strictEqual(dashboard.earnings.isConfigured, false);
        assert.strictEqual(dashboard.recentTransactions.length, 1);
        assert.strictEqual(dashboard.recentTransactions[0].reference, 'DEP-100');
      } finally {
        User.findById = origUserFindById;
        Wallet.findOne = origWalletFindOne;
        mongoose.model('UserPlan').find = origUserPlanFind;
        Transaction.find = origTxFind;
      }
    });

    it('Wallet model balance invariant enforces balance >= 0', async () => {
      const walletNegative = new Wallet({
        user: new mongoose.Types.ObjectId(),
        balance: -50,
      });

      await assert.rejects(
        async () => walletNegative.validate(),
        (err) => {
          assert.ok(err.errors.balance);
          assert.match(err.errors.balance.message, /cannot be negative/i);
          return true;
        }
      );
    });
  });
});
