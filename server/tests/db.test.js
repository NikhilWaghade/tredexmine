import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';

describe('Database Connection Module (db.js)', () => {
  let originalConnect;
  let originalConsoleError;
  let originalConsoleLog;
  let loggedErrors = [];
  let loggedMessages = [];

  beforeEach(() => {
    originalConnect = mongoose.connect;
    originalConsoleError = console.error;
    originalConsoleLog = console.log;
    loggedErrors = [];
    loggedMessages = [];
    console.error = (...args) => {
      loggedErrors.push(args.join(' '));
    };
    console.log = (...args) => {
      loggedMessages.push(args.join(' '));
    };
  });

  afterEach(() => {
    mongoose.connect = originalConnect;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
  });

  it('connectDB() logs connection error and rethrows when mongoose.connect fails', async () => {
    const mockError = new Error('Simulated MongoDB connection failure');
    mongoose.connect = async () => {
      throw mockError;
    };

    await assert.rejects(
      async () => {
        await connectDB();
      },
      (err) => {
        assert.strictEqual(err.message, 'Simulated MongoDB connection failure');
        return true;
      }
    );

    // Verify error was logged to console.error
    const foundLoggedError = loggedErrors.some((msg) =>
      msg.includes('[MongoDB] Connection error: Simulated MongoDB connection failure')
    );
    assert.strictEqual(foundLoggedError, true, 'Error should be logged to console.error');
  });

  it('connectDB() returns connection object when mongoose.connect succeeds', async () => {
    const mockConnection = { connection: { host: 'cluster0.mock.mongodb.net' } };
    let connectedUri = null;
    mongoose.connect = async (uri) => {
      connectedUri = uri;
      return mockConnection;
    };

    const prevUri = process.env.MONGODB_URI;
    process.env.MONGODB_URI = 'mongodb://custom-host:27017/custom-db';

    try {
      const conn = await connectDB();
      assert.strictEqual(conn, mockConnection);
      assert.strictEqual(connectedUri, 'mongodb://custom-host:27017/custom-db');
      assert.strictEqual(
        loggedMessages.some((msg) => msg.includes('[MongoDB] Connected successfully: cluster0.mock.mongodb.net')),
        true
      );
    } finally {
      if (prevUri !== undefined) {
        process.env.MONGODB_URI = prevUri;
      } else {
        delete process.env.MONGODB_URI;
      }
    }
  });

  it('connectDB() falls back to default URI when MONGODB_URI is not set', async () => {
    const mockConnection = { connection: { host: 'localhost' } };
    let connectedUri = null;
    mongoose.connect = async (uri) => {
      connectedUri = uri;
      return mockConnection;
    };

    const prevUri = process.env.MONGODB_URI;
    delete process.env.MONGODB_URI;

    try {
      const conn = await connectDB();
      assert.strictEqual(conn, mockConnection);
      assert.strictEqual(connectedUri, 'mongodb://localhost:27017/treadexmine');
    } finally {
      if (prevUri !== undefined) {
        process.env.MONGODB_URI = prevUri;
      }
    }
  });
});
