import mongoose from 'mongoose';

/**
 * ============================================================================
 * RECONCILIATION REQUEST MODEL — Two-Step Maker-Checker Approval
 * ============================================================================
 *
 * Represents an asynchronous, independently-authenticated two-step approval
 * workflow for high-value webhook reconciliations (>= DUAL_REVIEW_THRESHOLD).
 *
 * State machine:
 *   pending_approval  --(Admin B approves)--> approved
 *   pending_approval  --(Admin B rejects)---> rejected
 *   pending_approval  --(24h elapses)-------> expired
 *
 * Invariants:
 * - requestedBy (Admin A) and reviewedBy (Admin B) must be different users.
 * - Financial mutation (wallet credit) occurs ONLY in Admin B's approve action.
 * - A webhookEventId can have at most one pending_approval request at a time.
 * ============================================================================
 */

const ReconciliationRequestSchema = new mongoose.Schema(
  {
    webhookEventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WebhookEvent',
      required: [true, 'webhookEventId is required'],
      index: true,
    },
    // Denormalized for traceability after the event document may be updated
    webhookEventIdentifier: {
      type: String,
      required: [true, 'webhookEventIdentifier is required'],
      trim: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'requestedBy (Admin A) is required'],
      index: true,
    },
    reason: {
      type: String,
      required: [true, 'Reconciliation reason is required'],
      trim: true,
      minlength: [10, 'Reason must be at least 10 characters'],
      maxlength: [1000, 'Reason cannot exceed 1000 characters'],
    },
    // Derived from DB at creation — never trusted from client
    effectiveAmount: {
      type: Number,
      required: [true, 'effectiveAmount is required'],
      min: [0, 'effectiveAmount must be non-negative'],
    },
    status: {
      type: String,
      enum: ['pending_approval', 'approved', 'rejected', 'expired'],
      default: 'pending_approval',
      index: true,
    },
    expiresAt: {
      type: Date,
      required: [true, 'expiresAt is required'],
      index: true,
    },
    // Set only when Admin B acts
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewNote: {
      type: String,
      trim: true,
      maxlength: [1000, 'Review note cannot exceed 1000 characters'],
      default: '',
    },
    // Audit trail IPs
    ipAddress: {
      type: String,
      trim: true,
      default: '',
    },
    reviewIpAddress: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { timestamps: true }
);

// Compound index: prevent two simultaneous pending requests for the same event
ReconciliationRequestSchema.index(
  { webhookEventId: 1, status: 1 },
  {
    name: 'unique_pending_per_event',
    // Note: partial unique index — only one pending_approval per webhookEventId
    // Enforced in service layer for broader Mongoose compatibility
  }
);

ReconciliationRequestSchema.index({ requestedBy: 1 });

// Pre-save validation: reviewer must differ from requester
ReconciliationRequestSchema.pre('save', async function () {
  if (
    this.reviewedBy &&
    this.requestedBy &&
    String(this.reviewedBy) === String(this.requestedBy)
  ) {
    const err = new Error('Maker-checker violation: reviewer (Admin B) must differ from requester (Admin A)');
    err.statusCode = 400;
    throw err;
  }
});

const ReconciliationRequest = mongoose.model('ReconciliationRequest', ReconciliationRequestSchema);

export { ReconciliationRequest };
export default ReconciliationRequest;
