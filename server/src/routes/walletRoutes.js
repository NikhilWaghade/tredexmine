import { Router } from 'express';
import {
  getWallet,
  getTransactions,
  createDepositIntentController,
  verifyDepositController,
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
  reconcileDepositAdminController,
  reconcileWithdrawalAdminController,
} from '../controllers/walletController.js';
import { handleWebhook } from '../controllers/paymentController.js';
import { protect, authorize } from '../middleware/index.js';
import {
  validateDepositIntent,
  validateDepositVerify,
  validateWithdrawalRequest,
  validateAdminRejectWithdrawal,
} from '../validators/index.js';
import { financialLimiter } from '../middleware/rateLimiters.js';

const router = Router();

// Asynchronous Provider Webhook route (authenticated cryptographically via HMAC-SHA256 signature)
router.post('/webhook', handleWebhook);

// All subsequent wallet routes require authentication
router.use(protect);

/* ==========================================================================
   ADMIN WITHDRAWAL MANAGEMENT ROUTES (ROLE: ADMIN)
   Must be declared before any dynamic /:id parameter routes to avoid shadowing
   ========================================================================== */
router.get('/admin/withdrawals', authorize('admin'), getAllWithdrawalsAdminController);
router.get('/admin/withdrawals/quarantined', authorize('admin'), getQuarantinedWithdrawalsAdminController);
router.get('/admin/withdrawals/:id', authorize('admin'), getWithdrawalByIdAdminController);
router.patch('/admin/withdrawals/:id/approve', authorize('admin'), approveWithdrawalAdminController);
router.patch(
  '/admin/withdrawals/:id/reject',
  authorize('admin'),
  validateAdminRejectWithdrawal,
  rejectWithdrawalAdminController
);
router.patch('/admin/withdrawals/:id/status', authorize('admin'), updateWithdrawalStatusAdminController);
router.post(
  '/admin/withdrawals/:id/resolve-quarantine',
  authorize('admin'),
  resolveQuarantinedWithdrawalAdminController
);
router.post(
  '/admin/deposits/:depositReference/reconcile',
  authorize('admin'),
  reconcileDepositAdminController
);
router.post(
  '/admin/withdrawals/:id/reconcile',
  authorize('admin'),
  reconcileWithdrawalAdminController
);

/* ==========================================================================
   USER WALLET DEPOSIT & WITHDRAWAL ROUTES
   ========================================================================== */

// Base wallet overview & ledger transactions
router.get('/', getWallet);
router.get('/transactions', getTransactions);

// Deposit endpoints
router.post('/deposit/intent', financialLimiter, validateDepositIntent, createDepositIntentController);
router.post('/deposit/verify', financialLimiter, validateDepositVerify, verifyDepositController);
router.get('/deposits', getDepositsController);

// Withdrawal endpoints
router.post('/withdraw', financialLimiter, validateWithdrawalRequest, createWithdrawalController);
router.get('/withdrawals', getWithdrawalsController);
router.post('/withdraw/:id/cancel', cancelWithdrawalController);

export default router;
