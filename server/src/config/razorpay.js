import crypto from 'node:crypto';
import Razorpay from 'razorpay';

/**
 * Razorpay Payment Gateway Configuration and Cryptographic Verification Utilities
 */

let razorpayClient = null;

/**
 * Determine if valid, non-placeholder Razorpay credentials are present
 * @returns {boolean}
 */
export const isRazorpayConfigured = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) return false;
  const trimmedId = String(keyId).trim();
  const trimmedSecret = String(keySecret).trim();

  if (!trimmedId || !trimmedSecret) return false;

  const lowerId = trimmedId.toLowerCase();
  const lowerSecret = trimmedSecret.toLowerCase();

  if (
    lowerId === 'undefined' ||
    lowerSecret === 'undefined' ||
    lowerId === 'null' ||
    lowerSecret === 'null' ||
    lowerId.includes('placeholder') ||
    lowerSecret.includes('placeholder') ||
    lowerId.includes('your_') ||
    lowerSecret.includes('your_') ||
    lowerId.includes('dummy') ||
    lowerSecret.includes('dummy') ||
    lowerId.includes('change_me') ||
    lowerSecret.includes('change_me') ||
    lowerId === 'rzp_test_placeholder' ||
    lowerSecret === 'rzp_test_secret_placeholder'
  ) {
    return false;
  }

  return true;
};

/**
 * Retrieve or initialize the singleton Razorpay API client
 * @returns {Razorpay|null}
 */
export const getRazorpayInstance = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return null;
  }

  if (!razorpayClient) {
    razorpayClient = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }

  return razorpayClient;
};

/**
 * Set a custom Razorpay client instance (primarily used for unit/integration testing mocks)
 * @param {Object|null} client
 */
export const setRazorpayInstance = (client) => {
  razorpayClient = client;
};

/**
 * Cryptographically verify payment signature returned by the client-side Razorpay checkout
 * Uses timing-safe string comparison to mitigate side-channel timing attacks.
 *
 * @param {Object} params
 * @param {string} params.orderId - Razorpay order ID
 * @param {string} params.paymentId - Razorpay payment ID
 * @param {string} params.signature - Signature sent from checkout callback
 * @returns {boolean}
 */
export const verifyPaymentSignature = ({ orderId, paymentId, signature }) => {
  if (!orderId || !paymentId || !signature) {
    return false;
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    return false;
  }

  try {
    const payload = `${orderId}|${paymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(payload)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const actualBuffer = Buffer.from(signature, 'utf8');

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  } catch (error) {
    return false;
  }
};

/**
 * Cryptographically verify Razorpay asynchronous webhook signature against the raw request body
 *
 * @param {Object} params
 * @param {Buffer|string} params.rawBody - Raw request body buffer received directly from the gateway
 * @param {string} params.signature - Value of the 'x-razorpay-signature' request header
 * @returns {boolean}
 */
export const verifyWebhookSignature = ({ rawBody, signature }) => {
  if (!rawBody || !signature) {
    return false;
  }

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const actualBuffer = Buffer.from(signature, 'utf8');

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  } catch (error) {
    return false;
  }
};

export default {
  getRazorpayInstance,
  setRazorpayInstance,
  isRazorpayConfigured,
  verifyPaymentSignature,
  verifyWebhookSignature,
};
