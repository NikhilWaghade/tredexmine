import { Router } from 'express';
import healthRoutes from './healthRoutes.js';

const router = Router();

// Health route: /api/v1/health
router.use('/health', healthRoutes);

export default router;
