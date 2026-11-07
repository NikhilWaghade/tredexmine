import mongoose from 'mongoose';
import { ReconciliationRequest } from '../models/ReconciliationRequest.js';
import { WebhookEvent } from '../models/WebhookEvent.js';
import { Deposit } from '../models/Deposit.js';
import { Payment } from '../models/Payment.js';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { reconcileSingleStaleWebhookEvent, DUAL_REVIEW_THRESHOLD } from './webhookReconciliationService.js';
import { isTransactionSupported } from './planService.js';

/**
 * ============================================================================
 * RECONCILIATION REQUEST SERVICE — Maker-Checker Two-Step Approval
 * ============================================================================
 *
 * Implements an asynchronous, independently-authenticated two-step approval
 * workflow for high-value webhook reconciliations (>= DUAL_REVIEW_THRESHOLD).
 *
 * Flow:
 *   1. Admin A  →  createReconciliationRequest()   → status: pending_approval
 *   2. Admin B  →  reviewReconciliationRequest()   → approve or reject
 *      - approve: financial mutation (wallet credit) inside MongoDB transaction
 *      - reject:  no financial mutation; status → rejected
 *   3. Requests expire after APPROVAL_EXPIRY_HOURS if not acted upon.
 *
 * Invariants:
 *   - Admin A and Admin B must be distinct, active, admin-role users.
 *   - Financial mutation occurs ONLY in Admin B's approve action.
 *   - AuditLog records both admin IDs within the same transaction.
 *   - Low-value events (< DUAL_REVIEW_THRESHOLD) use the existing single-
 *     request flow; this service rejects them to prevent routing errors.
 * ============================================================================
 */

export const APPROVAL_EXPIRY_HOURS = 24;

/**
 * Derive the authoritative amount for a webhook event from DB records.
 * Never trusts client-supplied data.
 *
 * @param {Object} existingEvent
 * @returns {Promise<number>}
 */
const deriveEffectiveAmount = async (existingEvent) => {
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

  return effectiveAmount;
};

/**
 * Validate that a user is an active, non-suspended administrator.
 *
 * @param {string|ObjectId} userId
 * @returns {Promise<Object>} User document
 */
const requireActiveAdmin = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('Administrator account does not exist');
    err.statusCode = 400;
    throw err;
  }
  if (user.role !== 'admin') {
    const err = new Error('User is not an authorized administrator');
    err.statusCode = 400;
    throw err;
  }
  if (
    user.isActive === false ||
    user.status === 'inactive' ||
    user.status === 'suspended' ||
    user.isBlocked === true
  ) {
    const err = new Error('Administrator account is inactive or suspended');
    err.statusCode = 400;
    throw err;
  }
  return user;
};

/**
 * Admin A: Create a pending reconciliation request for a quarantined webhook.
 *
 * Only valid for high-value events (>= DUAL_REVIEW_THRESHOLD).
 * Low-value events must use the existing single-request flow.
 *
 * @param {string|ObjectId} adminAId
 * @param {string} eventIdentifier  - MongoDB _id or provider eventId
 * @param {Object} options
 * @param {string} options.reason   - Mandatory justification (min 10 chars)
 * @param {string} [options.ipAddress]
 * @returns {Promise<Object>}  Created ReconciliationRequest document
 */
export const createReconciliationRequest = async (adminAId, eventIdentifier, options = {}) => {
  const { reason, ipAddress = '' } = options;

  // Validate reason
  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    const err = new Error('A detailed justification reason (minimum 10 characters) is required');
    err.statusCode = 400;
    throw err;
  }
  if (reason.trim().length > 1000) {
    const err = new Error('Justification reason cannot exceed 1000 characters');
    err.statusCode = 400;
    throw err;
  }
  const trimmedReason = reason.trim();

  // Topology check
  if (!isTransactionSupported()) {
    const err = new Error(
      'Multi-document ACID transactions are required for reconciliation requests. Replica Set topology is unavailable.'
    );
    err.statusCode = 503;
    throw err;
  }

  // Locate webhook event
  if (!eventIdentifier || typeof eventIdentifier !== 'string') {
    const err = new Error('Webhook event identifier is required');
    err.statusCode = 400;
    throw err;
  }
  let queryFilter = { eventId: eventIdentifier };
  if (mongoose.isValidObjectId(eventIdentifier)) {
    queryFilter = { $or: [{ _id: eventIdentifier }, { eventId: eventIdentifier }] };
  }
  const existingEvent = await WebhookEvent.findOne(queryFilter);
  if (!existingEvent) {
    const err = new Error('Quarantined webhook event not found');
    err.statusCode = 404;
    throw err;
  }

  // Must be quarantined
  if (existingEvent.status !== 'quarantined') {
    const err = new Error(
      `Only quarantined webhook events can be submitted for reconciliation approval; current status: ${existingEvent.status}`
    );
    err.statusCode = 400;
    throw err;
  }

  // Derive authoritative amount
  const effectiveAmount = await deriveEffectiveAmount(existingEvent);

  // Route guard: low-value must use existing single-request flow
  if (effectiveAmount < DUAL_REVIEW_THRESHOLD) {
    const err = new Error(
      `Reconciliation requests (maker-checker) are only required for amounts >= ₹${DUAL_REVIEW_THRESHOLD}. ` +
        `Use the existing single-request reconcile endpoint for low-value events.`
    );
    err.statusCode = 400;
    throw err;
  }

  // Check for duplicate pending request
  const existingPending = await ReconciliationRequest.findOne({
    webhookEventId: existingEvent._id,
    status: 'pending_approval',
    expiresAt: { $gt: new Date() },
  });
  if (existingPending) {
    const err = new Error(
      `A pending reconciliation approval request already exists for this event (id: ${existingPending._id}). ` +
        `Wait for Admin B to review it, or let it expire after ${APPROVAL_EXPIRY_HOURS} hours.`
    );
    err.statusCode = 409;
    throw err;
  }

  // Create the request
  const expiresAt = new Date(Date.now() + APPROVAL_EXPIRY_HOURS * 60 * 60 * 1000);
  const [request] = await ReconciliationRequest.create([
    {
      webhookEventId: existingEvent._id,
      webhookEventIdentifier: existingEvent.eventId,
      requestedBy: adminAId,
      reason: trimmedReason,
      effectiveAmount,
      status: 'pending_approval',
      expiresAt,
      ipAddress: String(ipAddress).trim(),
    },
  ]);

  // AuditLog initiation
  try {
    await AuditLog.create([
      {
        entityType: 'ReconciliationRequest',
        entityId: request._id,
        operationReference: `RECON-REQ-${request._id}`,
        action: 'RECONCILIATION_REQUEST_INITIATED',
        performedBy: adminAId,
        decision: 'INITIATE_MAKER_CHECKER',
        reason: trimmedReason,
        stateBefore: {
          status: existingEvent.status,
          webhookEventId: String(existingEvent._id),
          effectiveAmount,
        },
        stateAfter: {
          status: 'pending_approval',
          reconciliationRequestId: String(request._id),
          expiresAt,
        },
        ipAddress: String(ipAddress).trim(),
      },
    ]);
  } catch (auditErr) {
    console.error('[FinancialAudit] Critical: AuditLog initiation write failed:', auditErr.message);
    // Remove the created request if audit fails to maintain strict compliance
    await ReconciliationRequest.deleteOne({ _id: request._id });
    const err = new Error(`Financial safety violation: AuditLog persistence failed on initiation: ${auditErr.message}`);
    err.statusCode = 500;
    throw err;
  }

  return request;
};

/**
 * Admin B: Approve or reject a pending reconciliation request.
 *
 * - 'approve': executes financial mutation inside a MongoDB transaction.
 * - 'reject':  no financial mutation; marks request rejected.
 *
 * @param {string|ObjectId} adminBId
 * @param {string|ObjectId} requestId  - ReconciliationRequest._id
 * @param {'approve'|'reject'} action
 * @param {Object} options
 * @param {string} [options.reviewNote]
 * @param {string} [options.ipAddress]
 * @returns {Promise<Object>}
 */
export const reviewReconciliationRequest = async (adminBId, requestId, action, options = {}) => {
  const { reviewNote = '', ipAddress = '' } = options;

  if (!['approve', 'reject'].includes(action)) {
    const err = new Error("action must be 'approve' or 'reject'");
    err.statusCode = 400;
    throw err;
  }

  if (!mongoose.isValidObjectId(requestId)) {
    const err = new Error('requestId must be a valid MongoDB ObjectId');
    err.statusCode = 400;
    throw err;
  }

  const request = await ReconciliationRequest.findById(requestId);
  if (!request) {
    const err = new Error('Reconciliation request not found');
    err.statusCode = 404;
    throw err;
  }

  // Status guard — handle expiry inline
  if (request.status !== 'pending_approval') {
    const err = new Error(`Request is no longer pending; current status: ${request.status}`);
    err.statusCode = 409;
    throw err;
  }

  if (request.expiresAt <= new Date()) {
    // Atomically expire
    await ReconciliationRequest.updateOne(
      { _id: request._id, status: 'pending_approval' },
      { $set: { status: 'expired' } }
    );
    const err = new Error('Reconciliation request has expired; Admin A must create a new request');
    err.statusCode = 400;
    throw err;
  }

  // Self-approval guard
  if (String(adminBId) === String(request.requestedBy)) {
    const err = new Error('Maker-checker violation: Admin B cannot be the same administrator who created the request (Admin A)');
    err.statusCode = 400;
    throw err;
  }

  // Validate Admin B
  await requireActiveAdmin(adminBId);

  const now = new Date();

  // ── REJECT ────────────────────────────────────────────────────────────────
  if (action === 'reject') {
    request.status = 'rejected';
    request.reviewedBy = adminBId;
    request.reviewedAt = now;
    request.reviewNote = reviewNote ? String(reviewNote).trim() : '';
    request.reviewIpAddress = String(ipAddress).trim();
    await request.save();

    // Record rejection in AuditLog (outside transaction — no financial mutation)
    try {
      await AuditLog.create([
        {
          entityType: 'ReconciliationRequest',
          entityId: request._id,
          operationReference: `RECON-REQ-${request._id}`,
          action: 'RECONCILIATION_REQUEST_REJECTED',
          performedBy: adminBId,
          secondReviewerBy: request.requestedBy,
          decision: 'REJECT',
          reason: reviewNote || 'Rejected by reviewer',
          stateBefore: { status: 'pending_approval' },
          stateAfter: { status: 'rejected', reviewedBy: String(adminBId) },
          ipAddress: String(ipAddress).trim(),
        },
      ]);
    } catch (auditErr) {
      // AuditLog failure on reject is serious but not financially critical
      console.error('[FinancialAudit] AuditLog write failed for rejection:', auditErr.message);
    }

    return { success: true, action: 'rejected', request };
  }

  // ── APPROVE ───────────────────────────────────────────────────────────────
  if (!isTransactionSupported()) {
    const err = new Error(
      'Multi-document ACID transactions are required for reconciliation approval. Replica Set topology is unavailable.'
    );
    err.statusCode = 503;
    throw err;
  }

  // Re-fetch the webhook event to verify it's still quarantined
  const webhookEvent = await WebhookEvent.findById(request.webhookEventId);
  if (!webhookEvent) {
    const err = new Error('The associated webhook event no longer exists');
    err.statusCode = 404;
    throw err;
  }
  if (webhookEvent.status !== 'quarantined') {
    const err = new Error(
      `Webhook event is no longer quarantined; current status: ${webhookEvent.status}. ` +
        `It may have been resolved by another administrator.`
    );
    err.statusCode = 409;
    throw err;
  }

  // Start atomic transaction
  const session = await mongoose.startSession();
  session.startTransaction();
  let isCommitted = false;

  try {
    // Atomic CAS: quarantined → processing (within session)
    const claimQuery = WebhookEvent.findOneAndUpdate(
      { _id: webhookEvent._id, status: 'quarantined' },
      {
        $set: {
          status: 'processing',
          lastReceivedAt: now,
          'metadata.adminResolutionClaimedBy': request.requestedBy,
          'metadata.adminResolutionClaimedAt': now,
          'metadata.adminResolutionReason': request.reason,
          'metadata.adminResolutionSecondReviewer': adminBId,
          'metadata.reconciliationRequestId': request._id,
        },
        $inc: { attempts: 1 },
      },
      { new: true, returnDocument: 'after', session }
    );
    const claimed = typeof claimQuery?.session === 'function'
      ? await claimQuery.session(session)
      : await claimQuery;

    if (!claimed) {
      await session.abortTransaction();
      await session.endSession();
      const err = new Error(
        'Conflict: Webhook event is being reconciled by another process. Please try again shortly.'
      );
      err.statusCode = 409;
      throw err;
    }

    // Execute domain reconciliation inside the same session
    let reconciliationResult;
    try {
      reconciliationResult = await reconcileSingleStaleWebhookEvent(claimed, { maxAttempts: 999, session });
    } catch (recErr) {
      reconciliationResult = { status: 'failed', error: recErr.message };
    }

    if (reconciliationResult.status !== 'processed') {
      await session.abortTransaction();
      await session.endSession();

      // Outside aborted transaction: preserve quarantine
      await WebhookEvent.updateOne(
        { _id: claimed._id },
        {
          $set: {
            status: 'quarantined',
            'metadata.requiresManualReview': true,
            'metadata.quarantinedAt': now,
            lastErrorCategory: 'MAKER_CHECKER_APPROVAL_UNRESOLVABLE',
            lastErrorMessage: `Maker-checker approval reconciliation failed: ${
              reconciliationResult.reason || reconciliationResult.error || 'Unknown'
            }`,
          },
        }
      );

      const err = new Error(
        `Approval reconciliation failed: ${
          reconciliationResult.reason || reconciliationResult.error || 'Deposit or payment order could not be verified'
        }`
      );
      err.statusCode = 422;
      throw err;
    }

    // Fetch final event state for AuditLog
    const reconciledEventQuery = WebhookEvent.findById(claimed._id);
    const reconciledEvent =
      typeof reconciledEventQuery?.session === 'function'
        ? await reconciledEventQuery.session(session)
        : await reconciledEventQuery;

    // Write AuditLog within same session (rollback if this fails)
    try {
      await AuditLog.create(
        [
          {
            entityType: 'WebhookEvent',
            entityId: claimed._id,
            operationReference:
              reconciledEvent?.resourceReference || `WEBHOOK-${claimed.eventId}`,
            action: 'WEBHOOK_QUARANTINE_RECONCILE',
            performedBy: request.requestedBy, // Admin A (original requester)
            secondReviewerBy: adminBId,        // Admin B (approver)
            decision: 'RECONCILE_WEBHOOK',
            reason: request.reason,
            stateBefore: {
              status: 'quarantined',
              reconciliationRequestId: String(request._id),
            },
            stateAfter: {
              status: reconciledEvent?.status || 'processed',
              resourceType: reconciledEvent?.resourceType,
              resourceReference: reconciledEvent?.resourceReference,
              processedAt: reconciledEvent?.processedAt,
              makerCheckerId: String(request._id),
            },
            ipAddress: String(ipAddress).trim(),
          },
        ],
        { session }
      );
    } catch (auditErr) {
      console.error('[FinancialAudit] Critical: AuditLog write failed during maker-checker approval:', auditErr.message);
      const err = new Error(`Financial safety violation: AuditLog persistence failed: ${auditErr.message}`);
      err.statusCode = 500;
      throw err;
    }

    // Update request status inside transaction to guarantee complete atomicity
    await ReconciliationRequest.updateOne(
      { _id: request._id },
      {
        $set: {
          status: 'approved',
          reviewedBy: adminBId,
          reviewedAt: now,
          reviewNote: reviewNote ? String(reviewNote).trim() : '',
          reviewIpAddress: String(ipAddress).trim(),
        },
      },
      { session }
    );

    // Commit all financial mutations, status change, and AuditLog atomically
    await session.commitTransaction();
    isCommitted = true;
    await session.endSession();

    return {
      success: true,
      action: 'approved',
      message: `Quarantined webhook event ${claimed.eventId} successfully reconciled via maker-checker approval`,
      event: reconciledEvent,
      reconciliation: reconciliationResult,
      requestId: request._id,
    };
  } catch (err) {
    if (!isCommitted && session) {
      try { await session.abortTransaction(); } catch (_) {}
      try { await session.endSession(); } catch (_) {}
    }
    throw err;
  }
};

/**
 * List pending reconciliation requests (for Admin B's dashboard).
 * Auto-expires stale entries before returning.
 *
 * @returns {Promise<Object[]>}
 */
export const getPendingReconciliationRequests = async () => {
  // Expire stale requests inline
  await expireStaleReconciliationRequests();

  return ReconciliationRequest.find({ status: 'pending_approval' })
    .populate('requestedBy', 'name email role')
    .populate('webhookEventId', 'eventId eventType status orderId')
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Get a single reconciliation request by ID.
 *
 * @param {string|ObjectId} requestId
 * @returns {Promise<Object>}
 */
export const getReconciliationRequestById = async (requestId) => {
  if (!mongoose.isValidObjectId(requestId)) {
    const err = new Error('requestId must be a valid MongoDB ObjectId');
    err.statusCode = 400;
    throw err;
  }

  const request = await ReconciliationRequest.findById(requestId)
    .populate('requestedBy', 'name email role')
    .populate('reviewedBy', 'name email role')
    .populate('webhookEventId', 'eventId eventType status orderId')
    .lean();

  if (!request) {
    const err = new Error('Reconciliation request not found');
    err.statusCode = 404;
    throw err;
  }
  return request;
};

/**
 * Bulk-expire all stale pending_approval requests past their expiry time.
 *
 * @returns {Promise<number>} Count of expired records
 */
export const expireStaleReconciliationRequests = async () => {
  const result = await ReconciliationRequest.updateMany(
    { status: 'pending_approval', expiresAt: { $lt: new Date() } },
    { $set: { status: 'expired' } }
  );
  return result.modifiedCount || 0;
};

export default {
  createReconciliationRequest,
  reviewReconciliationRequest,
  getPendingReconciliationRequests,
  getReconciliationRequestById,
  expireStaleReconciliationRequests,
  APPROVAL_EXPIRY_HOURS,
};
