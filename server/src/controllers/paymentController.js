import paymentService from '../services/paymentService.js';
import {
  getQuarantinedWebhookEventsAdmin,
  resolveQuarantinedWebhookEventAdmin,
} from '../services/webhookReconciliationService.js';
import {
  createReconciliationRequest,
  reviewReconciliationRequest,
  getPendingReconciliationRequests,
  getReconciliationRequestById,
} from '../services/reconciliationRequestService.js';

/**
 * Payment Controller - Handles HTTP requests for Razorpay payments and webhooks
 */

/**
 * Create a new Razorpay payment order for a selected plan
 * @route POST /api/v1/payments/create-order
 */
export const createOrder = async (req, res, next) => {
  try {
    const { planId } = req.body;
    const userId = req.user._id;

    if (!planId) {
      return res.status(400).json({
        success: false,
        message: 'Plan ID is required to initiate a payment order',
      });
    }

    const orderData = await paymentService.createPaymentOrder(userId, planId);

    return res.status(201).json({
      success: true,
      message: 'Payment order initiated successfully',
      data: orderData,
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
 * Cryptographically verify payment signature and activate plan
 * @route POST /api/v1/payments/verify
 */
export const verifyPayment = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // Support both custom property names and standard Razorpay checkout payload keys
    const orderId = req.body.orderId || req.body.razorpay_order_id;
    const paymentId = req.body.paymentId || req.body.razorpay_payment_id;
    const signature = req.body.signature || req.body.razorpay_signature;

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({
        success: false,
        message: 'orderId (or razorpay_order_id), paymentId (or razorpay_payment_id), and signature are required',
      });
    }

    const result = await paymentService.verifyPayment(userId, {
      orderId,
      paymentId,
      signature,
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      isAlreadyActivated: result.isAlreadyActivated,
      data: {
        userPlan: result.userPlan,
        payment: result.payment,
      },
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
 * Retrieve public payment configuration
 * @route GET /api/v1/payments/config
 */
export const getConfig = async (req, res) => {
  const config = paymentService.getPaymentConfig();
  return res.status(200).json({
    success: true,
    data: config,
  });
};

/**
 * Fetch payment status for a specific gateway order
 * @route GET /api/v1/payments/order/:orderId
 */
export const getOrderStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const userId = req.user._id;

    const payment = await paymentService.getPaymentStatus(orderId, userId);

    return res.status(200).json({
      success: true,
      data: {
        payment,
      },
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
 * Handle incoming asynchronous webhook from Razorpay
 * @route POST /api/v1/payments/webhook
 */
export const handleWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const eventId = req.headers['x-razorpay-event-id'];
    const rawBody = req.rawBody || JSON.stringify(req.body);

    if (!signature) {
      return res.status(400).json({
        success: false,
        message: 'Webhook signature header missing',
      });
    }

    const result = await paymentService.handleWebhookEvent(rawBody, signature, req.body, {
      headers: req.headers,
      eventId,
    });

    if (result.status === 'in_flight' || result.status === 'order_pending' || result.retryable === true) {
      return res.status(503).json({
        success: false,
        message: result.message || result.reason || 'Webhook event is temporarily in-flight or awaiting order persistence',
        result,
      });
    }

    if (result.status === 'quarantined') {
      return res.status(422).json({
        success: false,
        message: result.message || 'Webhook event is quarantined for manual administrative reconciliation',
        result,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Webhook processed successfully',
      result,
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
 * Admin: List quarantined webhook events requiring manual review
 * @route GET /api/v1/payments/admin/webhooks/quarantined
 */
export const getQuarantinedWebhooksAdminController = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await getQuarantinedWebhookEventsAdmin({ page, limit });

    return res.status(200).json({
      success: true,
      count: result.events.length,
      total: result.total,
      page: result.page,
      pages: result.pages,
      events: result.events,
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Reconcile a quarantined webhook event
 * @route POST /api/v1/payments/admin/webhooks/:id/reconcile
 */
export const resolveQuarantinedWebhookAdminController = async (req, res, next) => {
  try {
    const adminId = req.user._id;
    const { id } = req.params;
    const { reason, secondReviewerId } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || '';

    const result = await resolveQuarantinedWebhookEventAdmin(adminId, id, {
      reason,
      secondReviewerId,
      ipAddress,
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      event: result.event,
      auditLog: result.auditLog,
      reconciliation: result.reconciliation,
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
 * Admin A: Create a pending maker-checker reconciliation request
 * @route POST /api/v1/payments/admin/webhooks/:id/reconcile-request
 */
export const createReconciliationRequestController = async (req, res, next) => {
  try {
    const adminId = req.user._id;
    const { id } = req.params;
    const { reason } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || '';

    const request = await createReconciliationRequest(adminId, id, { reason, ipAddress });

    return res.status(201).json({
      success: true,
      message: `Reconciliation approval request created. A second administrator must independently approve it within ${
        Math.round(request.expiresAt - Date.now()) / 3600000
      } hours.`,
      request,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * Admin: List all pending reconciliation requests awaiting review
 * @route GET /api/v1/payments/admin/reconcile-requests
 */
export const listReconciliationRequestsController = async (req, res, next) => {
  try {
    const requests = await getPendingReconciliationRequests();
    return res.status(200).json({ success: true, count: requests.length, requests });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Get a single reconciliation request by ID
 * @route GET /api/v1/payments/admin/reconcile-requests/:requestId
 */
export const getReconciliationRequestController = async (req, res, next) => {
  try {
    const request = await getReconciliationRequestById(req.params.requestId);
    return res.status(200).json({ success: true, request });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * Admin B: Approve or reject a pending reconciliation request
 * @route POST /api/v1/payments/admin/reconcile-requests/:requestId/approve
 * @route POST /api/v1/payments/admin/reconcile-requests/:requestId/reject
 */
export const reviewReconciliationRequestController = async (req, res, next) => {
  try {
    const adminBId = req.user._id;
    const { requestId } = req.params;
    const { reviewNote } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || '';

    // Determine action from URL path segment
    const action = req.path.endsWith('/approve') ? 'approve' : 'reject';

    const result = await reviewReconciliationRequest(adminBId, requestId, action, {
      reviewNote,
      ipAddress,
    });

    return res.status(200).json({
      success: true,
      message: result.message || `Reconciliation request ${action}d successfully`,
      action: result.action,
      ...(result.event ? { event: result.event } : {}),
      ...(result.reconciliation ? { reconciliation: result.reconciliation } : {}),
      ...(result.request ? { request: result.request } : {}),
      requestId: result.requestId || requestId,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export default {
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
};
