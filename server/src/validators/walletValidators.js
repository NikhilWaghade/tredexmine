/**
 * Wallet Deposit and Withdrawal Input Validators
 */

/**
 * Validate Deposit Intent Initiation
 */
export const validateDepositIntent = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: ['Request body must be a JSON object'],
    });
  }

  const errors = [];
  const { amount, provider, idempotencyKey } = req.body;

  // Disallow client attempting to dictate status, reference, or balance
  if ('status' in req.body || 'depositReference' in req.body || 'balance' in req.body) {
    errors.push('Client-supplied status, reference, or balance fields are not permitted');
  }

  // Validate amount
  if (amount === undefined || amount === null || typeof amount !== 'number' || !Number.isFinite(amount)) {
    errors.push('Deposit amount must be a valid finite number');
  } else if (amount < 100) {
    errors.push('Minimum deposit amount is ₹100');
  } else if (amount > 500000) {
    errors.push('Maximum deposit amount per transaction is ₹500,000');
  } else if (Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) {
    errors.push('Deposit amount cannot have more than 2 decimal places');
  }

  // Validate provider if provided
  if (provider !== undefined && provider !== null) {
    if (typeof provider !== 'string' || !['razorpay', 'mock'].includes(provider.toLowerCase())) {
      errors.push('Provider must be either "razorpay" or "mock"');
    }
  }

  // Validate idempotencyKey if provided
  if (idempotencyKey !== undefined && idempotencyKey !== null) {
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      errors.push('Idempotency key must be a non-empty string');
    } else if (idempotencyKey.trim().length > 255) {
      errors.push('Idempotency key cannot exceed 255 characters');
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
 * Validate Deposit Verification
 */
export const validateDepositVerify = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: ['Request body must be a JSON object'],
    });
  }

  const errors = [];
  const { depositReference, signature } = req.body;

  // Disallow client attempting to dictate status, amount, balance, or creditedAt
  if ('status' in req.body || 'amount' in req.body || 'balance' in req.body || 'creditedAt' in req.body) {
    errors.push('Client-supplied status, amount, balance, or creditedAt fields are not permitted');
  }

  if (!depositReference || typeof depositReference !== 'string' || depositReference.trim().length === 0) {
    errors.push('Deposit reference is required');
  }

  if (!signature || typeof signature !== 'string' || signature.trim().length === 0) {
    errors.push('Verification signature is required');
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
 * Validate Withdrawal Request
 */
export const validateWithdrawalRequest = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: ['Request body must be a JSON object'],
    });
  }

  const errors = [];
  const { amount, idempotencyKey, payoutMethod, payoutDetails } = req.body;

  // Disallow client attempting to dictate status, approval, reference, or balance
  if (
    'status' in req.body ||
    'withdrawalReference' in req.body ||
    'balance' in req.body ||
    'reviewedBy' in req.body ||
    'refundIssued' in req.body
  ) {
    errors.push('Client-supplied status, reference, or balance mutation fields are not permitted');
  }

  // Validate amount
  if (amount === undefined || amount === null || typeof amount !== 'number' || !Number.isFinite(amount)) {
    errors.push('Withdrawal amount must be a valid finite number');
  } else if (amount < 100) {
    errors.push('Minimum withdrawal amount is ₹100');
  } else if (amount > 500000) {
    errors.push('Maximum withdrawal amount per request is ₹500,000');
  } else if (Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) {
    errors.push('Withdrawal amount cannot have more than 2 decimal places');
  }

  // Mandatory idempotency key
  if (
    idempotencyKey === undefined ||
    idempotencyKey === null ||
    typeof idempotencyKey !== 'string' ||
    idempotencyKey.trim().length === 0
  ) {
    errors.push('Idempotency key is required for withdrawal request');
  } else if (idempotencyKey.trim().length > 255) {
    errors.push('Idempotency key cannot exceed 255 characters');
  }

  // Validate payout method
  if (payoutMethod !== undefined && payoutMethod !== null) {
    if (typeof payoutMethod !== 'string' || !['upi', 'bank_transfer'].includes(payoutMethod.toLowerCase())) {
      errors.push('Payout method must be either "upi" or "bank_transfer"');
    }
  }

  // Validate payoutDetails
  if (payoutDetails !== undefined && payoutDetails !== null) {
    if (typeof payoutDetails !== 'object' || Array.isArray(payoutDetails)) {
      errors.push('Payout details must be an object');
    } else {
      const method = (payoutMethod || 'upi').toLowerCase();
      if (method === 'upi') {
        const upi = payoutDetails.identifier || payoutDetails.upiId;
        if (upi !== undefined && upi !== null) {
          if (typeof upi !== 'string' || upi.trim().length === 0) {
            errors.push('UPI identifier must be a non-empty string');
          } else if (!/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z0-9]{2,64}$/.test(upi.trim())) {
            errors.push('Invalid UPI ID format (expected username@bank)');
          }
        }
      } else if (method === 'bank_transfer') {
        const { accountNumber, ifscCode, accountHolderName } = payoutDetails;
        if (accountNumber !== undefined && accountNumber !== null) {
          if (typeof accountNumber !== 'string' || !/^\d{9,18}$/.test(accountNumber.trim())) {
            errors.push('Bank account number must be between 9 and 18 digits');
          }
        }
        if (ifscCode !== undefined && ifscCode !== null) {
          if (typeof ifscCode !== 'string' || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode.trim().toUpperCase())) {
            errors.push('Invalid IFSC code format (e.g. SBIN0123456)');
          }
        }
        if (accountHolderName !== undefined && accountHolderName !== null) {
          if (typeof accountHolderName !== 'string' || accountHolderName.trim().length === 0) {
            errors.push('Account holder name must be a non-empty string');
          }
        }
      }
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
 * Validate Admin Withdrawal Rejection
 */
export const validateAdminRejectWithdrawal = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: ['Request body must be a JSON object'],
    });
  }

  const { reason } = req.body;
  if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: ['Rejection reason is required (minimum 3 characters)'],
    });
  }

  if (reason.trim().length > 500) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: ['Rejection reason cannot exceed 500 characters'],
    });
  }

  next();
};

export default {
  validateDepositIntent,
  validateDepositVerify,
  validateWithdrawalRequest,
  validateAdminRejectWithdrawal,
};
