import { Router } from 'express';
import {
  register,
  login,
  refresh,
  logout,
  getMe,
  devProvisionAdmin,
} from '../controllers/auth/index.js';
import {
  registerValidation,
  loginValidation,
  devAdminProvisionValidation,
} from '../validators/index.js';
import { protect, devProvisionGuard, validateAuthCsrf } from '../middleware/index.js';

const router = Router();

// Public routes (standard authentication)
router.post('/register', registerValidation, register);
router.post('/login', loginValidation, login);
router.post('/refresh', validateAuthCsrf, refresh);
router.post('/logout', validateAuthCsrf, logout);

// Protected routes
router.get('/me', protect, getMe);

// Development-only guarded admin provisioning
// Permanently disabled in production (returns 404); requires 32-character secret in x-dev-provision-secret header
router.post(
  '/dev-provision-admin',
  devProvisionGuard,
  devAdminProvisionValidation,
  devProvisionAdmin
);

export default router;
