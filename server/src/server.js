import dotenv from 'dotenv';
// Load environment variables before any module imports
dotenv.config();

import app from './app.js';
import { connectDB } from './config/db.js';

const PORT = process.env.PORT || 5000;

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception:', err.message);
  process.exit(1);
});

// Initialize database connection and start HTTP server
const startServer = async () => {
  await connectDB();

  const server = app.listen(PORT, () => {
    console.log(`[Server] TreadExMine backend running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    console.log(`[Health] Health check endpoint available at http://localhost:${PORT}/api/v1/health`);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (err) => {
    console.error('[Process] Unhandled Rejection:', err.message);
    server.close(() => process.exit(1));
  });

  // Graceful shutdown
  const gracefulShutdown = (signal) => {
    console.log(`[Process] ${signal} signal received: closing HTTP server...`);
    server.close(() => {
      console.log('[Process] HTTP server closed gracefully');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
};

startServer();
