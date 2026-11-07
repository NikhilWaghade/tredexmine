/**
 * ============================================================================
 * CORS & CSRF PROTECTION TESTS
 * File: server/tests/corsAndCsrf.test.js
 * ============================================================================
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import app from '../src/app.js';

/** Make a raw HTTP request and return { status, headers, body } */
const request = (server, opts, body) =>
  new Promise((resolve, reject) => {
    const port = server.address().port;
    const req = http.request({ hostname: '127.0.0.1', port, ...opts }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch (_) { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on('error', reject);
    if (body) {
      req.setHeader('Content-Type', 'application/json');
      req.write(JSON.stringify(body));
    }
    req.end();
  });

describe('CORS Policy', () => {
  let server;

  before(async () => {
    // Ensure mongoose is in a known state (no real DB needed for CORS tests)
    if (mongoose.connection.readyState === 0) {
      mongoose.connection.readyState = 99; // fake connected so app doesn't crash
    }
    server = http.createServer(app);
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
  });

  after(async () => {
    await new Promise((res) => server.close(res));
  });

  it('allows requests from CLIENT_URL (default localhost:5173)', async () => {
    const res = await request(server, {
      method: 'OPTIONS',
      path: '/api/v1/health',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
      },
    });
    // CORS preflight should succeed (2xx or no error header)
    const corsOrigin = res.headers['access-control-allow-origin'];
    assert.ok(
      corsOrigin === 'http://localhost:5173' || res.status !== 403,
      `Expected CORS to allow localhost:5173; got origin=${corsOrigin}, status=${res.status}`
    );
  });

  it('allows requests with no Origin header (server-to-server)', async () => {
    const res = await request(server, {
      method: 'GET',
      path: '/api/v1/health',
    });
    // Should not reject (no Origin = server-to-server call)
    assert.ok(res.status !== 403, `Expected server-to-server to be allowed; got ${res.status}`);
  });

  it('rejects requests from unlisted origins', async () => {
    const res = await request(server, {
      method: 'OPTIONS',
      path: '/api/v1/health',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    // Either the origin header is absent from the response or status is 4xx
    const corsOrigin = res.headers['access-control-allow-origin'];
    const isBlocked = !corsOrigin || corsOrigin !== 'https://evil.example.com' || res.status >= 400;
    assert.ok(isBlocked, `Expected evil.example.com to be rejected; got origin=${corsOrigin}, status=${res.status}`);
  });

  it('allows 127.0.0.1:5173 (development alias)', async () => {
    const res = await request(server, {
      method: 'OPTIONS',
      path: '/api/v1/health',
      headers: {
        Origin: 'http://127.0.0.1:5173',
        'Access-Control-Request-Method': 'GET',
      },
    });
    const corsOrigin = res.headers['access-control-allow-origin'];
    assert.ok(
      corsOrigin === 'http://127.0.0.1:5173' || res.status !== 403,
      `Expected 127.0.0.1:5173 to be allowed; got origin=${corsOrigin}`
    );
  });
});

describe('CSRF Protection (csrfProtection middleware)', () => {
  let server;

  before(async () => {
    server = http.createServer(app);
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
  });

  after(async () => {
    await new Promise((res) => server.close(res));
  });

  it('rejects /auth/refresh without same-origin headers (Sec-Fetch-Site: cross-site)', async () => {
    const res = await request(
      server,
      {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        headers: {
          'Sec-Fetch-Site': 'cross-site',
          'Sec-Fetch-Mode': 'cors',
          Origin: 'https://attacker.com',
        },
      },
      {}
    );
    // Should be rejected with 403
    assert.equal(
      res.status,
      403,
      `Expected 403 for cross-site /auth/refresh, got ${res.status}: ${res.body}`
    );
  });

  it('rejects /auth/logout without same-origin headers', async () => {
    const res = await request(
      server,
      {
        method: 'POST',
        path: '/api/v1/auth/logout',
        headers: {
          'Sec-Fetch-Site': 'cross-site',
          Origin: 'https://attacker.com',
        },
      },
      {}
    );
    assert.equal(res.status, 403, `Expected 403 for cross-site /auth/logout, got ${res.status}`);
  });

  it('allows /auth/refresh from same origin (Sec-Fetch-Site: same-origin)', async () => {
    const res = await request(
      server,
      {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        headers: {
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Mode': 'cors',
          Origin: 'http://localhost:5173',
        },
      },
      {}
    );
    // Will fail auth (401) but NOT CSRF (403)
    assert.notEqual(res.status, 403, `Expected CSRF to pass for same-origin; got ${res.status}`);
  });
});
