import mongoose from 'mongoose';

/**
 * ============================================================================
 * APPEND-ONLY FINANCIAL AUDIT LOG MODEL
 * ============================================================================
 *
 * Implements an immutable, append-only ledger for all manual administrative
 * resolutions and sensitive financial operations. Records reviewer identities,
 * decisions, dual-review authorizations, and exact before-and-after state snapshots.
 *
 * Immutability Guarantee:
 * Pre-hooks reject any update or delete operations on audit records.
 * ============================================================================
 */
const auditLogSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      required: [true, 'Entity type is required for audit record'],
      enum: ['Withdrawal', 'Wallet', 'Transaction', 'System', 'WebhookEvent'],
      index: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'Entity ID is required for audit record'],
      index: true,
    },
    operationReference: {
      type: String,
      trim: true,
      index: true,
    },
    action: {
      type: String,
      required: [true, 'Action name is required for audit record'],
      enum: [
        'QUARANTINE_RESOLVE_CONFIRM',
        'QUARANTINE_RESOLVE_CREDIT',
        'QUARANTINE_RESOLVE_REJECT',
        'AUDIT_INSPECT',
        'WEBHOOK_QUARANTINE_RECONCILE',
      ],
      index: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Reviewer identity is required for audit record'],
      index: true,
    },
    secondReviewerBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    decision: {
      type: String,
      required: [true, 'Resolution decision is required'],
      enum: [
        'CONFIRM_CREDIT_AND_SEAL',
        'APPLY_MISSING_CREDIT',
        'REJECT_REFUND',
        'RECONCILE_WEBHOOK',
      ],
    },
    reason: {
      type: String,
      required: [true, 'Justification reason is required for manual resolution'],
      trim: true,
      minlength: [10, 'Justification reason must be at least 10 characters'],
    },
    stateBefore: {
      type: mongoose.Schema.Types.Mixed,
      required: [true, 'State snapshot before operation is required'],
    },
    stateAfter: {
      type: mongoose.Schema.Types.Mixed,
      required: [true, 'State snapshot after operation is required'],
    },
    ipAddress: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // Append-only: no updatedAt
  }
);

// Immutability Enforcement: Block updates, replacements, and deletes in Mongoose v9
const preventMutation = function () {
  const error = new Error('AuditLog records are strictly append-only and cannot be updated or deleted');
  error.statusCode = 403;
  throw error;
};

auditLogSchema.pre('updateOne', preventMutation);
auditLogSchema.pre('updateMany', preventMutation);
auditLogSchema.pre('findOneAndUpdate', preventMutation);
auditLogSchema.pre('deleteOne', preventMutation);
auditLogSchema.pre('deleteMany', preventMutation);
auditLogSchema.pre('findOneAndDelete', preventMutation);
auditLogSchema.pre('replaceOne', preventMutation);
auditLogSchema.pre('findOneAndReplace', preventMutation);
auditLogSchema.pre('deleteOne', { document: true, query: false }, preventMutation);
auditLogSchema.pre('save', function () {
  if (!this.isNew) {
    const error = new Error('AuditLog records are strictly append-only and cannot be updated or deleted');
    error.statusCode = 403;
    throw error;
  }
});

auditLogSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
