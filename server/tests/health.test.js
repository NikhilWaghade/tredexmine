import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../src/app.js';

describe('Health and Middleware Integration Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    process.env.NODE_ENV = 'test';
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('GET /api/v1/health returns 200 and Server Running status', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    assert.strictEqual(response.status, 200);

    const body = await response.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.message, 'Server Running');
  });

  it('GET /api/v1/non-existent returns 404 Route not found response', async () => {
    const response = await fetch(`${baseUrl}/api/v1/non-existent`);
    assert.strictEqual(response.status, 404);

    const body = await response.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.message, 'Resource not found: GET /api/v1/non-existent');
  });

  it('protect middleware rejects unauthenticated access to /api/v1/wallet', async () => {
    const response = await fetch(`${baseUrl}/api/v1/wallet`);
    assert.strictEqual(response.status, 401);

    const body = await response.json();
    assert.strictEqual(body.success, false);
    assert.ok(body.message.includes('Not authorized') || body.message.includes('token'));
  });
});
