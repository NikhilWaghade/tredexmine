import { Router } from 'express';
import {
  getMyReferrals,
  getMyReferralHistory,
  validateCode,
} from '../controllers/referralController.js';
import { protect } from '../middleware/protect.js';
import { referralValidationLimiter } from '../middleware/rateLimiters.js';

const router = Router();

// Public validation endpoint (rate-limited to 30 req / 15 min per IP)
router.get('/validate/:code', referralValidationLimiter, validateCode);

// Authenticated referral dashboard endpoints
router.get('/me', protect, getMyReferrals);
router.get('/history', protect, getMyReferralHistory);

export default router;

