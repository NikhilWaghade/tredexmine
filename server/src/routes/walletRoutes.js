import { Router } from 'express';
import { getWallet, getTransactions } from '../controllers/walletController.js';
import { protect } from '../middleware/protect.js';

const router = Router();

// All wallet routes require authentication
router.use(protect);

// GET /api/v1/wallet
router.get('/', getWallet);

// GET /api/v1/wallet/transactions
router.get('/transactions', getTransactions);

export default router;
