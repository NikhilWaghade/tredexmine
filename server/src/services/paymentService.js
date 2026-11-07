import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Plan } from '../models/Plan.js';
import { UserPlan } from '../models/UserPlan.js';
import { Payment } from '../models/Payment.js';
import { Deposit } from '../models/Deposit.js';
import { Transaction } from '../models/Transaction.js';
import { WebhookEvent } from '../models/WebhookEvent.js';
import { processDepositCredit, reconcileDepositRecord } from './walletService.js';
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
  // 1. Enforce gateway configuration gating before any processing or DB mutations
  if (!isRazorpayConfigured()) {
    const error = new Error('Payment gateway is currently unconfigured or disabled');
    error.statusCode = 503;
    throw error;
  }

  const razorpay = getRazorpayInstance();
  if (!razorpay) {
    const error = new Error('Payment gateway client could not be initialized');
    error.statusCode = 503;
    throw error;
  }

  // 2. Validate plan ID format
  if (!mongoose.Types.ObjectId.isValid(planId)) {
    const error = new Error('Invalid plan ID format');
    error.statusCode = 400;
    throw error;
  }

  // 3. Fetch authoritative active plan from MongoDB (never trust client-supplied amounts)
  const plan = await Plan.findOne({ _id: planId, isActive: true });
  if (!plan) {
    const error = new Error('Plan not found or is currently inactive');
    error.statusCode = 404;
    throw error;
  }

  // 4. Convert INR price to paise accurately (1 INR = 100 paise)
  const amountInPaise = Math.round(plan.price * 100);
  const receipt = `rcpt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // 5. Create gateway order via Razorpay API
  let gatewayOrderId;
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

  // 6. Persist payment audit record with status 'created' ONLY after successful gateway order creation
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
    keyId: isRazorpayConfigured() && process.env.RAZORPAY_KEY_ID ? String(process.env.RAZORPAY_KEY_ID).trim() : '',
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
export const activatePlanForPayment = async (payment, paymentId, signature = '', options = {}) => {
  const session = options.session || null;
  const sessionOpt = session ? { session } : {};

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
  const upQuery = UserPlan.findOne({ user: payment.user, idempotencyKey });
  let userPlan = session && typeof upQuery?.session === 'function' ? await upQuery.session(session) : await upQuery;

  if (!userPlan) {
    try {
      const planPayload = {
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
      };
      if (session) {
        const created = await UserPlan.create([planPayload], { session });
        userPlan = Array.isArray(created) ? created[0] : created;
      } else {
        userPlan = await UserPlan.create(planPayload);
      }
    } catch (createErr) {
      if (createErr.code === 11000 || String(createErr.message).includes('E11000')) {
        const upQuery2 = UserPlan.findOne({ user: payment.user, idempotencyKey });
        userPlan = session && typeof upQuery2?.session === 'function' ? await upQuery2.session(session) : await upQuery2;
      } else {
        throw createErr;
      }
    }
  }

  // Update payment record with captured status and linked UserPlan
  payment.paymentId = paymentId || payment.paymentId;
  if (signature) {
    payment.signature = signature;
  }
  payment.status = 'captured';
  payment.userPlan = userPlan._id;
  payment.activatedAt = new Date();
  if (typeof payment.save === 'function') {
    await payment.save(sessionOpt);
  }

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
 * Handle asynchronous webhook events from Razorpay with persistent event deduplication
 * Verifies raw request body signature and processes captured/failed events idempotently.
 *
 * @param {Buffer|string} rawBody - Raw body buffer
 * @param {string} signature - Header 'x-razorpay-signature'
 * @param {Object} event - Parsed JSON webhook payload
 * @param {Object} [options] - Optional context, provider name, and incoming headers
 * @returns {Promise<Object>}
 */
export const handleWebhookEvent = async (rawBody, signature, event, options = {}) => {
  // 1. Verify webhook signature against raw request body before trusting event contents
  const isSignatureValid = verifyWebhookSignature({ rawBody, signature });
  if (!isSignatureValid) {
    const error = new Error('Invalid webhook signature');
    error.statusCode = 400;
    throw error;
  }

  const provider = options.provider || 'razorpay';
  const eventType = event?.event;

  const paymentEntity = event?.payload?.payment?.entity;
  const orderEntity = event?.payload?.order?.entity;

  const orderId = paymentEntity?.order_id || orderEntity?.id;
  const paymentId = paymentEntity?.id;

  // Resolve unique provider event ID:
  // Checked in precedence:
  // 1. Explicit options.eventId or header 'x-razorpay-event-id'
  // 2. event.event_id or event.id
  // 3. Fallback: deterministic SHA-256 hash of rawBody
  const rawEventId =
    options.eventId ||
    (options.headers && (options.headers['x-razorpay-event-id'] || options.headers['X-Razorpay-Event-Id'])) ||
    event?.event_id ||
    event?.id;

  const eventId = rawEventId
    ? String(rawEventId).trim()
    : crypto.createHash('sha256').update(rawBody || '').digest('hex');

  // 2. Persistent Event Deduplication Registry: Atomic Claim Lock
  const STALE_PROCESSING_TIMEOUT_MS = 60 * 1000; // 60-second recovery threshold

  let isClaimed = false;
  let eventDoc = null;

  // Attempt atomic insert claim in WebhookEvent collection
  try {
    eventDoc = await WebhookEvent.create({
      provider,
      eventId,
      eventType: eventType || 'unknown',
      status: 'processing',
      orderId: orderId || '',
      paymentId: paymentId || '',
      attempts: 1,
      firstReceivedAt: new Date(),
      lastReceivedAt: new Date(),
      metadata: {
        currency: paymentEntity?.currency || orderEntity?.currency,
        amount: paymentEntity?.amount ?? orderEntity?.amount,
      },
    });
    isClaimed = true;
  } catch (err) {
    // E11000 duplicate key error: another concurrent or earlier delivery already created this event record
    if (err.code === 11000 || err.name === 'MongoServerError' || String(err.message).includes('E11000')) {
      isClaimed = false;
    } else {
      // Genuine database registry failure: fail closed safely
      throw err;
    }
  }

  // If duplicate insert race, inspect existing record state
  if (!isClaimed) {
    const existingEvent = await WebhookEvent.findOne({ provider, eventId });

    if (existingEvent) {
      if (existingEvent.status === 'processed') {
        // Already durably processed: acknowledge immediately without re-applying business effects
        return {
          status: 'already_processed',
          eventId,
          orderId: existingEvent.orderId || orderId,
          eventType,
          type: existingEvent.resourceType,
          depositReference: existingEvent.resourceReference,
          message: 'Webhook event has already been processed',
        };
      }

      if (existingEvent.status === 'processing') {
        const elapsedMs = Date.now() - new Date(existingEvent.lastReceivedAt || existingEvent.createdAt).getTime();
        if (elapsedMs < STALE_PROCESSING_TIMEOUT_MS) {
          // Concurrently active in another worker: return retryable in-flight response
          return {
            status: 'in_flight',
            eventId,
            orderId: existingEvent.orderId || orderId,
            eventType,
            retryable: true,
            message: 'Webhook event is currently in-flight in another worker; retry later',
          };
        }

        // Bounded CAS recovery for crash after event claim but before completion
        const reclaimed = await WebhookEvent.findOneAndUpdate(
          {
            provider,
            eventId,
            status: 'processing',
            lastReceivedAt: existingEvent.lastReceivedAt,
          },
          {
            $set: { lastReceivedAt: new Date() },
            $inc: { attempts: 1 },
          },
          { new: true }
        );

        if (!reclaimed) {
          return {
            status: 'in_flight',
            eventId,
            orderId: existingEvent.orderId || orderId,
            eventType,
            retryable: true,
            message: 'Webhook event recovery claim won by concurrent worker',
          };
        }
        eventDoc = reclaimed;
        isClaimed = true;
      } else if (existingEvent.status === 'failed') {
        // Safe retry of previously failed event: atomic transition failed -> processing
        const retryClaim = await WebhookEvent.findOneAndUpdate(
          {
            provider,
            eventId,
            status: 'failed',
          },
          {
            $set: {
              status: 'processing',
              lastReceivedAt: new Date(),
            },
            $inc: { attempts: 1 },
          },
          { new: true }
        );

        if (!retryClaim) {
          return {
            status: 'in_flight',
            eventId,
            orderId: existingEvent.orderId || orderId,
            eventType,
            retryable: true,
            message: 'Webhook event retry claim won by concurrent worker',
          };
        }
        eventDoc = retryClaim;
        isClaimed = true;
      } else if (existingEvent.status === 'quarantined') {
        return {
          status: 'quarantined',
          eventId,
          orderId: existingEvent.orderId || orderId,
          eventType,
          message: 'Webhook event is quarantined for manual administrative reconciliation',
        };
      }
    }
  }

  // 3. Business Processing with State Finalization
  try {
    let result = null;

    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      if (!orderId) {
        if (eventId) {
          await WebhookEvent.updateOne(
            { provider, eventId },
            {
              $set: {
                status: 'processed',
                processedAt: new Date(),
                lastErrorCategory: 'ORDER_ID_ABSENT',
              },
            }
          );
        }
        return { status: 'ignored', reason: 'Order ID absent in webhook event' };
      }

      // A. Check for Plan Purchase record (Payment model)
      const paymentQuery = Payment.findOne({ orderId });
      const payment =
        typeof paymentQuery?.populate === 'function'
          ? await paymentQuery.populate('plan')
          : await paymentQuery;
      if (payment) {
        // Plan purchases must NEVER credit a wallet
        if (payment.userPlan) {
          result = { status: 'already_processed', orderId, eventType, type: 'plan_purchase' };
        } else {
          await activatePlanForPayment(payment, paymentId, '');
          result = { status: 'processed', orderId, eventType, type: 'plan_purchase' };
        }

        if (eventId) {
          await WebhookEvent.updateOne(
            { provider, eventId },
            {
              $set: {
                status: 'processed',
                processedAt: new Date(),
                resourceType: 'plan_purchase',
                resourceReference: payment.orderId,
                orderId: payment.orderId,
                paymentId: paymentId || '',
              },
            }
          );
        }
        return result;
      }

      // B. Check for Wallet Deposit record (Deposit model)
      const deposit = await Deposit.findOne({ orderId });
      if (deposit) {
        // Wallet deposits must NEVER activate a plan or touch UserPlan

        // Idempotency: if already completed, check if transaction ledger entry exists
        if (deposit.status === 'completed') {
          const existingTx = await Transaction.findOne({ reference: deposit.depositReference });
          if (existingTx) {
            result = {
              status: 'already_processed',
              orderId,
              eventType,
              type: 'wallet_deposit',
              depositReference: deposit.depositReference,
            };
          } else {
            // Forward-recover missing ledger entry or credit uncredited wallet after previous failure
            let isNewlyCredited = false;
            try {
              const reconcileRes = await reconcileDepositRecord(deposit.depositReference);
              isNewlyCredited =
                reconcileRes?.status === 'recovered' &&
                String(reconcileRes?.message || '').includes('successfully completed');
            } catch (_) {}

            result = {
              status: isNewlyCredited ? 'processed' : 'already_processed',
              orderId,
              eventType,
              type: 'wallet_deposit',
              depositReference: deposit.depositReference,
            };
          }

          if (eventId) {
            await WebhookEvent.updateOne(
              { provider, eventId },
              {
                $set: {
                  status: 'processed',
                  processedAt: new Date(),
                  resourceType: 'wallet_deposit',
                  resourceReference: deposit.depositReference,
                  orderId,
                  paymentId: paymentId || '',
                },
              }
            );
          }
          return result;
        }

        // Validate currency
        const eventCurrency = String(paymentEntity?.currency || orderEntity?.currency || 'INR').toUpperCase();
        if (deposit.currency.toUpperCase() !== eventCurrency) {
          deposit.status = 'failed';
          deposit.failureReason = `Currency mismatch in webhook: expected ${deposit.currency}, received ${eventCurrency}`;
          await deposit.save();

          if (eventId) {
            await WebhookEvent.updateOne(
              { provider, eventId },
              {
                $set: {
                  status: 'failed',
                  failedAt: new Date(),
                  lastErrorCategory: 'CURRENCY_MISMATCH',
                  lastErrorMessage: deposit.failureReason,
                },
              }
            );
          }
          return {
            status: 'rejected',
            reason: 'Currency mismatch in webhook event',
            orderId,
          };
        }

        // Validate amount (Razorpay sends amount in paise)
        const eventAmountPaise = paymentEntity?.amount ?? orderEntity?.amount;
        const expectedAmountPaise = Math.round(deposit.amount * 100);
        if (
          eventAmountPaise !== undefined &&
          eventAmountPaise !== null &&
          Number(eventAmountPaise) !== expectedAmountPaise
        ) {
          deposit.status = 'failed';
          deposit.failureReason = `Amount mismatch in webhook: expected ${expectedAmountPaise} paise (${deposit.amount} INR), received ${eventAmountPaise} paise`;
          await deposit.save();

          if (eventId) {
            await WebhookEvent.updateOne(
              { provider, eventId },
              {
                $set: {
                  status: 'failed',
                  failedAt: new Date(),
                  lastErrorCategory: 'AMOUNT_MISMATCH',
                  lastErrorMessage: deposit.failureReason,
                },
              }
            );
          }
          return {
            status: 'rejected',
            reason: 'Amount mismatch in webhook event',
            orderId,
          };
        }

        // Validate user association if notes.userId is present
        const notesUserId = paymentEntity?.notes?.userId || orderEntity?.notes?.userId;
        if (notesUserId && notesUserId.toString() !== deposit.user.toString()) {
          deposit.status = 'failed';
          deposit.failureReason = 'User association mismatch in webhook notes';
          await deposit.save();

          if (eventId) {
            await WebhookEvent.updateOne(
              { provider, eventId },
              {
                $set: {
                  status: 'failed',
                  failedAt: new Date(),
                  lastErrorCategory: 'USER_MISMATCH',
                  lastErrorMessage: deposit.failureReason,
                },
              }
            );
          }
          return {
            status: 'rejected',
            reason: 'User mismatch in webhook event',
            orderId,
          };
        }

        // Execute atomic single-winner deposit credit
        const creditResult = await processDepositCredit({
          deposit,
          paymentId: paymentId || deposit.paymentId,
          effectiveOrderId: orderId,
        });

        if (eventId) {
          await WebhookEvent.updateOne(
            { provider, eventId },
            {
              $set: {
                status: 'processed',
                processedAt: new Date(),
                resourceType: 'wallet_deposit',
                resourceReference: deposit.depositReference,
                orderId,
                paymentId: paymentId || '',
              },
            }
          );
        }

        return {
          status: creditResult.isAlreadyVerified ? 'already_processed' : 'processed',
          orderId,
          eventType,
          type: 'wallet_deposit',
          depositReference: deposit.depositReference,
        };
      }

      if (eventId) {
        await WebhookEvent.updateOne(
          { provider, eventId },
          {
            $set: {
              status: 'failed',
              failedAt: new Date(),
              lastErrorCategory: 'ORDER_NOT_FOUND',
              lastErrorMessage: `Payment or deposit record not found for order ${orderId}; awaiting order persistence`,
            },
          }
        );
      }
      return {
        status: 'order_pending',
        orderId,
        eventType,
        retryable: true,
        reason: `Payment or deposit record not found for order ${orderId}`,
      };
    }

    // 4. Handle payment failure event
    if (eventType === 'payment.failed') {
      const paymentEntity = event?.payload?.payment?.entity;
      const orderId = paymentEntity?.order_id;

      if (orderId) {
        // Check Plan Purchase
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

          if (eventId) {
            await WebhookEvent.updateOne(
              { provider, eventId },
              {
                $set: {
                  status: 'processed',
                  processedAt: new Date(),
                  resourceType: 'plan_purchase',
                  resourceReference: payment.orderId,
                },
              }
            );
          }
          return { status: 'processed', orderId, eventType, type: 'plan_purchase' };
        }

        // Check Wallet Deposit
        const deposit = await Deposit.findOne({ orderId });
        if (deposit && deposit.status !== 'completed') {
          deposit.status = 'failed';
          deposit.failureReason = paymentEntity?.error_description || 'Payment failed at gateway';
          deposit.metadata = {
            ...deposit.metadata,
            errorCode: paymentEntity?.error_code,
            errorDescription: paymentEntity?.error_description,
            failedAt: new Date(),
          };
          await deposit.save();

          if (eventId) {
            await WebhookEvent.updateOne(
              { provider, eventId },
              {
                $set: {
                  status: 'processed',
                  processedAt: new Date(),
                  resourceType: 'wallet_deposit',
                  resourceReference: deposit.depositReference,
                },
              }
            );
          }
          return { status: 'processed', orderId, eventType, type: 'wallet_deposit' };
        }
      }

      if (eventId) {
        await WebhookEvent.updateOne(
          { provider, eventId },
          {
            $set: {
              status: 'processed',
              processedAt: new Date(),
            },
          }
        );
      }
      return { status: 'processed', eventType };
    }

    if (eventId) {
      await WebhookEvent.updateOne(
        { provider, eventId },
        {
          $set: {
            status: 'processed',
            processedAt: new Date(),
          },
        }
      );
    }
    return { status: 'ignored', reason: `Unhandled event type: ${eventType}` };
  } catch (err) {
    if (eventId) {
      try {
        await WebhookEvent.updateOne(
          { provider, eventId },
          {
            $set: {
              status: 'failed',
              failedAt: new Date(),
              lastErrorCategory: err.name || 'PROCESSING_ERROR',
              lastErrorMessage: err.message,
            },
          }
        );
      } catch (_) {}
    }
    throw err;
  }
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
 * Returns explicit isConfigured boolean and public Key ID (never secrets)
 * @returns {Object} Public configuration
 */
export const getPaymentConfig = () => {
  const isConfigured = isRazorpayConfigured();
  return {
    isConfigured,
    keyId: isConfigured && process.env.RAZORPAY_KEY_ID ? String(process.env.RAZORPAY_KEY_ID).trim() : '',
    currency: 'INR',
    isSandbox: Boolean(
      process.env.RAZORPAY_KEY_ID &&
        String(process.env.RAZORPAY_KEY_ID).trim().startsWith('rzp_test_')
    ),
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
