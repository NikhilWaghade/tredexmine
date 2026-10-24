import { Router } from 'express';
import {
  getPlans,
  getPlanById,
  purchasePlan,
  getMyActivePlans,
  createPlan,
  getAdminPlans,
  getAdminPlanById,
  updatePlan,
  togglePlanStatus,
} from '../controllers/planController.js';
import { protect, authorize } from '../middleware/index.js';
import { createPlanValidation, updatePlanValidation } from '../validators/index.js';

const router = Router();

// Public catalogue route
router.get('/', getPlans);

// Admin-only routes (defined before /:id to prevent route shadowing)
router.get('/admin/all', protect, authorize('admin'), getAdminPlans);
router.get('/admin/:id', protect, authorize('admin'), getAdminPlanById);
router.post('/', protect, authorize('admin'), createPlanValidation, createPlan);
router.put('/:id', protect, authorize('admin'), updatePlanValidation, updatePlan);
router.patch('/:id/status', protect, authorize('admin'), togglePlanStatus);

// User protected routes (defined before /:id to prevent route shadowing)
router.get('/my/active', protect, getMyActivePlans);
router.post('/:id/purchase', protect, purchasePlan);

// Public route for single active plan
router.get('/:id', getPlanById);

export default router;
