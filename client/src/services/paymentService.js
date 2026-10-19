import api from './api';

/**
 * Payment Service - Handles Razorpay UPI checkout integration
 */

/**
 * Dynamically load Razorpay standard checkout script
 * @returns {Promise<boolean>}
 */
export const loadRazorpayScript = () => {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      console.error('[PaymentService] Failed to load Razorpay checkout script');
      resolve(false);
    };
    document.body.appendChild(script);
  });
};

/**
 * Create a new payment order for a selected plan
 * @param {string} planId - MongoDB Plan ObjectId
 * @returns {Promise<Object>}
 */
export const createPaymentOrder = async (planId) => {
  const response = await api.post('/payments/create-order', { planId });
  return response.data;
};

/**
 * Verify payment signature and activate plan
 * @param {Object} verificationData
 * @param {string} verificationData.orderId - Gateway order ID
 * @param {string} verificationData.paymentId - Gateway payment ID
 * @param {string} verificationData.signature - Cryptographic signature
 * @returns {Promise<Object>}
 */
export const verifyPayment = async ({ orderId, paymentId, signature }) => {
  const response = await api.post('/payments/verify', {
    orderId,
    paymentId,
    signature,
  });
  return response.data;
};

/**
 * Fetch public payment configuration (Razorpay Key ID)
 * @returns {Promise<Object>}
 */
export const getPaymentConfig = async () => {
  const response = await api.get('/payments/config');
  return response.data;
};

/**
 * Retrieve status of a payment order
 * @param {string} orderId
 * @returns {Promise<Object>}
 */
export const getOrderStatus = async (orderId) => {
  const response = await api.get(`/payments/order/${orderId}`);
  return response.data;
};

export default {
  loadRazorpayScript,
  createPaymentOrder,
  verifyPayment,
  getPaymentConfig,
  getOrderStatus,
};
