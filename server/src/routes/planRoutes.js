import { Router } from 'express';
import {
  getPlans,
  getPlanById,
  purchasePlan,
  getMyActivePlans,
  createPlan,
} from '../controllers/planController.js';
import { protect, authorize } from '../middleware/index.js';
import { createPlanValidation } from '../validators/index.js';

const router = Router();

// Public routes
router.get('/', getPlans);

// Admin route to create a plan (defined before /:id to prevent route shadowing)
router.post('/', protect, authorize('admin'), createPlanValidation, createPlan);

// Protected routes (defined before /:id to prevent route shadowing)
router.get('/my/active', protect, getMyActivePlans);
router.post('/:id/purchase', protect, purchasePlan);

// Public route for single plan
router.get('/:id', getPlanById);

export default router;
