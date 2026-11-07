import { Router } from 'express';
import {
  createOrder,
  verifyPayment,
  getConfig,
  getOrderStatus,
  handleWebhook,
  getQuarantinedWebhooksAdminController,
  resolveQuarantinedWebhookAdminController,
  createReconciliationRequestController,
  listReconciliationRequestsController,
  getReconciliationRequestController,
  reviewReconciliationRequestController,
} from '../controllers/paymentController.js';
import { protect, authorize } from '../middleware/index.js';
import {
  validateAdminReconcileWebhook,
  validateCreateReconciliationRequest,
  validateReviewReconciliationRequest,
} from '../validators/index.js';
import { financialLimiter, adminReconcileLimiter } from '../middleware/rateLimiters.js';

const router = Router();

// Asynchronous Webhook route (authenticated cryptographically via HMAC-SHA256 signature)
router.post('/webhook', handleWebhook);

// Admin Webhook Quarantine Management Routes (Strictly requires authenticated admin role)
router.get(
  '/admin/webhooks/quarantined',
  protect,
  authorize('admin'),
  getQuarantinedWebhooksAdminController
);

// Existing single-request reconcile routes (preserved for backward compatibility and low-value events)
router.post(
  '/admin/webhooks/:id/reconcile',
  protect,
  authorize('admin'),
  adminReconcileLimiter,
  validateAdminReconcileWebhook,
  resolveQuarantinedWebhookAdminController
);

router.post(
  '/admin/webhooks/:id/resolve-quarantine',
  protect,
  authorize('admin'),
  adminReconcileLimiter,
  validateAdminReconcileWebhook,
  resolveQuarantinedWebhookAdminController
);

// ── Maker-Checker Two-Step Approval Routes ───────────────────────────────────
// Step 1 (Admin A): Create a pending approval request for high-value events
router.post(
  '/admin/webhooks/:id/reconcile-request',
  protect,
  authorize('admin'),
  adminReconcileLimiter,
  validateCreateReconciliationRequest,
  createReconciliationRequestController
);

// List / inspect pending requests (visible to any admin)
router.get(
  '/admin/reconcile-requests',
  protect,
  authorize('admin'),
  listReconciliationRequestsController
);

router.get(
  '/admin/reconcile-requests/:requestId',
  protect,
  authorize('admin'),
  getReconciliationRequestController
);

// Step 2 (Admin B): Approve or reject a pending request
router.post(
  '/admin/reconcile-requests/:requestId/approve',
  protect,
  authorize('admin'),
  adminReconcileLimiter,
  validateReviewReconciliationRequest,
  reviewReconciliationRequestController
);

router.post(
  '/admin/reconcile-requests/:requestId/reject',
  protect,
  authorize('admin'),
  adminReconcileLimiter,
  validateReviewReconciliationRequest,
  reviewReconciliationRequestController
);

// Protected user routes
router.get('/config', protect, getConfig);
router.post('/create-order', protect, financialLimiter, createOrder);
router.post('/verify', protect, financialLimiter, verifyPayment);
router.get('/order/:orderId', protect, getOrderStatus);

export default router;
