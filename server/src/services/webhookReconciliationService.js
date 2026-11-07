import mongoose from 'mongoose';
import { WebhookEvent } from '../models/WebhookEvent.js';
import { Deposit } from '../models/Deposit.js';
import { Payment } from '../models/Payment.js';
import { Transaction } from '../models/Transaction.js';
import { AuditLog } from '../models/AuditLog.js';
import { User } from '../models/User.js';
import { processDepositCredit, reconcileDepositRecord } from './walletService.js';
import { activatePlanForPayment } from './paymentService.js';
import { isTransactionSupported } from './planService.js';
import { dispatchQuarantineAlert } from '../utils/financialAlertService.js';

export const DUAL_REVIEW_THRESHOLD = 10000; // INR 10,000 threshold for mandatory second-admin approval

/**
 * ============================================================================
 * WEBHOOK STALE EVENT RECONCILIATION SERVICE
 * ============================================================================
 *
 * Implements bounded, concurrency-safe background recovery for in-flight
 * webhook events that were abandoned due to worker crashes, network timeouts,
 * or process restarts.
 *
 * Guarantees:
 * 1. Atomic Single-Claim: Workers race using atomic CAS on { _id, status: candidate.status, lastReceivedAt }
 *    ensuring exactly one worker recovers any given stale event (in either 'processing' or 'failed' state).
 * 2. Idempotent Business Mutations: Re-uses verified domain idempotency (Wallet.processedOperations,
 *    Transaction.reference uniqueness, and Payment.userPlan).
 * 3. Fail-Safe Quarantine: If safe recovery cannot be mathematically verified or if max retry
 *    attempts are exceeded, the event is quarantined and alerted for manual review without balance guessing.
 * 4. Zero Live Gateway Calls: Operates entirely against durable database state; no live payment
 *    provider API calls are executed during development or testing.
 * ============================================================================
 */

export const DEFAULT_STALE_TIMEOUT_MS = 60 * 1000; // 60 seconds
export const DEFAULT_BATCH_SIZE = 10;
export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_INTERVAL_MS = 30 * 1000; // 30 seconds

/**
 * Reconcile a single claimed stale WebhookEvent document
 *
 * @param {Object} eventDoc - Atomically claimed WebhookEvent document
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export const reconcileSingleStaleWebhookEvent = async (eventDoc, options = {}) => {
  const maxAttempts = options.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const session = options.session || null;
  const sessionOpt = session ? { session } : {};
  const { provider, eventId, eventType, orderId, paymentId } = eventDoc;

  try {
    // 1. Captured payment or paid order
    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      if (!orderId) {
        // Without orderId, safe business correlation is impossible; quarantine for manual review
        await WebhookEvent.updateOne(
          { _id: eventDoc._id },
          {
            $set: {
              status: 'quarantined',
              lastErrorCategory: 'ORDER_ID_ABSENT',
              lastErrorMessage: 'Cannot reconcile stale event: orderId is absent in claimed record',
              'metadata.requiresManualReview': true,
              'metadata.quarantinedAt': new Date(),
            },
          },
          sessionOpt
        );

        await dispatchQuarantineAlert({
          withdrawal: {
            _id: eventDoc._id,
            withdrawalReference: `WEBHOOK-${eventId}`,
            amount: eventDoc.metadata?.amount || 0,
            currency: eventDoc.metadata?.currency || 'INR',
            status: 'QUARANTINED',
            metadata: eventDoc.metadata,
          },
          reason: `Stale webhook event ${eventId} has no orderId and cannot be automatically reconciled`,
        });

        return { status: 'quarantined', reason: 'order_id_absent' };
      }

      // A. Check for Wallet Deposit
      const depositQuery = Deposit.findOne({ orderId });
      const deposit =
        session && typeof depositQuery?.session === 'function'
          ? await depositQuery.session(session)
          : await depositQuery;

      if (deposit) {
        if (deposit.status === 'completed') {
          // Verify ledger entry exists
          const existingTxQuery = Transaction.findOne({ reference: deposit.depositReference });
          const existingTx =
            session && typeof existingTxQuery?.session === 'function'
              ? await existingTxQuery.session(session)
              : await existingTxQuery;

          if (existingTx) {
            await WebhookEvent.updateOne(
              { _id: eventDoc._id },
              {
                $set: {
                  status: 'processed',
                  processedAt: new Date(),
                  resourceType: 'wallet_deposit',
                  resourceReference: deposit.depositReference,
                },
              },
              sessionOpt
            );
            return { status: 'processed', reason: 'deposit_already_completed' };
          }

          // Ledger missing after crash: safe forward-reconstruction
          const reconcileRes = await reconcileDepositRecord(deposit.depositReference);
          if (reconcileRes?.status === 'recovered' || reconcileRes?.status === 'consistent') {
            await WebhookEvent.updateOne(
              { _id: eventDoc._id },
              {
                $set: {
                  status: 'processed',
                  processedAt: new Date(),
                  resourceType: 'wallet_deposit',
                  resourceReference: deposit.depositReference,
                },
              },
              sessionOpt
            );
            return { status: 'processed', reason: 'deposit_ledger_reconstructed' };
          }

          // Indeterminate or quarantined ledger recovery
          await WebhookEvent.updateOne(
            { _id: eventDoc._id },
            {
              $set: {
                status: 'quarantined',
                lastErrorCategory: 'LEDGER_RECOVERY_UNCERTAIN',
                lastErrorMessage: reconcileRes?.message || 'Deposit ledger recovery requires manual audit',
                'metadata.requiresManualReview': true,
                'metadata.quarantinedAt': new Date(),
              },
            },
            sessionOpt
          );
          return { status: 'quarantined', reason: 'deposit_ledger_quarantined' };
        }

        if (deposit.status === 'created' || deposit.status === 'pending') {
          // Safe atomic single-winner credit via walletService with session propagation
          const creditResult = await processDepositCredit({
            deposit,
            paymentId: paymentId || deposit.paymentId,
            effectiveOrderId: orderId,
            session,
          });

          await WebhookEvent.updateOne(
            { _id: eventDoc._id },
            {
              $set: {
                status: 'processed',
                processedAt: new Date(),
                resourceType: 'wallet_deposit',
                resourceReference: deposit.depositReference,
              },
            },
            sessionOpt
          );

          return {
            status: 'processed',
            reason: creditResult.isAlreadyVerified ? 'deposit_already_verified' : 'deposit_credit_applied',
          };
        }

        if (deposit.status === 'failed') {
          await WebhookEvent.updateOne(
            { _id: eventDoc._id },
            {
              $set: {
                status: 'processed',
                processedAt: new Date(),
                resourceType: 'wallet_deposit',
                resourceReference: deposit.depositReference,
              },
            },
            sessionOpt
          );
          return { status: 'processed', reason: 'deposit_was_failed' };
        }
      }

      // B. Check for Plan Purchase
      const paymentQuery = Payment.findOne({ orderId });
      const populatedPaymentQuery =
        typeof paymentQuery?.populate === 'function' ? paymentQuery.populate('plan') : paymentQuery;
      const payment =
        session && typeof populatedPaymentQuery?.session === 'function'
          ? await populatedPaymentQuery.session(session)
          : await populatedPaymentQuery;

      if (payment) {
        if (payment.userPlan) {
          await WebhookEvent.updateOne(
            { _id: eventDoc._id },
            {
              $set: {
                status: 'processed',
                processedAt: new Date(),
                resourceType: 'plan_purchase',
                resourceReference: payment.orderId,
              },
            },
            sessionOpt
          );
          return { status: 'processed', reason: 'plan_already_active' };
        }

        await activatePlanForPayment(payment, paymentId || '', '', { session });
        await WebhookEvent.updateOne(
          { _id: eventDoc._id },
          {
            $set: {
              status: 'processed',
              processedAt: new Date(),
              resourceType: 'plan_purchase',
              resourceReference: payment.orderId,
            },
          },
          sessionOpt
        );
        return { status: 'processed', reason: 'plan_activated' };
      }

      // C. Neither Deposit nor Payment found: order may be pending creation or invalid
      if (eventDoc.attempts >= maxAttempts) {
        // Exceeded bounded attempts: quarantine for manual reconciliation
        await WebhookEvent.updateOne(
          { _id: eventDoc._id },
          {
            $set: {
              status: 'quarantined',
              failedAt: new Date(),
              lastErrorCategory: 'UNRECOVERABLE_ORDER_NOT_FOUND',
              lastErrorMessage: `Order ${orderId} not found after ${eventDoc.attempts} recovery attempts`,
              'metadata.requiresManualReview': true,
              'metadata.quarantinedAt': new Date(),
            },
          },
          sessionOpt
        );

        await dispatchQuarantineAlert({
          withdrawal: {
            _id: eventDoc._id,
            withdrawalReference: `WEBHOOK-${eventId}`,
            amount: eventDoc.metadata?.amount || 0,
            currency: eventDoc.metadata?.currency || 'INR',
            status: 'QUARANTINED',
            metadata: eventDoc.metadata,
          },
          reason: `Stale webhook event ${eventId} for order ${orderId} exceeded max recovery attempts (${eventDoc.attempts}) without matching deposit or payment record`,
        });

        return { status: 'quarantined', reason: 'max_attempts_exceeded_order_not_found' };
      }

      // Safe transient retry state
      await WebhookEvent.updateOne(
        { _id: eventDoc._id },
        {
          $set: {
            status: 'failed',
            failedAt: new Date(),
            lastErrorCategory: 'ORDER_NOT_FOUND',
            lastErrorMessage: `Order ${orderId} not found; waiting for persistence or next retry cycle`,
          },
        },
        sessionOpt
      );
      return { status: 'retry_pending', reason: 'order_not_found_will_retry' };
    }

    // 2. Failed payment event
    if (eventType === 'payment.failed') {
      if (orderId) {
        const payment = await Payment.findOne({ orderId });
        if (payment && payment.status !== 'captured') {
          payment.status = 'failed';
          if (typeof payment.save === 'function') {
            await payment.save(sessionOpt);
          }
        }
        const deposit = await Deposit.findOne({ orderId });
        if (deposit && deposit.status !== 'completed') {
          deposit.status = 'failed';
          if (typeof deposit.save === 'function') {
            await deposit.save(sessionOpt);
          }
        }
      }

      await WebhookEvent.updateOne(
        { _id: eventDoc._id },
        {
          $set: {
            status: 'processed',
            processedAt: new Date(),
          },
        },
        sessionOpt
      );
      return { status: 'processed', reason: 'payment_failed_marked' };
    }

    // 3. Unhandled event types
    await WebhookEvent.updateOne(
      { _id: eventDoc._id },
      {
        $set: {
          status: 'processed',
          processedAt: new Date(),
        },
      },
      sessionOpt
    );
    return { status: 'processed', reason: 'unhandled_event_type_closed' };
  } catch (err) {
    if (eventDoc.attempts >= maxAttempts) {
      await WebhookEvent.updateOne(
        { _id: eventDoc._id },
        {
          $set: {
            status: 'quarantined',
            failedAt: new Date(),
            lastErrorCategory: err.name || 'RECOVERY_ERROR',
            lastErrorMessage: err.message,
            'metadata.requiresManualReview': true,
            'metadata.quarantinedAt': new Date(),
          },
        },
        sessionOpt
      );

      try {
        await dispatchQuarantineAlert({
          withdrawal: {
            _id: eventDoc._id,
            withdrawalReference: `WEBHOOK-${eventId}`,
            amount: eventDoc.metadata?.amount || 0,
            status: 'QUARANTINED',
            metadata: eventDoc.metadata,
          },
          reason: `Stale webhook event ${eventId} reconciliation threw error after ${eventDoc.attempts} attempts: ${err.message}`,
        });
      } catch (_) {}

      return { status: 'quarantined', error: err.message };
    }

    await WebhookEvent.updateOne(
      { _id: eventDoc._id },
      {
        $set: {
          status: 'failed',
          failedAt: new Date(),
          lastErrorCategory: err.name || 'RECOVERY_ERROR',
          lastErrorMessage: err.message,
        },
      },
      sessionOpt
    );
    return { status: 'failed', error: err.message };
  }
};

/**
 * Execute a single bounded discovery and reconciliation batch
 *
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export const runStaleWebhookReconciliationBatch = async (options = {}) => {
  const batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
  const staleTimeoutMs = options.staleTimeoutMs || DEFAULT_STALE_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts || DEFAULT_MAX_ATTEMPTS;

  const staleCutoff = new Date(Date.now() - staleTimeoutMs);

  // Discover candidate events stuck in 'processing' or 'failed' beyond timeout threshold
  let candidates = [];
  try {
    candidates = await WebhookEvent.find({
      status: { $in: ['processing', 'failed'] },
      lastReceivedAt: { $lt: staleCutoff },
    })
      .sort({ lastReceivedAt: 1 })
      .limit(batchSize);
  } catch (err) {
    return {
      success: false,
      error: err.message,
      scanned: 0,
      claimed: 0,
      processed: 0,
      quarantined: 0,
      failed: 0,
    };
  }

  let claimedCount = 0;
  let processedCount = 0;
  let quarantinedCount = 0;
  let failedCount = 0;

  for (const candidate of candidates) {
    // Atomic CAS claim: only one worker can win the lock
    const claimed = await WebhookEvent.findOneAndUpdate(
      {
        _id: candidate._id,
        status: candidate.status,
        lastReceivedAt: candidate.lastReceivedAt,
      },
      {
        $set: {
          status: 'processing',
          lastReceivedAt: new Date(),
        },
        $inc: { attempts: 1 },
      },
      { new: true, returnDocument: 'after' }
    );

    if (!claimed) {
      // Claim was won by a concurrent worker
      continue;
    }

    claimedCount++;
    const result = await reconcileSingleStaleWebhookEvent(claimed, { maxAttempts });

    if (result.status === 'processed') {
      processedCount++;
    } else if (result.status === 'quarantined') {
      quarantinedCount++;
    } else {
      failedCount++;
    }
  }

  return {
    success: true,
    scanned: candidates.length,
    claimed: claimedCount,
    processed: processedCount,
    quarantined: quarantinedCount,
    failed: failedCount,
  };
};

/**
 * In-process scheduler state
 */
let schedulerTimer = null;
let isSchedulerActive = false;

/**
 * Start the periodic background reconciliation scheduler
 *
 * @param {Object} [options]
 */
export const startWebhookReconciliationScheduler = (options = {}) => {
  if (schedulerTimer || isSchedulerActive) {
    return;
  }

  const intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
  isSchedulerActive = true;

  const scheduleNext = () => {
    if (!isSchedulerActive) return;

    schedulerTimer = setTimeout(async () => {
      if (!isSchedulerActive) return;
      try {
        await runStaleWebhookReconciliationBatch(options);
      } catch (err) {
        console.error('[WebhookReconciliationScheduler] Unhandled batch error:', err.message);
      } finally {
        if (isSchedulerActive) {
          scheduleNext();
        }
      }
    }, intervalMs);

    if (typeof schedulerTimer.unref === 'function') {
      schedulerTimer.unref(); // Prevent timer from keeping test processes alive
    }
  };

  scheduleNext();
};

/**
 * Gracefully stop the periodic background reconciliation scheduler
 */
export const stopWebhookReconciliationScheduler = () => {
  isSchedulerActive = false;
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
};

/**
 * Check if the scheduler is currently active
 * @returns {boolean}
 */
export const isWebhookReconciliationSchedulerRunning = () => isSchedulerActive;

/**
 * Admin: List all quarantined webhook events with bounded pagination and safe diagnostic projection
 *
 * @param {Object} [options]
 * @param {number|string} [options.page=1]
 * @param {number|string} [options.limit=10]
 * @returns {Promise<Object>}
 */
export const getQuarantinedWebhookEventsAdmin = async (options = {}) => {
  const pageNum = Math.max(1, parseInt(options.page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(options.limit, 10) || DEFAULT_BATCH_SIZE));
  const skip = (pageNum - 1) * limitNum;

  const filter = { status: 'quarantined' };

  const [total, events] = await Promise.all([
    WebhookEvent.countDocuments(filter),
    WebhookEvent.find(filter)
      .sort({ failedAt: -1, lastReceivedAt: -1, createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
  ]);

  const sanitizedEvents = events.map((evt) => ({
    _id: evt._id,
    eventId: evt.eventId,
    provider: evt.provider,
    eventType: evt.eventType,
    status: evt.status,
    attempts: evt.attempts,
    orderId: evt.orderId || '',
    paymentId: evt.paymentId || '',
    resourceType: evt.resourceType || 'unknown',
    resourceReference: evt.resourceReference || '',
    lastErrorCategory: evt.lastErrorCategory || '',
    lastErrorMessage: evt.lastErrorMessage || '',
    firstReceivedAt: evt.firstReceivedAt,
    lastReceivedAt: evt.lastReceivedAt,
    failedAt: evt.failedAt,
    processedAt: evt.processedAt,
    createdAt: evt.createdAt,
    updatedAt: evt.updatedAt,
    requiresManualReview: Boolean(evt.metadata?.requiresManualReview),
    quarantinedAt: evt.metadata?.quarantinedAt || evt.failedAt || null,
    amount: evt.metadata?.amount != null ? Number(evt.metadata.amount) : null,
    currency: evt.metadata?.currency || 'INR',
  }));

  return {
    total,
    page: pageNum,
    pages: Math.ceil(total / limitNum) || 1,
    events: sanitizedEvents,
    data: sanitizedEvents,
  };
};

/**
 * Admin: Safely reconcile a quarantined webhook event
 *
 * Implements strict transaction ownership, atomic rollback on failure,
 * and authoritative database verification of active administrator reviewer identity.
 *
 * Architectural Note on Dual Approval:
 * Reconciliations for high-value operations (>= ₹10,000) require a verified second administrator.
 * The system validates that secondReviewerId corresponds to an existing, distinct, and active
 * administrator account in the User collection, and logs both identities in the immutable AuditLog.
 * However, because both identifiers are submitted in a single administrative request, this represents
 * dual-reviewer credential validation rather than asynchronous, multi-party signed consensus.
 *
 * @param {string|mongoose.Types.ObjectId} adminId - Authenticated admin ID
 * @param {string} eventIdentifier - MongoDB _id or provider eventId
 * @param {Object} options
 * @param {string} options.reason - Mandatory resolution reason (min 10 chars)
 * @param {string} [options.secondReviewerId] - Optional second reviewer admin ID (mandatory for >= ₹10,000)
 * @param {string} [options.ipAddress] - Client IP address
 * @returns {Promise<Object>}
 */
export const resolveQuarantinedWebhookEventAdmin = async (adminId, eventIdentifier, options = {}) => {
  const { reason, secondReviewerId, ipAddress } = options;

  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    const error = new Error('A detailed justification reason (min 10 characters) is required for manual resolution');
    error.statusCode = 400;
    throw error;
  }
  const trimmedReason = reason.trim();

  if (!eventIdentifier || typeof eventIdentifier !== 'string') {
    const error = new Error('Webhook event ID or reference is required');
    error.statusCode = 400;
    throw error;
  }

  // 1. Durability & Topology Check: Fail closed if multi-document transactions are unsupported
  if (!isTransactionSupported()) {
    const error = new Error(
      'Multi-document ACID transactions are required for administrative webhook reconciliation. Replica Set topology is unavailable.'
    );
    error.statusCode = 503;
    throw error;
  }

  // 2. Locate event by _id or eventId
  let queryFilter = { eventId: eventIdentifier };
  if (mongoose.isValidObjectId(eventIdentifier)) {
    queryFilter = { $or: [{ _id: eventIdentifier }, { eventId: eventIdentifier }] };
  }

  const existingEvent = await WebhookEvent.findOne(queryFilter);
  if (!existingEvent) {
    const error = new Error('Quarantined webhook event not found');
    error.statusCode = 404;
    throw error;
  }

  // 3. Validate current status is quarantined
  if (existingEvent.status !== 'quarantined') {
    const error = new Error(
      `Only quarantined webhook events can be manually reconciled; current status is: ${existingEvent.status}`
    );
    error.statusCode = 400;
    throw error;
  }

  // 4. Derive authoritative amount from verified database record (never trust client payload)
  let effectiveAmount = 0;
  if (existingEvent.orderId) {
    const deposit = await Deposit.findOne({ orderId: existingEvent.orderId });
    if (deposit && typeof deposit.amount === 'number') {
      effectiveAmount = deposit.amount;
    } else {
      const payment = await Payment.findOne({ orderId: existingEvent.orderId });
      if (payment && typeof payment.amount === 'number') {
        effectiveAmount = payment.amount;
      }
    }
  }
  if (effectiveAmount === 0 && typeof existingEvent.metadata?.amount === 'number') {
    effectiveAmount = existingEvent.metadata.amount;
  }

  // 5. Dual Review Authorization Policy
  // High-value reconciliations (>= 10,000 INR) strictly require verified second administrator approval
  const isHighValue = effectiveAmount >= DUAL_REVIEW_THRESHOLD;
  if (isHighValue && !secondReviewerId) {
    const error = new Error(
      `Dual authorization required: reconciliations for amounts >= ₹${DUAL_REVIEW_THRESHOLD} require a second authorized reviewer`
    );
    error.statusCode = 400;
    throw error;
  }

  let verifiedSecondAdmin = null;
  if (secondReviewerId) {
    if (String(secondReviewerId) === String(adminId)) {
      const error = new Error('Dual authorization violation: Second reviewer must be a different administrator');
      error.statusCode = 400;
      throw error;
    }
    if (!mongoose.Types.ObjectId.isValid(secondReviewerId)) {
      const error = new Error('Dual authorization violation: Second reviewer ID is not a valid MongoDB ObjectId');
      error.statusCode = 400;
      throw error;
    }

    verifiedSecondAdmin = await User.findById(secondReviewerId);
    if (!verifiedSecondAdmin) {
      const error = new Error('Dual authorization violation: Second reviewer account does not exist');
      error.statusCode = 400;
      throw error;
    }
    if (verifiedSecondAdmin.role !== 'admin') {
      const error = new Error('Dual authorization violation: Second reviewer must be an authorized administrator');
      error.statusCode = 400;
      throw error;
    }
    if (
      verifiedSecondAdmin.isActive === false ||
      verifiedSecondAdmin.status === 'inactive' ||
      verifiedSecondAdmin.status === 'suspended' ||
      verifiedSecondAdmin.isBlocked === true
    ) {
      const error = new Error('Dual authorization violation: Second reviewer account is inactive or suspended');
      error.statusCode = 400;
      throw error;
    }
  }

  // 6. Single Transaction Owner: start atomic multi-document transaction session
  const session = await mongoose.startSession();
  session.startTransaction();

  let isCommitted = false;
  try {
    // 7. Atomic CAS lock transition within transaction session: 'quarantined' -> 'processing'
    const claimQuery = WebhookEvent.findOneAndUpdate(
      {
        _id: existingEvent._id,
        status: 'quarantined',
      },
      {
        $set: {
          status: 'processing',
          lastReceivedAt: new Date(),
          'metadata.adminResolutionClaimedBy': adminId,
          'metadata.adminResolutionClaimedAt': new Date(),
          'metadata.adminResolutionReason': trimmedReason,
          ...(verifiedSecondAdmin ? { 'metadata.adminResolutionSecondReviewer': verifiedSecondAdmin._id } : {}),
        },
        $inc: { attempts: 1 },
      },
      { new: true, returnDocument: 'after', session }
    );
    const claimed =
      typeof claimQuery?.session === 'function' ? await claimQuery.session(session) : await claimQuery;

    if (!claimed) {
      await session.abortTransaction();
      await session.endSession();
      const error = new Error('Conflict: Quarantined webhook event is currently being reconciled by another administrator');
      error.statusCode = 409;
      throw error;
    }

    // 8. Execute domain reconciliation passing the active session
    let reconciliationResult;
    try {
      reconciliationResult = await reconcileSingleStaleWebhookEvent(claimed, { maxAttempts: 999, session });
    } catch (recErr) {
      reconciliationResult = { status: 'failed', error: recErr.message };
    }

    // 9. Verify durable business outcome
    if (reconciliationResult.status !== 'processed') {
      // Abort transaction to ensure zero partial mutations
      await session.abortTransaction();
      await session.endSession();

      // Outside aborted transaction: record failed attempt metadata and preserve quarantine
      await WebhookEvent.updateOne(
        { _id: claimed._id },
        {
          $set: {
            status: 'quarantined',
            failedAt: new Date(),
            lastErrorCategory: 'MANUAL_RECONCILIATION_UNRESOLVABLE',
            lastErrorMessage: `Manual reconciliation could not verify order: ${
              reconciliationResult.reason || reconciliationResult.error || 'Matching order or deposit record absent or invalid'
            }`,
            'metadata.requiresManualReview': true,
            'metadata.quarantinedAt': new Date(),
            'metadata.lastAttemptedAdmin': adminId,
            'metadata.lastAttemptedReason': trimmedReason,
          },
        }
      );

      const error = new Error(
        `Manual reconciliation failed: ${
          reconciliationResult.reason || reconciliationResult.error || 'Matching deposit or payment order could not be verified'
        }`
      );
      error.statusCode = 422;
      throw error;
    }

    // 10. Record append-only immutable AuditLog WITHIN THE SAME SESSION
    const eventQuery = WebhookEvent.findById(claimed._id);
    const reconciledEvent =
      typeof eventQuery?.session === 'function' ? await eventQuery.session(session) : await eventQuery;

    const stateBefore = {
      status: 'quarantined',
      attempts: existingEvent.attempts,
      lastErrorCategory: existingEvent.lastErrorCategory,
      lastErrorMessage: existingEvent.lastErrorMessage,
      orderId: existingEvent.orderId,
      paymentId: existingEvent.paymentId,
    };

    const stateAfter = {
      status: reconciledEvent?.status || 'processed',
      resourceType: reconciledEvent?.resourceType,
      resourceReference: reconciledEvent?.resourceReference,
      processedAt: reconciledEvent?.processedAt,
      attempts: reconciledEvent?.attempts,
      reconciledByAdmin: String(adminId),
      ...(verifiedSecondAdmin ? { secondReviewerAdmin: String(verifiedSecondAdmin._id) } : {}),
    };

    const auditLogData = {
      entityType: 'WebhookEvent',
      entityId: claimed._id,
      operationReference: reconciledEvent?.resourceReference || `WEBHOOK-${claimed.eventId}`,
      action: 'WEBHOOK_QUARANTINE_RECONCILE',
      performedBy: adminId,
      secondReviewerBy: verifiedSecondAdmin ? verifiedSecondAdmin._id : null,
      decision: 'RECONCILE_WEBHOOK',
      reason: trimmedReason,
      stateBefore,
      stateAfter,
      ipAddress: ipAddress || '',
    };

    let auditLog = null;
    try {
      const created = await AuditLog.create([auditLogData], { session });
      auditLog = Array.isArray(created) ? created[0] : created;
    } catch (auditErr) {
      console.error('[FinancialAudit] Critical: AuditLog write failed during webhook reconciliation:', auditErr.message);
      const error = new Error(`Financial safety violation: AuditLog persistence failed: ${auditErr.message}`);
      error.statusCode = 500;
      throw error;
    }

    // 11. Atomic Commit: Commit ONLY after financial mutations AND AuditLog succeed
    await session.commitTransaction();
    isCommitted = true;
    await session.endSession();

    return {
      success: true,
      message: `Quarantined webhook event ${claimed.eventId} successfully reconciled (${reconciliationResult.reason || 'processed'})`,
      event: reconciledEvent,
      auditLog,
      reconciliation: reconciliationResult,
    };
  } catch (err) {
    if (!isCommitted && session) {
      try {
        await session.abortTransaction();
      } catch (_) {}
      try {
        await session.endSession();
      } catch (_) {}
    }
    throw err;
  }
};

export default {
  reconcileSingleStaleWebhookEvent,
  runStaleWebhookReconciliationBatch,
  startWebhookReconciliationScheduler,
  stopWebhookReconciliationScheduler,
  isWebhookReconciliationSchedulerRunning,
  getQuarantinedWebhookEventsAdmin,
  resolveQuarantinedWebhookEventAdmin,
  DEFAULT_STALE_TIMEOUT_MS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_INTERVAL_MS,
  DUAL_REVIEW_THRESHOLD,
};
