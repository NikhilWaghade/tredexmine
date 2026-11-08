// Preload environment variables before any module resolution
import 'dotenv/config';

import app from './app.js';
import { connectDB } from './config/db.js';
import { validateJwtConfig } from './utils/tokenService.js';
import { validateProductionEnv } from './config/validateEnv.js';
import {
  startWebhookReconciliationScheduler,
  stopWebhookReconciliationScheduler,
} from './services/webhookReconciliationService.js';

const PORT = process.env.PORT || 5000;

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception:', err.message);
  process.exit(1);
});

// Initialize database connection and start HTTP server
const startServer = async () => {
  try {
    // 1. Validate all required production environment variables (fails fast)
    validateProductionEnv();

    // 2. Validate environment configuration and JWT secrets before accepting traffic
    validateJwtConfig();

    // 3. Connect to database
    await connectDB();
  } catch (error) {
    console.error(`[Server] Startup validation failed: ${error.message}`);
    process.exit(1);
  }

  // 3. Start bounded background webhook reconciliation scheduler
  startWebhookReconciliationScheduler();

  const server = app.listen(PORT, () => {
    console.log(`[Server] Minetrades backend running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    console.log(`[Health] Health check endpoint available at http://localhost:${PORT}/api/v1/health`);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (err) => {
    console.error('[Process] Unhandled Rejection:', err.message);
    stopWebhookReconciliationScheduler();
    server.close(() => process.exit(1));
  });

  // Graceful shutdown
  const gracefulShutdown = (signal) => {
    console.log(`[Process] ${signal} signal received: closing HTTP server and stopping background scheduler...`);
    stopWebhookReconciliationScheduler();
    server.close(() => {
      console.log('[Process] HTTP server closed gracefully');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
};

startServer();
