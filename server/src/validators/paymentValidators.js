import mongoose from 'mongoose';

/**
 * ============================================================================
 * PAYMENT & WEBHOOK ADMINISTRATIVE VALIDATORS
 * ============================================================================
 *
 * Enforces strict input validation for administrative webhook reconciliation
 * and financial inspection endpoints.
 *
 * Invariants:
 * 1. Reason is strictly mandatory (min 10 characters, max 1000 characters).
 * 2. Directly rejects any attempt to inject arbitrary balances, amounts, or
 *    financial state overrides (prevents balance fabrication).
 * 3. Validates secondReviewerId when provided to enforce authorization rules.
 * ============================================================================
 */

export const validateAdminReconcileWebhook = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: ['Request body must be a JSON object'],
    });
  }

  const errors = [];
  const { reason, secondReviewerId } = req.body;

  // Disallow client attempting to dictate amounts, balances, or financial outcomes
  const forbiddenKeys = [
    'amount',
    'balance',
    'creditAmount',
    'status',
    'userId',
    'walletId',
    'depositReference',
    'resourceType',
  ];

  for (const key of forbiddenKeys) {
    if (key in req.body) {
      errors.push(`Field '${key}' is not permitted; manual reconciliation cannot fabricate or dictate financial balances`);
    }
  }

  // Validate mandatory reason
  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    errors.push('A detailed justification reason (minimum 10 characters) is required for manual reconciliation');
  } else if (reason.trim().length > 1000) {
    errors.push('Justification reason cannot exceed 1000 characters');
  }

  // Validate optional secondReviewerId
  if (secondReviewerId !== undefined && secondReviewerId !== null && secondReviewerId !== '') {
    if (typeof secondReviewerId !== 'string' || !mongoose.isValidObjectId(secondReviewerId)) {
      errors.push('secondReviewerId must be a valid 24-character hexadecimal ObjectId');
    } else if (req.user && String(req.user._id) === String(secondReviewerId)) {
      errors.push('Second reviewer cannot be the same administrator performing the resolution');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
    });
  }

  next();
};

/**
 * Validator for POST /admin/webhooks/:id/reconcile-request
 * (Admin A creates a pending maker-checker approval request)
 */
export const validateCreateReconciliationRequest = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: ['Request body must be a JSON object'],
    });
  }

  const errors = [];
  const { reason } = req.body;

  // Disallow client-side financial overrides
  const forbiddenKeys = ['amount', 'balance', 'creditAmount', 'status', 'userId', 'walletId', 'effectiveAmount'];
  for (const key of forbiddenKeys) {
    if (key in req.body) {
      errors.push(`Field '${key}' is not permitted; reconciliation requests cannot fabricate financial balances`);
    }
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    errors.push('A detailed justification reason (minimum 10 characters) is required');
  } else if (reason.trim().length > 1000) {
    errors.push('Justification reason cannot exceed 1000 characters');
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }
  next();
};

/**
 * Validator for POST /admin/reconcile-requests/:requestId/approve|reject
 * (Admin B reviews a pending request)
 */
export const validateReviewReconciliationRequest = (req, res, next) => {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    const { reviewNote } = req.body;
    if (reviewNote !== undefined && reviewNote !== null) {
      if (typeof reviewNote !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: ['reviewNote must be a string'],
        });
      }
      if (String(reviewNote).trim().length > 1000) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: ['reviewNote cannot exceed 1000 characters'],
        });
      }
    }
  }
  next();
};

export default {
  validateAdminReconcileWebhook,
  validateCreateReconciliationRequest,
  validateReviewReconciliationRequest,
};
