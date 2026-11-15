import { Router } from 'express';
import {
  getAdminOverviewController,
  getAllUsersAdminController,
  getActiveInvestmentsAdminController,
  getAllWalletsAdminController,
  getAllDepositsAdminController,
  getAllReferralsAdminController,
  getAllPaymentsAdminController,
} from '../controllers/adminController.js';
import { protect, authorize } from '../middleware/index.js';

const router = Router();

// Strict security: all admin routes require authenticated session with admin role
router.use(protect);
router.use(authorize('admin'));

router.get('/overview', getAdminOverviewController);
router.get('/users', getAllUsersAdminController);
router.get('/active-investments', getActiveInvestmentsAdminController);
router.get('/wallets', getAllWalletsAdminController);
router.get('/deposits', getAllDepositsAdminController);
router.get('/referrals', getAllReferralsAdminController);
router.get('/payments', getAllPaymentsAdminController);

export default router;

