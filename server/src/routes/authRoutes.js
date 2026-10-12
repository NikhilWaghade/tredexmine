import { Router } from 'express';
import {
  register,
  login,
  refresh,
  logout,
  getMe,
} from '../controllers/auth/index.js';
import {
  registerValidation,
  loginValidation,
} from '../validators/index.js';
import { protect } from '../middleware/index.js';

const router = Router();

// Public routes
router.post('/register', registerValidation, register);
router.post('/login', loginValidation, login);
router.post('/refresh', refresh);
router.post('/logout', logout);

// Protected routes
router.get('/me', protect, getMe);

export default router;
