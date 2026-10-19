import paymentService from '../services/paymentService.js';

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
    const rawBody = req.rawBody || JSON.stringify(req.body);

    if (!signature) {
      return res.status(400).json({
        success: false,
        message: 'Webhook signature header missing',
      });
    }

    const result = await paymentService.handleWebhookEvent(rawBody, signature, req.body);

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

export default {
  createOrder,
  verifyPayment,
  getConfig,
  getOrderStatus,
  handleWebhook,
};
