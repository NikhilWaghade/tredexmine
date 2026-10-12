import { Router } from 'express';
import healthRoutes from './healthRoutes.js';
import authRoutes from './authRoutes.js';
import walletRoutes from './walletRoutes.js';

const router = Router();

// Health route: /api/v1/health
router.use('/health', healthRoutes);

// Auth routes: /api/v1/auth/*
router.use('/auth', authRoutes);

// Wallet routes: /api/v1/wallet/*
router.use('/wallet', walletRoutes);

export default router;
