/**
 * ============================================================================
 * VALIDATE PRODUCTION ENV TESTS
 * File: server/tests/validateEnv.test.js
 * ============================================================================
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateProductionEnv } from '../src/config/validateEnv.js';

// Valid production-like env (no placeholder words in any value)
const VALID_PROD_ENV = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb+srv://user:pw@cluster.mongodb.net/db?retryWrites=true',
  RAZORPAY_KEY_ID: 'rzp_live_actualKey123456',
  RAZORPAY_KEY_SECRET: 'rzp_live_realkey_abcdef123456xyz',
  RAZORPAY_WEBHOOK_SECRET: 'a_strong_webhook_token_at_least_32_chars_long', // 46 chars, no placeholder
  CLIENT_URL: 'https://app.treadexmine.com',
};

/** Helper: run validateProductionEnv and return thrown error, or null */
const tryValidate = (env) => {
  try {
    validateProductionEnv(env);
    return null;
  } catch (e) {
    return e;
  }
};

describe('validateProductionEnv', () => {
  describe('non-production environments (always pass)', () => {
    it('passes with NODE_ENV=development', () => {
      assert.equal(tryValidate({ NODE_ENV: 'development' }), null);
    });

    it('passes with NODE_ENV=test', () => {
      assert.equal(tryValidate({ NODE_ENV: 'test' }), null);
    });

    it('passes with no NODE_ENV', () => {
      assert.equal(tryValidate({}), null);
    });

    it('passes even when all production vars are missing in development', () => {
      assert.equal(tryValidate({ NODE_ENV: 'development' }), null);
    });
  });

  describe('production — valid config', () => {
    it('does not throw when all required production vars are present and valid', () => {
      assert.equal(tryValidate(VALID_PROD_ENV), null);
    });
  });

  describe('production — missing MONGODB_URI', () => {
    it('throws ERR_ENV_INVALID', () => {
      const env = { ...VALID_PROD_ENV };
      delete env.MONGODB_URI;
      const err = tryValidate(env);
      assert.ok(err, 'Expected an error');
      assert.equal(err.code, 'ERR_ENV_INVALID');
      assert.match(err.message, /MONGODB_URI/);
    });

    it('throws when MONGODB_URI is empty string', () => {
      const err = tryValidate({ ...VALID_PROD_ENV, MONGODB_URI: '' });
      assert.ok(err);
      assert.equal(err.code, 'ERR_ENV_INVALID');
    });
  });

  describe('production — missing CLIENT_URL', () => {
    it('throws ERR_ENV_INVALID', () => {
      const env = { ...VALID_PROD_ENV };
      delete env.CLIENT_URL;
      const err = tryValidate(env);
      assert.ok(err);
      assert.equal(err.code, 'ERR_ENV_INVALID');
      assert.match(err.message, /CLIENT_URL/);
    });
  });

  describe('production — missing Razorpay KEY_ID', () => {
    it('throws ERR_ENV_INVALID', () => {
      const env = { ...VALID_PROD_ENV };
      delete env.RAZORPAY_KEY_ID;
      const err = tryValidate(env);
      assert.ok(err);
      assert.equal(err.code, 'ERR_ENV_INVALID');
      assert.match(err.message, /RAZORPAY_KEY_ID/);
    });
  });

  describe('production — missing Razorpay KEY_SECRET', () => {
    it('throws ERR_ENV_INVALID', () => {
      const env = { ...VALID_PROD_ENV };
      delete env.RAZORPAY_KEY_SECRET;
      const err = tryValidate(env);
      assert.ok(err);
      assert.equal(err.code, 'ERR_ENV_INVALID');
      assert.match(err.message, /RAZORPAY_KEY_SECRET/);
    });
  });

  describe('production — weak RAZORPAY_WEBHOOK_SECRET', () => {
    it('throws when webhook token is shorter than 32 characters', () => {
      const err = tryValidate({ ...VALID_PROD_ENV, RAZORPAY_WEBHOOK_SECRET: 'tooshort' });
      assert.ok(err);
      assert.equal(err.code, 'ERR_ENV_INVALID');
      assert.match(err.message, /WEBHOOK_SECRET/i);
    });

    it('accepts exactly 32-character webhook token', () => {
      const err = tryValidate({
        ...VALID_PROD_ENV,
        RAZORPAY_WEBHOOK_SECRET: 'exactly32charslong_abcdefghijklm', // 32 chars
      });
      assert.equal(err, null, 'Exactly 32-char webhook token should be accepted');
    });
  });

  describe('production — placeholder Razorpay keys', () => {
    it('throws when RAZORPAY_KEY_ID is rzp_test_... (test key in production)', () => {
      const err = tryValidate({ ...VALID_PROD_ENV, RAZORPAY_KEY_ID: 'rzp_test_somekey123' });
      assert.ok(err);
      assert.equal(err.code, 'ERR_ENV_INVALID');
    });

    it('throws when RAZORPAY_KEY_ID contains "placeholder"', () => {
      const err = tryValidate({ ...VALID_PROD_ENV, RAZORPAY_KEY_ID: 'rzp_live_placeholder_key' });
      assert.ok(err);
      assert.equal(err.code, 'ERR_ENV_INVALID');
    });

    it('throws when RAZORPAY_WEBHOOK_SECRET contains "placeholder"', () => {
      const err = tryValidate({
        ...VALID_PROD_ENV,
        RAZORPAY_WEBHOOK_SECRET: 'rzp_webhook_placeholder_at_least_32_chars',
      });
      assert.ok(err);
      assert.equal(err.code, 'ERR_ENV_INVALID');
    });
  });

  describe('production — multiple violations in a single error', () => {
    it('reports all violations in one aggregated error message', () => {
      const err = tryValidate({ NODE_ENV: 'production' });
      assert.ok(err);
      assert.equal(err.code, 'ERR_ENV_INVALID');
      // Should mention at least MONGODB_URI and RAZORPAY
      assert.match(err.message, /MONGODB_URI/);
      assert.match(err.message, /RAZORPAY/);
      assert.match(err.message, /CLIENT_URL/);
      // Multiple violations reported
      const lines = err.message.split('\n').filter((l) => l.trim().startsWith('1.') || l.trim().match(/^\d+\./));
      assert.ok(lines.length >= 3, `Expected >= 3 numbered violations, got: ${err.message}`);
    });
  });
});
