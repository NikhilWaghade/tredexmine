import mongoose from 'mongoose';
import { Plan } from '../models/Plan.js';
import { UserPlan } from '../models/UserPlan.js';
import { Payment } from '../models/Payment.js';
import {
  getRazorpayInstance,
  isRazorpayConfigured,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from '../config/razorpay.js';

/**
 * Payment Service - Secure Server-Side Razorpay UPI Integration
 */

/**
 * Create a new payment order for a specific plan
 * Authoritative plan price is retrieved strictly from MongoDB.
 *
 * @param {string|mongoose.Types.ObjectId} userId - Authenticated user ID
 * @param {string|mongoose.Types.ObjectId} planId - MongoDB Plan ID
 * @returns {Promise<Object>} Gateway order details and public configuration
 */
export const createPaymentOrder = async (userId, planId) => {
  // 1. Validate plan ID format
  if (!mongoose.Types.ObjectId.isValid(planId)) {
    const error = new Error('Invalid plan ID format');
    error.statusCode = 400;
    throw error;
  }

  // 2. Fetch authoritative active plan from MongoDB (never trust client-supplied amounts)
  const plan = await Plan.findOne({ _id: planId, isActive: true });
  if (!plan) {
    const error = new Error('Plan not found or is currently inactive');
    error.statusCode = 404;
    throw error;
  }

  // 3. Convert INR price to paise accurately (1 INR = 100 paise)
  const amountInPaise = Math.round(plan.price * 100);
  const receipt = `rcpt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // 4. Create gateway order via Razorpay API (or test simulation if in sandbox/offline test mode)
  let gatewayOrderId;
  const razorpay = getRazorpayInstance();

  if (razorpay && isRazorpayConfigured()) {
    try {
      const rzpOrder = await razorpay.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt,
        notes: {
          userId: userId.toString(),
          planId: plan._id.toString(),
          planName: plan.name,
        },
      });
      gatewayOrderId = rzpOrder.id;
    } catch (gatewayError) {
      console.error('[PaymentService] Razorpay order creation failed:', gatewayError.message);
      const error = new Error(`Payment gateway order creation failed: ${gatewayError.message}`);
      error.statusCode = 502;
      throw error;
    }
  } else {
    // Sandbox / Test fallback when actual credentials are placeholders
    gatewayOrderId = `order_test_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  // 5. Persist payment audit record with status 'created'
  const payment = await Payment.create({
    user: userId,
    plan: plan._id,
    gateway: 'razorpay',
    orderId: gatewayOrderId,
    amount: plan.price,
    amountInPaise,
    currency: 'INR',
    receipt,
    status: 'created',
    paymentMethod: 'upi',
    metadata: {
      notes: {
        userId: userId.toString(),
        planId: plan._id.toString(),
        planName: plan.name,
      },
    },
  });

  return {
    orderId: payment.orderId,
    amount: payment.amount,
    amountInPaise: payment.amountInPaise,
    currency: payment.currency,
    keyId: process.env.RAZORPAY_KEY_ID || '',
    plan: {
      id: plan._id,
      name: plan.name,
      price: plan.price,
      durationDays: plan.durationDays,
      hashRate: plan.hashRate,
    },
  };
};

/**
 * Verify payment signature and activate the subscribed plan exactly once
 *
 * @param {string|mongoose.Types.ObjectId} userId - Authenticated user ID
 * @param {Object} verificationData
 * @param {string} verificationData.orderId - Gateway order ID
 * @param {string} verificationData.paymentId - Gateway payment ID
 * @param {string} verificationData.signature - HMAC SHA-256 signature from checkout
 * @returns {Promise<Object>} Verification outcome and activated UserPlan
 */
export const verifyPayment = async (userId, { orderId, paymentId, signature }) => {
  // 1. Validate required payload parameters
  if (!orderId || !paymentId || !signature) {
    const error = new Error('Missing required payment verification parameters: orderId, paymentId, and signature are required');
    error.statusCode = 400;
    throw error;
  }

  // 2. Fetch existing Payment record
  const payment = await Payment.findOne({ orderId }).populate('plan');
  if (!payment) {
    const error = new Error('Payment order not found');
    error.statusCode = 404;
    throw error;
  }

  // 3. Verify user ownership
  if (payment.user.toString() !== userId.toString()) {
    const error = new Error('Forbidden: Payment does not belong to the authenticated user');
    error.statusCode = 403;
    throw error;
  }

  // 4. Idempotency safeguard: if plan is already activated, return immediately without duplicate provisioning
  if (payment.userPlan) {
    const existingUserPlan = await UserPlan.findById(payment.userPlan);
    return {
      success: true,
      isAlreadyActivated: true,
      message: 'Plan has already been activated for this payment',
      userPlan: existingUserPlan,
      payment: {
        orderId: payment.orderId,
        paymentId: payment.paymentId,
        status: payment.status,
      },
    };
  }

  // 5. Cryptographically verify payment signature
  const isSignatureValid = verifyPaymentSignature({ orderId, paymentId, signature });
  if (!isSignatureValid) {
    payment.status = 'failed';
    payment.metadata = {
      ...payment.metadata,
      failureReason: 'Invalid cryptographic signature',
      failedAt: new Date(),
    };
    await payment.save();

    const error = new Error('Invalid payment signature: verification failed');
    error.statusCode = 400;
    throw error;
  }

  // 6. Activate the plan atomically
  return activatePlanForPayment(payment, paymentId, signature);
};

/**
 * Internal helper to activate UserPlan for a verified payment record
 * Ensures exactly-once activation using unique idempotency key
 *
 * @param {Payment} payment
 * @param {string} paymentId
 * @param {string} signature
 * @returns {Promise<Object>}
 */
export const activatePlanForPayment = async (payment, paymentId, signature = '') => {
  // Check if plan has already been activated
  if (payment.userPlan) {
    const existingUserPlan = await UserPlan.findById(payment.userPlan);
    return {
      success: true,
      isAlreadyActivated: true,
      message: 'Plan already activated',
      userPlan: existingUserPlan,
      payment: {
        orderId: payment.orderId,
        paymentId: payment.paymentId,
        status: payment.status,
      },
    };
  }

  // Ensure plan object is loaded
  let plan = payment.plan;
  if (!plan || !plan.durationDays) {
    plan = await Plan.findById(payment.plan);
    if (!plan) {
      const error = new Error('Associated plan could not be located in database');
      error.statusCode = 500;
      throw error;
    }
  }

  // Calculate subscription timeframe
  const startDate = new Date();
  const durationMs = plan.durationDays * 24 * 60 * 60 * 1000;
  const endDate = new Date(startDate.getTime() + durationMs);

  // Idempotency key scoped to payment order
  const idempotencyKey = `pay_${payment.orderId}`;

  // Check if UserPlan with this idempotency key already exists
  let userPlan = await UserPlan.findOne({ user: payment.user, idempotencyKey });

  if (!userPlan) {
    userPlan = await UserPlan.create({
      user: payment.user,
      plan: plan._id,
      planName: plan.name,
      price: plan.price,
      durationDays: plan.durationDays,
      dailyRoiRate: plan.dailyRoiRate,
      hashRate: plan.hashRate,
      features: plan.features,
      startDate,
      endDate,
      status: 'active',
      idempotencyKey,
    });
  }

  // Update payment record with captured status and linked UserPlan
  payment.paymentId = paymentId || payment.paymentId;
  if (signature) {
    payment.signature = signature;
  }
  payment.status = 'captured';
  payment.userPlan = userPlan._id;
  payment.activatedAt = new Date();
  await payment.save();

  return {
    success: true,
    isAlreadyActivated: false,
    message: 'Plan activated successfully',
    userPlan,
    payment: {
      orderId: payment.orderId,
      paymentId: payment.paymentId,
      status: payment.status,
    },
  };
};

/**
 * Handle asynchronous webhook events from Razorpay
 * Verifies raw request body signature and processes captured/failed events idempotently.
 *
 * @param {Buffer|string} rawBody - Raw body buffer
 * @param {string} signature - Header 'x-razorpay-signature'
 * @param {Object} event - Parsed JSON webhook payload
 * @returns {Promise<Object>}
 */
export const handleWebhookEvent = async (rawBody, signature, event) => {
  // 1. Verify webhook signature
  const isSignatureValid = verifyWebhookSignature({ rawBody, signature });
  if (!isSignatureValid) {
    const error = new Error('Invalid webhook signature');
    error.statusCode = 400;
    throw error;
  }

  const eventType = event?.event;

  // 2. Handle successful payment captured event
  if (eventType === 'payment.captured' || eventType === 'order.paid') {
    const paymentEntity = event?.payload?.payment?.entity;
    const orderEntity = event?.payload?.order?.entity;

    const orderId = paymentEntity?.order_id || orderEntity?.id;
    const paymentId = paymentEntity?.id;

    if (!orderId) {
      return { status: 'ignored', reason: 'Order ID absent in webhook event' };
    }

    const payment = await Payment.findOne({ orderId }).populate('plan');
    if (!payment) {
      return { status: 'ignored', reason: `Payment record not found for order ${orderId}` };
    }

    if (payment.userPlan) {
      return { status: 'already_processed', orderId };
    }

    await activatePlanForPayment(payment, paymentId, '');
    return { status: 'processed', orderId, eventType };
  }

  // 3. Handle payment failure event
  if (eventType === 'payment.failed') {
    const paymentEntity = event?.payload?.payment?.entity;
    const orderId = paymentEntity?.order_id;

    if (orderId) {
      const payment = await Payment.findOne({ orderId });
      if (payment && payment.status !== 'captured') {
        payment.status = 'failed';
        payment.metadata = {
          ...payment.metadata,
          errorCode: paymentEntity?.error_code,
          errorDescription: paymentEntity?.error_description,
          failedAt: new Date(),
        };
        await payment.save();
      }
    }
    return { status: 'processed', eventType };
  }

  return { status: 'ignored', reason: `Unhandled event type: ${eventType}` };
};

/**
 * Get payment order status and details by order ID
 *
 * @param {string} orderId
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<Payment>}
 */
export const getPaymentStatus = async (orderId, userId) => {
  const payment = await Payment.findOne({ orderId, user: userId })
    .populate('plan')
    .populate('userPlan');

  if (!payment) {
    const error = new Error('Payment record not found');
    error.statusCode = 404;
    throw error;
  }

  return payment;
};

/**
 * Fetch public payment configuration
 * @returns {Object} Public configuration (Public Key ID only, never secret)
 */
export const getPaymentConfig = () => {
  return {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    currency: 'INR',
    isSandbox: !process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_'),
  };
};

export default {
  createPaymentOrder,
  verifyPayment,
  activatePlanForPayment,
  handleWebhookEvent,
  getPaymentStatus,
  getPaymentConfig,
};
