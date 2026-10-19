import { Router } from 'express';
import {
  createOrder,
  verifyPayment,
  getConfig,
  getOrderStatus,
  handleWebhook,
} from '../controllers/paymentController.js';
import { protect } from '../middleware/index.js';

const router = Router();

// Asynchronous Webhook route (authenticated cryptographically via HMAC-SHA256 signature)
router.post('/webhook', handleWebhook);

// Protected user routes
router.get('/config', protect, getConfig);
router.post('/create-order', protect, createOrder);
router.post('/verify', protect, verifyPayment);
router.get('/order/:orderId', protect, getOrderStatus);

export default router;
