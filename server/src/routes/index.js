import { Router } from 'express';
import healthRoutes from './healthRoutes.js';
import authRoutes from './authRoutes.js';
import walletRoutes from './walletRoutes.js';
import planRoutes from './planRoutes.js';
import paymentRoutes from './paymentRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';

const router = Router();

// Health route: /api/v1/health
router.use('/health', healthRoutes);

// Auth routes: /api/v1/auth/*
router.use('/auth', authRoutes);

// Wallet routes: /api/v1/wallet/*
router.use('/wallet', walletRoutes);

// Plan routes: /api/v1/plans/*
router.use('/plans', planRoutes);

// Payment routes: /api/v1/payments/*
router.use('/payments', paymentRoutes);

// Dashboard routes: /api/v1/dashboard/*
router.use('/dashboard', dashboardRoutes);

export default router;


