import {
  getWalletByUserId,
  getPendingWithdrawalAmountByUserId,
  getTransactionsByUserId,
  createDepositIntent,
  verifyDeposit,
  reconcileDepositRecord,
  reconcileWithdrawalRefund,
  getDepositsByUserId,
  createWithdrawalRequest,
  cancelWithdrawalRequest,
  getWithdrawalsByUserId,
  getAllWithdrawalsAdmin,
  getWithdrawalByIdAdmin,
  getQuarantinedWithdrawalsAdmin,
  resolveQuarantinedWithdrawalAdmin,
  approveWithdrawalAdmin,
  rejectWithdrawalAdmin,
  updateWithdrawalStatusAdmin,
} from '../services/walletService.js';

/**
 * Wallet Controller - Handles HTTP requests for Wallet balances, deposits, withdrawals, and admin review
 */

/**
 * Get current authenticated user's wallet
 * @route GET /api/v1/wallet
 */
export const getWallet = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const wallet = await getWalletByUserId(userId);
    const pendingWithdrawalAmount = await getPendingWithdrawalAmountByUserId(userId);

    const walletData = typeof wallet.toJSON === 'function' ? wallet.toJSON() : { ...wallet };
    walletData.pendingWithdrawalAmount = pendingWithdrawalAmount;
    walletData.withdrawableBalance = wallet.balance;

    return res.status(200).json({
      success: true,
      wallet: walletData,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current authenticated user's wallet transaction history
 * @route GET /api/v1/wallet/transactions
 */
export const getTransactions = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { page, limit } = req.query;

    const result = await getTransactionsByUserId(userId, { page, limit });

    return res.status(200).json({
      success: true,
      count: result.transactions.length,
      total: result.total,
      page: result.page,
      pages: result.pages,
      transactions: result.transactions,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new deposit intent
 * @route POST /api/v1/wallet/deposit/intent
 */
export const createDepositIntentController = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { amount, provider, idempotencyKey } = req.body;

    const result = await createDepositIntent(userId, {
      amount,
      provider,
      idempotencyKey,
    });

    return res.status(201).json({
      success: true,
      message: 'Deposit intent created successfully',
      data: result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Verify deposit and credit wallet balance
 * @route POST /api/v1/wallet/deposit/verify
 */
export const verifyDepositController = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { depositReference, orderId, paymentId, signature } = req.body;

    const result = await verifyDeposit(userId, {
      depositReference,
      orderId,
      paymentId,
      signature,
    });

    return res.status(200).json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Get current authenticated user's deposit history
 * @route GET /api/v1/wallet/deposits
 */
export const getDepositsController = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { page, limit } = req.query;

    const result = await getDepositsByUserId(userId, { page, limit });

    return res.status(200).json({
      success: true,
      count: result.deposits.length,
      total: result.total,
      page: result.page,
      pages: result.pages,
      deposits: result.deposits,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Submit a withdrawal request with atomic balance reservation
 * @route POST /api/v1/wallet/withdraw
 */
export const createWithdrawalController = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { amount, idempotencyKey, payoutMethod, payoutDetails } = req.body;

    const result = await createWithdrawalRequest(userId, {
      amount,
      idempotencyKey,
      payoutMethod,
      payoutDetails,
    });

    return res.status(201).json({
      success: true,
      message: result.isIdempotent
        ? 'Withdrawal request already accepted (idempotent response)'
        : 'Withdrawal request submitted successfully and funds reserved',
      withdrawal: result.withdrawal,
      wallet: result.wallet,
      isIdempotent: result.isIdempotent,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Cancel a PENDING withdrawal request and restore reserved balance
 * @route POST /api/v1/wallet/withdraw/:id/cancel
 */
export const cancelWithdrawalController = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const result = await cancelWithdrawalRequest(userId, id);
    return res.status(200).json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Get current authenticated user's withdrawal history
 * @route GET /api/v1/wallet/withdrawals
 */
export const getWithdrawalsController = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { page, limit } = req.query;

    const result = await getWithdrawalsByUserId(userId, { page, limit });

    return res.status(200).json({
      success: true,
      count: result.withdrawals.length,
      total: result.total,
      page: result.page,
      pages: result.pages,
      withdrawals: result.withdrawals,
    });
  } catch (error) {
    next(error);
  }
};

/* ==========================================================================
   ADMIN CONTROLLER HANDLERS
   ========================================================================== */

/**
 * Admin: List all withdrawal requests
 * @route GET /api/v1/wallet/admin/withdrawals
 */
export const getAllWithdrawalsAdminController = async (req, res, next) => {
  try {
    const { status, page, limit } = req.query;

    const result = await getAllWithdrawalsAdmin({ status, page, limit });

    return res.status(200).json({
      success: true,
      count: result.withdrawals.length,
      total: result.total,
      page: result.page,
      pages: result.pages,
      withdrawals: result.withdrawals,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Fetch single withdrawal details and ledger entries
 * @route GET /api/v1/wallet/admin/withdrawals/:id
 */
export const getWithdrawalByIdAdminController = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await getWithdrawalByIdAdmin(id);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Admin: Approve a withdrawal request
 * @route PATCH /api/v1/wallet/admin/withdrawals/:id/approve
 */
export const approveWithdrawalAdminController = async (req, res, next) => {
  try {
    const adminId = req.user._id;
    const { id } = req.params;

    const result = await approveWithdrawalAdmin(adminId, id);
    return res.status(200).json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Admin: Reject a withdrawal request with reason
 * @route PATCH /api/v1/wallet/admin/withdrawals/:id/reject
 */
export const rejectWithdrawalAdminController = async (req, res, next) => {
  try {
    const adminId = req.user._id;
    const { id } = req.params;
    const { reason } = req.body;

    const result = await rejectWithdrawalAdmin(adminId, id, reason);
    return res.status(200).json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Admin: Advance withdrawal status (e.g. PROCESSING, COMPLETED, FAILED)
 * @route PATCH /api/v1/wallet/admin/withdrawals/:id/status
 */
export const updateWithdrawalStatusAdminController = async (req, res, next) => {
  try {
    const adminId = req.user._id;
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    const result = await updateWithdrawalStatusAdmin(adminId, id, { status, adminNotes });
    return res.status(200).json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Admin action to discover, audit, and reconcile an interrupted deposit
 * @route POST /api/v1/wallet/admin/deposits/:depositReference/reconcile
 */
export const reconcileDepositAdminController = async (req, res, next) => {
  try {
    const { depositReference } = req.params;
    const result = await reconcileDepositRecord(depositReference);
    return res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Admin action to discover, audit, and reconcile an interrupted withdrawal refund
 * @route POST /api/v1/wallet/admin/withdrawals/:id/reconcile
 */
export const reconcileWithdrawalAdminController = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await reconcileWithdrawalRefund(id);
    return res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Admin: List withdrawals quarantined for manual administrative reconciliation
 * @route GET /api/v1/wallet/admin/withdrawals/quarantined
 */
export const getQuarantinedWithdrawalsAdminController = async (req, res, next) => {
  try {
    const { page, limit } = req.query;

    const result = await getQuarantinedWithdrawalsAdmin({ page, limit });

    return res.status(200).json({
      success: true,
      count: result.withdrawals.length,
      total: result.total,
      page: result.page,
      pages: result.pages,
      withdrawals: result.withdrawals,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Auditable manual resolution of a quarantined withdrawal refund
 * @route POST /api/v1/wallet/admin/withdrawals/:id/resolve-quarantine
 */
export const resolveQuarantinedWithdrawalAdminController = async (req, res, next) => {
  try {
    const adminId = req.user._id;
    const { id } = req.params;
    const {
      decision,
      reason,
      secondReviewerId,
      confirmedBalanceBefore,
      confirmedBalanceAfter,
    } = req.body;

    const ipAddress = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || '';

    const result = await resolveQuarantinedWithdrawalAdmin(adminId, id, {
      decision,
      reason,
      secondReviewerId,
      confirmedBalanceBefore,
      confirmedBalanceAfter,
      ipAddress,
    });

    return res.status(200).json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

export default {
  getWallet,
  getTransactions,
  createDepositIntentController,
  verifyDepositController,
  reconcileDepositAdminController,
  reconcileWithdrawalAdminController,
  getDepositsController,
  createWithdrawalController,
  cancelWithdrawalController,
  getWithdrawalsController,
  getAllWithdrawalsAdminController,
  getWithdrawalByIdAdminController,
  getQuarantinedWithdrawalsAdminController,
  resolveQuarantinedWithdrawalAdminController,
  approveWithdrawalAdminController,
  rejectWithdrawalAdminController,
  updateWithdrawalStatusAdminController,
};
