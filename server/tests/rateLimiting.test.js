/**
 * ============================================================================
 * RATE LIMITING TESTS
 * File: server/tests/rateLimiting.test.js
 * ============================================================================
 *
 * Verifies rate limiter configuration and non-production skip behavior.
 * In production (NODE_ENV=production), limiters actively enforce request caps.
 * In development/test, limiters skip to prevent shared in-memory counter noise.
 * ============================================================================
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  financialLimiter,
  adminReconcileLimiter,
  financialKeyGenerator,
  adminKeyGenerator,
} from '../src/middleware/rateLimiters.js';

describe('Rate Limiter Configuration', () => {
  describe('Middleware presence', () => {
    it('financialLimiter is an Express middleware function', () => {
      assert.equal(typeof financialLimiter, 'function');
    });

    it('adminReconcileLimiter is an Express middleware function', () => {
      assert.equal(typeof adminReconcileLimiter, 'function');
    });

    it('financialLimiter and adminReconcileLimiter are distinct middleware instances', () => {
      assert.notEqual(financialLimiter, adminReconcileLimiter);
    });
  });

  describe('Non-production skip behavior', () => {
    // Tests run with NODE_ENV unset or !== 'production', so skip() === true
    it('financialLimiter passes through in non-production (skip=true)', async () => {
      let nextCalled = false;
      const fakeReq = {
        ip: '127.0.0.1',
        headers: {},
        method: 'POST',
        path: '/deposit/intent',
        rateLimit: undefined,
      };
      const fakeRes = {
        status: () => fakeRes,
        json: () => fakeRes,
        setHeader: () => {},
        getHeader: () => null,
      };
      await financialLimiter(fakeReq, fakeRes, () => { nextCalled = true; });
      assert.ok(nextCalled, 'financialLimiter should call next() when NODE_ENV !== production');
    });

    it('adminReconcileLimiter passes through in non-production (skip=true)', async () => {
      let nextCalled = false;
      const fakeReq = {
        ip: '127.0.0.1',
        headers: {},
        method: 'POST',
        path: '/admin/webhooks/123/reconcile',
        rateLimit: undefined,
      };
      const fakeRes = {
        status: () => fakeRes,
        json: () => fakeRes,
        setHeader: () => {},
        getHeader: () => null,
      };
      await adminReconcileLimiter(fakeReq, fakeRes, () => { nextCalled = true; });
      assert.ok(nextCalled, 'adminReconcileLimiter should call next() when NODE_ENV !== production');
    });

    it('financialLimiter does not accumulate counts in non-production', async () => {
      let calls = 0;
      const fakeReq = {
        ip: '10.0.0.1',
        headers: {},
        method: 'POST',
        path: '/deposit/verify',
        rateLimit: undefined,
      };
      const fakeRes = {
        status: () => fakeRes,
        json: () => {},
        setHeader: () => {},
        getHeader: () => null,
      };
      // Send 20 requests — well above the 10/15min cap
      for (let i = 0; i < 20; i++) {
        await financialLimiter(fakeReq, fakeRes, () => calls++);
      }
      assert.equal(calls, 20, 'All 20 requests should pass through in non-production mode');
    });

    it('adminReconcileLimiter does not accumulate counts in non-production', async () => {
      let calls = 0;
      const fakeReq = {
        ip: '10.0.0.2',
        headers: {},
        method: 'POST',
        path: '/admin/webhooks/abc/resolve-quarantine',
        rateLimit: undefined,
      };
      const fakeRes = {
        status: () => fakeRes,
        json: () => {},
        setHeader: () => {},
        getHeader: () => null,
      };
      for (let i = 0; i < 30; i++) {
        await adminReconcileLimiter(fakeReq, fakeRes, () => calls++);
      }
      assert.equal(calls, 30, 'All 30 requests should pass through in non-production mode');
    });
  });

  describe('Key generator user-isolation vs IP fallback', () => {
    it('financialKeyGenerator isolates authenticated users on the same shared IP', () => {
      const sharedIp = '203.0.113.195';
      const reqUserA = { user: { _id: '64a1b2c3d4e5f6789012345a' }, ip: sharedIp };
      const reqUserB = { user: { _id: '64a1b2c3d4e5f6789012345b' }, ip: sharedIp };
      const reqAnon = { ip: sharedIp };

      const keyA = financialKeyGenerator(reqUserA);
      const keyB = financialKeyGenerator(reqUserB);
      const keyAnon = financialKeyGenerator(reqAnon);

      assert.equal(keyA, 'user_64a1b2c3d4e5f6789012345a');
      assert.equal(keyB, 'user_64a1b2c3d4e5f6789012345b');
      assert.deepEqual(keyAnon, { ip: sharedIp });
      assert.notEqual(keyA, keyB, 'Distinct authenticated users must have distinct keys');
      assert.notEqual(keyA, keyAnon);
    });

    it('adminKeyGenerator isolates authenticated admins on the same IP', () => {
      const ip = '198.51.100.42';
      const reqAdminA = { user: { _id: 'admin_id_alpha' }, ip };
      const reqAdminB = { user: { _id: 'admin_id_beta' }, ip };

      assert.equal(adminKeyGenerator(reqAdminA), 'admin_admin_id_alpha');
      assert.equal(adminKeyGenerator(reqAdminB), 'admin_admin_id_beta');
      assert.notEqual(adminKeyGenerator(reqAdminA), adminKeyGenerator(reqAdminB));
    });
  });
});
