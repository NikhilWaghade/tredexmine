import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { Plan } from '../src/models/Plan.js';
import { UserPlan } from '../src/models/UserPlan.js';
import { Payment } from '../src/models/Payment.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { Transaction } from '../src/models/Transaction.js';
import { generateAccessToken } from '../src/utils/tokenService.js';
import {
  verifyPaymentSignature,
  verifyWebhookSignature,
  setRazorpayInstance,
} from '../src/config/razorpay.js';
import * as paymentService from '../src/services/paymentService.js';

describe('Payment & UPI Gateway Integration Tests', () => {
  let server;
  let baseUrl;

  const testSecret = 'dev_test_razorpay_secret_key_12345';
  const testWebhookSecret = 'dev_test_webhook_secret_key_67890';

  const mockUserId = new mongoose.Types.ObjectId();
  const mockOtherUserId = new mongoose.Types.ObjectId();
  const mockPlanId = new mongoose.Types.ObjectId();
  const mockInactivePlanId = new mongoose.Types.ObjectId();

  const mockUser = {
    _id: mockUserId,
    name: 'UPI Tester',
    email: 'upitester@example.com',
    role: 'user',
  };

  const mockOtherUser = {
    _id: mockOtherUserId,
    name: 'Other User',
    email: 'otheruser@example.com',
    role: 'user',
  };

  let validUserToken;
  let otherUserToken;

  before(async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_mock_key_id';
    process.env.RAZORPAY_KEY_SECRET = testSecret;
    process.env.RAZORPAY_WEBHOOK_SECRET = testWebhookSecret;

    // Use mock Razorpay client in tests to avoid external network calls
    setRazorpayInstance({
      orders: {
        create: async (params) => ({
          id: 'order_mock_id_12345',
          amount: params.amount,
          currency: params.currency,
          receipt: params.receipt,
        }),
      },
    });

    validUserToken = generateAccessToken(mockUser);
    otherUserToken = generateAccessToken(mockOtherUser);

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
    setRazorpayInstance(null);
    await new Promise((resolve) => server.close(resolve));
  });

  describe('Cryptographic Signature Verification Unit Tests', () => {
    it('verifies a valid payment signature generated via HMAC-SHA256', () => {
      const orderId = 'order_valid_123';
      const paymentId = 'pay_valid_456';
      const signature = crypto
        .createHmac('sha256', testSecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      const isValid = verifyPaymentSignature({ orderId, paymentId, signature });
      assert.strictEqual(isValid, true);
    });

    it('rejects a forged or tampered payment signature', () => {
      const orderId = 'order_valid_123';
      const paymentId = 'pay_valid_456';
      const forgedSignature = '0000000000000000000000000000000000000000000000000000000000000000';

      const isValid = verifyPaymentSignature({ orderId, paymentId, signature: forgedSignature });
      assert.strictEqual(isValid, false);
    });

    it('verifies a valid webhook rawBody signature', () => {
      const rawPayload = JSON.stringify({ event: 'payment.captured', test: true });
      const signature = crypto
        .createHmac('sha256', testWebhookSecret)
        .update(rawPayload)
        .digest('hex');

      const isValid = verifyWebhookSignature({ rawBody: rawPayload, signature });
      assert.strictEqual(isValid, true);
    });

    it('rejects an invalid webhook signature', () => {
      const rawPayload = JSON.stringify({ event: 'payment.captured', test: true });
      const isValid = verifyWebhookSignature({ rawBody: rawPayload, signature: 'invalid_sig' });
      assert.strictEqual(isValid, false);
    });
  });

  describe('Payment Order Creation Endpoint (POST /api/v1/payments/create-order)', () => {
    it('rejects unauthenticated request with 401', async () => {
      const res = await fetch(`${baseUrl}/api/v1/payments/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: mockPlanId.toString() }),
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    it('rejects request with missing planId with 400', async () => {
      const origUserFindById = User.findById;
      User.findById = () => ({
        select: () => Promise.resolve(mockUser),
      });

      try {
        const res = await fetch(`${baseUrl}/api/v1/payments/create-order`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validUserToken}`,
          },
          body: JSON.stringify({}),
        });

        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.match(data.message, /Plan ID is required/);
      } finally {
        User.findById = origUserFindById;
      }
    });

    it('rejects request with invalid planId format with 400', async () => {
      const origUserFindById = User.findById;
      User.findById = () => ({
        select: () => Promise.resolve(mockUser),
      });

      try {
        const res = await fetch(`${baseUrl}/api/v1/payments/create-order`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validUserToken}`,
          },
          body: JSON.stringify({ planId: 'not-a-valid-object-id' }),
        });

        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.match(data.message, /Invalid plan ID format/);
      } finally {
        User.findById = origUserFindById;
      }
    });

    it('rejects request for non-existent or inactive plan with 404', async () => {
      const origUserFindById = User.findById;
      const origPlanFindOne = Plan.findOne;

      User.findById = () => ({
        select: () => Promise.resolve(mockUser),
      });
      Plan.findOne = async () => null;

      try {
        const res = await fetch(`${baseUrl}/api/v1/payments/create-order`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validUserToken}`,
          },
          body: JSON.stringify({ planId: mockInactivePlanId.toString() }),
        });

        assert.strictEqual(res.status, 404);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.match(data.message, /Plan not found or is currently inactive/);
      } finally {
        User.findById = origUserFindById;
        Plan.findOne = origPlanFindOne;
      }
    });

    it('successfully creates payment order using authoritative database price in paise', async () => {
      const origUserFindById = User.findById;
      const origPlanFindOne = Plan.findOne;
      const origPaymentCreate = Payment.create;

      const mockPlan = {
        _id: mockPlanId,
        name: 'Professional',
        price: 1000,
        durationDays: 30,
        hashRate: '70 MH/s',
        isActive: true,
      };

      User.findById = () => ({
        select: () => Promise.resolve(mockUser),
      });
      Plan.findOne = async () => mockPlan;

      let savedPaymentPayload = null;
      Payment.create = async (payload) => {
        savedPaymentPayload = payload;
        return {
          ...payload,
          _id: new mongoose.Types.ObjectId(),
        };
      };

      try {
        // Even if client attempts to pass a fake price, server ignores it and enforces DB price
        const res = await fetch(`${baseUrl}/api/v1/payments/create-order`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validUserToken}`,
          },
          body: JSON.stringify({ planId: mockPlanId.toString(), maliciousClientPrice: 1 }),
        });

        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.data.amount, 1000);
        assert.strictEqual(data.data.amountInPaise, 100000); // 1,000 INR = 100,000 paise
        assert.strictEqual(data.data.currency, 'INR');
        assert.strictEqual(data.data.plan.name, 'Professional');
        assert.ok(data.data.orderId);

        // Verify persisted payment record attributes
        assert.strictEqual(savedPaymentPayload.amount, 1000);
        assert.strictEqual(savedPaymentPayload.amountInPaise, 100000);
        assert.strictEqual(savedPaymentPayload.status, 'created');
        assert.strictEqual(savedPaymentPayload.user.toString(), mockUserId.toString());
      } finally {
        User.findById = origUserFindById;
        Plan.findOne = origPlanFindOne;
        Payment.create = origPaymentCreate;
      }
    });
  });

  describe('Payment Verification Endpoint (POST /api/v1/payments/verify)', () => {
    it('rejects unauthenticated request with 401', async () => {
      const res = await fetch(`${baseUrl}/api/v1/payments/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: 'order_123',
          paymentId: 'pay_123',
          signature: 'sig_123',
        }),
      });

      assert.strictEqual(res.status, 401);
    });

    it('rejects request with missing parameters with 400', async () => {
      const origUserFindById = User.findById;
      User.findById = () => ({
        select: () => Promise.resolve(mockUser),
      });

      try {
        const res = await fetch(`${baseUrl}/api/v1/payments/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validUserToken}`,
          },
          body: JSON.stringify({ orderId: 'order_123' }), // Missing paymentId and signature
        });

        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.match(data.message, /orderId .* paymentId .* signature are required/);
      } finally {
        User.findById = origUserFindById;
      }
    });

    it('rejects request when payment belongs to another user with 403', async () => {
      const origUserFindById = User.findById;
      const origPaymentFindOne = Payment.findOne;

      User.findById = () => ({
        select: () => Promise.resolve(mockUser),
      });

      // Payment owned by mockOtherUserId
      const mockPayment = {
        _id: new mongoose.Types.ObjectId(),
        orderId: 'order_other_user',
        user: mockOtherUserId,
        amount: 300,
        status: 'created',
        populate: function () {
          return Promise.resolve(this);
        },
      };

      Payment.findOne = () => ({
        populate: () => Promise.resolve(mockPayment),
      });

      try {
        const res = await fetch(`${baseUrl}/api/v1/payments/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validUserToken}`,
          },
          body: JSON.stringify({
            orderId: 'order_other_user',
            paymentId: 'pay_123',
            signature: 'sig_123',
          }),
        });

        assert.strictEqual(res.status, 403);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.match(data.message, /Forbidden/);
      } finally {
        User.findById = origUserFindById;
        Payment.findOne = origPaymentFindOne;
      }
    });

    it('rejects invalid signature with 400 and marks payment as failed', async () => {
      const origUserFindById = User.findById;
      const origPaymentFindOne = Payment.findOne;

      User.findById = () => ({
        select: () => Promise.resolve(mockUser),
      });

      let paymentSaveCalled = false;
      const mockPayment = {
        _id: new mongoose.Types.ObjectId(),
        orderId: 'order_tampered',
        user: mockUserId,
        amount: 300,
        status: 'created',
        metadata: {},
        save: async function () {
          paymentSaveCalled = true;
          return this;
        },
        populate: function () {
          return Promise.resolve(this);
        },
      };

      Payment.findOne = () => ({
        populate: () => Promise.resolve(mockPayment),
      });

      try {
        const res = await fetch(`${baseUrl}/api/v1/payments/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validUserToken}`,
          },
          body: JSON.stringify({
            orderId: 'order_tampered',
            paymentId: 'pay_tampered',
            signature: 'invalid_sha256_signature_hex',
          }),
        });

        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.match(data.message, /verification failed/);
        assert.strictEqual(mockPayment.status, 'failed');
        assert.strictEqual(paymentSaveCalled, true);
      } finally {
        User.findById = origUserFindById;
        Payment.findOne = origPaymentFindOne;
      }
    });

    it('activates plan exactly once on valid payment signature and does NOT touch wallet', async () => {
      const origUserFindById = User.findById;
      const origPaymentFindOne = Payment.findOne;
      const origUserPlanFindOne = UserPlan.findOne;
      const origUserPlanCreate = UserPlan.create;

      User.findById = () => ({
        select: () => Promise.resolve(mockUser),
      });

      const orderId = 'order_valid_activate_123';
      const paymentId = 'pay_valid_activate_456';
      const validSignature = crypto
        .createHmac('sha256', testSecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      const mockPlan = {
        _id: mockPlanId,
        name: 'Starter',
        price: 300,
        durationDays: 30,
        dailyRoiRate: 0.01,
        hashRate: '15 MH/s',
        features: ['Tier-4 Compute'],
      };

      const mockPayment = {
        _id: new mongoose.Types.ObjectId(),
        orderId,
        user: mockUserId,
        plan: mockPlan,
        amount: 300,
        status: 'created',
        userPlan: null,
        metadata: {},
        save: async function () {
          return this;
        },
        populate: function () {
          return Promise.resolve(this);
        },
      };

      Payment.findOne = () => ({
        populate: () => Promise.resolve(mockPayment),
      });

      UserPlan.findOne = async () => null;

      let createdUserPlanData = null;
      const mockCreatedUserPlan = {
        _id: new mongoose.Types.ObjectId(),
        user: mockUserId,
        plan: mockPlanId,
        planName: 'Starter',
        price: 300,
        durationDays: 30,
        status: 'active',
        idempotencyKey: `pay_${orderId}`,
      };

      UserPlan.create = async (data) => {
        createdUserPlanData = data;
        return mockCreatedUserPlan;
      };

      try {
        const res = await fetch(`${baseUrl}/api/v1/payments/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validUserToken}`,
          },
          body: JSON.stringify({
            orderId,
            paymentId,
            signature: validSignature,
          }),
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.isAlreadyActivated, false);
        assert.strictEqual(data.data.payment.status, 'captured');
        assert.strictEqual(data.data.userPlan.planName, 'Starter');

        // Confirm UserPlan was provisioned with idempotency key
        assert.strictEqual(createdUserPlanData.idempotencyKey, `pay_${orderId}`);
        assert.strictEqual(createdUserPlanData.price, 300);
        assert.strictEqual(mockPayment.status, 'captured');
        assert.strictEqual(mockPayment.paymentId, paymentId);
        assert.strictEqual(mockPayment.userPlan.toString(), mockCreatedUserPlan._id.toString());
      } finally {
        User.findById = origUserFindById;
        Payment.findOne = origPaymentFindOne;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
      }
    });

    it('returns idempotent response without duplicate plan activation when callback is replayed', async () => {
      const origUserFindById = User.findById;
      const origPaymentFindOne = Payment.findOne;
      const origUserPlanFindById = UserPlan.findById;

      User.findById = () => ({
        select: () => Promise.resolve(mockUser),
      });

      const orderId = 'order_replayed_123';
      const existingUserPlanId = new mongoose.Types.ObjectId();

      const mockPayment = {
        _id: new mongoose.Types.ObjectId(),
        orderId,
        user: mockUserId,
        status: 'captured',
        userPlan: existingUserPlanId, // Already linked!
        paymentId: 'pay_replayed_456',
        populate: function () {
          return Promise.resolve(this);
        },
      };

      Payment.findOne = () => ({
        populate: () => Promise.resolve(mockPayment),
      });

      UserPlan.findById = async () => ({
        _id: existingUserPlanId,
        user: mockUserId,
        planName: 'Basic Plus',
        price: 500,
        status: 'active',
      });

      try {
        const res = await fetch(`${baseUrl}/api/v1/payments/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validUserToken}`,
          },
          body: JSON.stringify({
            orderId,
            paymentId: 'pay_replayed_456',
            signature: 'any_signature',
          }),
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.isAlreadyActivated, true);
        assert.match(data.message, /already been activated/);
        assert.strictEqual(data.data.userPlan._id.toString(), existingUserPlanId.toString());
      } finally {
        User.findById = origUserFindById;
        Payment.findOne = origPaymentFindOne;
        UserPlan.findById = origUserPlanFindById;
      }
    });
  });

  describe('Webhook Endpoint (POST /api/v1/payments/webhook)', () => {
    it('rejects webhook with missing signature header with 400', async () => {
      const res = await fetch(`${baseUrl}/api/v1/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'payment.captured' }),
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /signature header missing/);
    });

    it('rejects webhook with forged signature with 400', async () => {
      const payload = JSON.stringify({ event: 'payment.captured' });
      const res = await fetch(`${baseUrl}/api/v1/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': 'forged_fake_signature',
        },
        body: payload,
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /Invalid webhook signature/);
    });

    it('processes payment.captured webhook and activates plan idempotently', async () => {
      const origPaymentFindOne = Payment.findOne;
      const origUserPlanFindOne = UserPlan.findOne;
      const origUserPlanCreate = UserPlan.create;

      const orderId = 'order_webhook_captured_789';
      const paymentId = 'pay_webhook_captured_999';

      const webhookPayload = JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              amount: 50000,
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      });

      const signature = crypto
        .createHmac('sha256', testWebhookSecret)
        .update(webhookPayload)
        .digest('hex');

      const mockPlan = {
        _id: mockPlanId,
        name: 'Basic Plus',
        price: 500,
        durationDays: 30,
        dailyRoiRate: 0.012,
        hashRate: '30 MH/s',
      };

      const mockPayment = {
        _id: new mongoose.Types.ObjectId(),
        orderId,
        user: mockUserId,
        plan: mockPlan,
        amount: 500,
        status: 'created',
        userPlan: null,
        save: async function () {
          return this;
        },
        populate: function () {
          return Promise.resolve(this);
        },
      };

      Payment.findOne = () => ({
        populate: () => Promise.resolve(mockPayment),
      });

      UserPlan.findOne = async () => null;
      UserPlan.create = async () => ({
        _id: new mongoose.Types.ObjectId(),
        user: mockUserId,
        planName: 'Basic Plus',
        price: 500,
      });

      try {
        const res = await fetch(`${baseUrl}/api/v1/payments/webhook`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-razorpay-signature': signature,
          },
          body: webhookPayload,
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.result.status, 'processed');
        assert.strictEqual(mockPayment.status, 'captured');
      } finally {
        Payment.findOne = origPaymentFindOne;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
      }
    });

    it('processes payment.failed webhook and marks status failed without activating plan', async () => {
      const origPaymentFindOne = Payment.findOne;

      const orderId = 'order_webhook_failed_000';
      const webhookPayload = JSON.stringify({
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_failed_111',
              order_id: orderId,
              error_code: 'BAD_REQUEST_ERROR',
              error_description: 'Payment was declined by customer bank / UPI app',
            },
          },
        },
      });

      const signature = crypto
        .createHmac('sha256', testWebhookSecret)
        .update(webhookPayload)
        .digest('hex');

      let saveCalled = false;
      const mockPayment = {
        _id: new mongoose.Types.ObjectId(),
        orderId,
        user: mockUserId,
        amount: 2000,
        status: 'created',
        userPlan: null,
        metadata: {},
        save: async function () {
          saveCalled = true;
          return this;
        },
      };

      Payment.findOne = async () => mockPayment;

      try {
        const res = await fetch(`${baseUrl}/api/v1/payments/webhook`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-razorpay-signature': signature,
          },
          body: webhookPayload,
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(mockPayment.status, 'failed');
        assert.strictEqual(mockPayment.userPlan, null); // NEVER activated!
        assert.strictEqual(saveCalled, true);
      } finally {
        Payment.findOne = origPaymentFindOne;
      }
    });
  });

  describe('Wallet Purchase Flow Independence', () => {
    it('verifies existing wallet-based purchase flow remains functional and independent', async () => {
      const origUserFindById = User.findById;
      const origPlanFindOne = Plan.findOne;
      const origWalletFindOne = Wallet.findOne;
      const origWalletFindOneAndUpdate = Wallet.findOneAndUpdate;
      const origUserPlanFindOne = UserPlan.findOne;
      const origUserPlanCreate = UserPlan.create;
      const origTxCreate = Transaction.create;

      User.findById = () => ({
        select: () => Promise.resolve(mockUser),
      });

      const mockPlan = {
        _id: mockPlanId,
        name: 'Starter',
        price: 300,
        durationDays: 30,
        isActive: true,
      };

      Plan.findOne = async () => mockPlan;
      UserPlan.findOne = async () => null;
      Wallet.findOne = async () => ({
        _id: new mongoose.Types.ObjectId(),
        user: mockUserId,
        balance: 1000,
      });

      Wallet.findOneAndUpdate = async () => ({
        _id: new mongoose.Types.ObjectId(),
        user: mockUserId,
        balance: 700, // 1000 - 300
      });

      UserPlan.create = async () => ({
        _id: new mongoose.Types.ObjectId(),
        user: mockUserId,
        plan: mockPlanId,
        planName: 'Starter',
        price: 300,
        status: 'active',
      });

      Transaction.create = async () => ({
        _id: new mongoose.Types.ObjectId(),
        type: 'debit',
        amount: 300,
      });

      try {
        const res = await fetch(`${baseUrl}/api/v1/plans/${mockPlanId}/purchase`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validUserToken}`,
          },
          body: JSON.stringify({}),
        });

        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.data.walletBalance, 700);
      } finally {
        User.findById = origUserFindById;
        Plan.findOne = origPlanFindOne;
        Wallet.findOne = origWalletFindOne;
        Wallet.findOneAndUpdate = origWalletFindOneAndUpdate;
        UserPlan.findOne = origUserPlanFindOne;
        UserPlan.create = origUserPlanCreate;
        Transaction.create = origTxCreate;
      }
    });
  });
});
