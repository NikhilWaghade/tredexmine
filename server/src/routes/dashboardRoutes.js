import { Router } from 'express';
import { getDashboard } from '../controllers/dashboardController.js';
import { protect } from '../middleware/index.js';

const router = Router();

// GET /api/v1/dashboard - Protected user dashboard endpoint
router.get('/', protect, getDashboard);

export default router;
