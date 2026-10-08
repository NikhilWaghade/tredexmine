import mongoose from 'mongoose';

/**
 * Connect to MongoDB database instance
 */
export const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/treadexmine';

  try {
    const conn = await mongoose.connect(uri);
    console.log(`[MongoDB] Connected successfully: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`[MongoDB] Connection error: ${error.message}`);
    // Do not crash hard in local dev if MongoDB is not running yet
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
};

// Monitor connection events
mongoose.connection.on('disconnected', () => {
  console.warn('[MongoDB] Database connection disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error(`[MongoDB] Database error: ${err.message}`);
});

export default connectDB;
