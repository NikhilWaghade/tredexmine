import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateJwtConfig,
  getJwtSecret,
  getJwtRefreshSecret,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateAuthTokens,
  DEV_DEFAULT_ACCESS_SECRET,
  DEV_DEFAULT_REFRESH_SECRET,
} from '../src/utils/tokenService.js';

describe('Task A — JWT Secret Hardening & Startup Validation Tests', () => {
  const validProdAccessSecret = 'a_very_strong_production_jwt_access_secret_32_chars_min';
  const validProdRefreshSecret = 'a_very_strong_production_jwt_refresh_secret_32_chars_min';

  /* ==========================================================================
     1. PRODUCTION ENVIRONMENT STRICTNESS & MISSING SECRET CHECKS
     ========================================================================== */
  describe('Production Environment Missing Secrets', () => {
    it('throws ERR_JWT_SECRET_MISSING when JWT_SECRET is missing in production', () => {
      const env = {
        NODE_ENV: 'production',
        JWT_REFRESH_SECRET: validProdRefreshSecret,
      };

      assert.throws(
        () => validateJwtConfig(env),
        (err) => {
          assert.strictEqual(err.code, 'ERR_JWT_SECRET_MISSING');
          assert.match(err.message, /JWT_SECRET is required in production/);
          return true;
        }
      );
    });

    it('throws ERR_JWT_SECRET_MISSING when JWT_SECRET is empty string in production', () => {
      const env = {
        NODE_ENV: 'production',
        JWT_SECRET: '   ',
        JWT_REFRESH_SECRET: validProdRefreshSecret,
      };

      assert.throws(
        () => validateJwtConfig(env),
        (err) => {
          assert.strictEqual(err.code, 'ERR_JWT_SECRET_MISSING');
          return true;
        }
      );
    });

    it('throws ERR_JWT_REFRESH_SECRET_MISSING when JWT_REFRESH_SECRET is missing in production', () => {
      const env = {
        NODE_ENV: 'production',
        JWT_SECRET: validProdAccessSecret,
      };

      assert.throws(
        () => validateJwtConfig(env),
        (err) => {
          assert.strictEqual(err.code, 'ERR_JWT_REFRESH_SECRET_MISSING');
          assert.match(err.message, /JWT_REFRESH_SECRET is required in production/);
          return true;
        }
      );
    });

    it('throws ERR_JWT_REFRESH_SECRET_MISSING when JWT_REFRESH_SECRET is empty string in production', () => {
      const env = {
        NODE_ENV: 'production',
        JWT_SECRET: validProdAccessSecret,
        JWT_REFRESH_SECRET: '',
      };

      assert.throws(
        () => validateJwtConfig(env),
        (err) => {
          assert.strictEqual(err.code, 'ERR_JWT_REFRESH_SECRET_MISSING');
          return true;
        }
      );
    });
  });

  /* ==========================================================================
     2. WEAK SECRET AND KNOWN PLACEHOLDER REJECTION
     ========================================================================== */
  describe('Weak Secrets and Development Placeholders Rejection in Production', () => {
    it('throws ERR_JWT_SECRET_WEAK when JWT_SECRET is shorter than 32 characters', () => {
      const env = {
        NODE_ENV: 'production',
        JWT_SECRET: 'short_key_1234567890', // 20 chars
        JWT_REFRESH_SECRET: validProdRefreshSecret,
      };

      assert.throws(
        () => validateJwtConfig(env),
        (err) => {
          assert.strictEqual(err.code, 'ERR_JWT_SECRET_WEAK');
          assert.match(err.message, /at least 32 characters/);
          return true;
        }
      );
    });

    it('throws ERR_JWT_REFRESH_SECRET_WEAK when JWT_REFRESH_SECRET is shorter than 32 characters', () => {
      const env = {
        NODE_ENV: 'production',
        JWT_SECRET: validProdAccessSecret,
        JWT_REFRESH_SECRET: 'short_refresh_key_123', // 21 chars
      };

      assert.throws(
        () => validateJwtConfig(env),
        (err) => {
          assert.strictEqual(err.code, 'ERR_JWT_REFRESH_SECRET_WEAK');
          assert.match(err.message, /at least 32 characters/);
          return true;
        }
      );
    });

    it('rejects known development fallback secret in production', () => {
      const env = {
        NODE_ENV: 'production',
        JWT_SECRET: DEV_DEFAULT_ACCESS_SECRET,
        JWT_REFRESH_SECRET: validProdRefreshSecret,
      };

      assert.throws(
        () => validateJwtConfig(env),
        (err) => {
          assert.strictEqual(err.code, 'ERR_JWT_SECRET_PLACEHOLDER');
          assert.match(err.message, /cannot use default development placeholders/);
          return true;
        }
      );
    });

    it('rejects known sample placeholder patterns in production', () => {
      const samplePlaceholders = [
        'your_jwt_secret_key_minimum_32_characters_here',
        'your_jwt_secret_key_change_in_production_placeholder_key',
        'change_me_super_long_secret_key_that_exceeds_32_chars_now',
        'placeholder_key_super_secret_for_production_use_12345',
      ];

      for (const placeholder of samplePlaceholders) {
        const env = {
          NODE_ENV: 'production',
          JWT_SECRET: placeholder,
          JWT_REFRESH_SECRET: validProdRefreshSecret,
        };

        assert.throws(
          () => validateJwtConfig(env),
          (err) => {
            assert.strictEqual(err.code, 'ERR_JWT_SECRET_PLACEHOLDER');
            return true;
          },
          `Expected placeholder "${placeholder}" to be rejected`
        );
      }
    });

    it('rejects identical JWT_SECRET and JWT_REFRESH_SECRET in production', () => {
      const env = {
        NODE_ENV: 'production',
        JWT_SECRET: validProdAccessSecret,
        JWT_REFRESH_SECRET: validProdAccessSecret, // Identical
      };

      assert.throws(
        () => validateJwtConfig(env),
        (err) => {
          assert.strictEqual(err.code, 'ERR_JWT_SECRETS_IDENTICAL');
          assert.match(err.message, /must be distinct secrets in production/);
          return true;
        }
      );
    });
  });

  /* ==========================================================================
     3. SECRET LEAKAGE PREVENTION IN LOGS / ERRORS
     ========================================================================== */
  describe('Secret Confidentiality & Log Safety', () => {
    it('never leaks secret values in error messages or codes', () => {
      const sensitiveWeakSecret = 'sensitive_unmasked_weak_secret!';
      const env = {
        NODE_ENV: 'production',
        JWT_SECRET: sensitiveWeakSecret,
        JWT_REFRESH_SECRET: validProdRefreshSecret,
      };

      try {
        validateJwtConfig(env);
        assert.fail('Expected validateJwtConfig to throw');
      } catch (err) {
        assert.strictEqual(err.message.includes(sensitiveWeakSecret), false);
        assert.strictEqual(JSON.stringify(err).includes(sensitiveWeakSecret), false);
      }
    });
  });

  /* ==========================================================================
     4. NODE_ENV VALIDATION AND MISSPELLING GUARDS
     ========================================================================== */
  describe('NODE_ENV Strict Validation', () => {
    it('rejects unknown or misspelled NODE_ENV values to prevent silent dev fallbacks', () => {
      const invalidEnvs = ['prod', 'productionn', 'staging', 'local', 'develop', 'qa', 'live'];

      for (const invalidEnv of invalidEnvs) {
        assert.throws(
          () => validateJwtConfig({ NODE_ENV: invalidEnv }),
          (err) => {
            assert.strictEqual(err.code, 'ERR_INVALID_NODE_ENV');
            assert.match(err.message, /Allowed environments are: "development", "test", "production"/);
            return true;
          },
          `Expected invalid NODE_ENV "${invalidEnv}" to be rejected`
        );
      }
    });

    it('accepts valid NODE_ENV values: development, test, production', () => {
      assert.doesNotThrow(() => validateJwtConfig({ NODE_ENV: 'development' }));
      assert.doesNotThrow(() => validateJwtConfig({ NODE_ENV: 'test' }));
      assert.doesNotThrow(() =>
        validateJwtConfig({
          NODE_ENV: 'production',
          JWT_SECRET: validProdAccessSecret,
          JWT_REFRESH_SECRET: validProdRefreshSecret,
        })
      );
    });
  });

  /* ==========================================================================
     5. VALID PRODUCTION SECRETS AND TOKEN OPERATION
     ========================================================================== */
  describe('Valid Production Configuration & Token Lifecycle', () => {
    const prodEnv = {
      NODE_ENV: 'production',
      JWT_SECRET: validProdAccessSecret,
      JWT_REFRESH_SECRET: validProdRefreshSecret,
    };

    it('accepts valid configured production secrets and returns validated config', () => {
      const config = validateJwtConfig(prodEnv);
      assert.strictEqual(config.nodeEnv, 'production');
      assert.strictEqual(config.jwtSecret, validProdAccessSecret);
      assert.strictEqual(config.jwtRefreshSecret, validProdRefreshSecret);
    });

    it('generates and verifies tokens successfully with production secrets', () => {
      const userPayload = { id: '652a1234567890abcdef1234', role: 'admin' };

      const accessToken = generateAccessToken(userPayload, prodEnv);
      assert.ok(typeof accessToken === 'string' && accessToken.length > 0);

      const decodedAccess = verifyAccessToken(accessToken, prodEnv);
      assert.strictEqual(decodedAccess.id, userPayload.id);
      assert.strictEqual(decodedAccess.role, userPayload.role);

      const refreshToken = generateRefreshToken({ id: userPayload.id }, prodEnv);
      assert.ok(typeof refreshToken === 'string' && refreshToken.length > 0);

      const decodedRefresh = verifyRefreshToken(refreshToken, prodEnv);
      assert.strictEqual(decodedRefresh.id, userPayload.id);
    });

    it('rejects access token signed with dev secret when verifying under production config', () => {
      const userPayload = { id: '652a1234567890abcdef1234', role: 'user' };
      const devToken = generateAccessToken(userPayload, { NODE_ENV: 'development' });

      assert.throws(
        () => verifyAccessToken(devToken, prodEnv),
        (err) => {
          assert.strictEqual(err.name, 'JsonWebTokenError');
          return true;
        }
      );
    });
  });

  /* ==========================================================================
     6. DEVELOPMENT AND TEST USABILITY
     ========================================================================== */
  describe('Development & Test Usability Preserved', () => {
    it('falls back to default development secrets when env vars are missing in development', () => {
      const config = validateJwtConfig({ NODE_ENV: 'development' });
      assert.strictEqual(config.nodeEnv, 'development');
      assert.strictEqual(config.jwtSecret, DEV_DEFAULT_ACCESS_SECRET);
      assert.strictEqual(config.jwtRefreshSecret, DEV_DEFAULT_REFRESH_SECRET);
    });

    it('falls back to default development secrets when env vars are missing in test', () => {
      const config = validateJwtConfig({ NODE_ENV: 'test' });
      assert.strictEqual(config.nodeEnv, 'test');
      assert.strictEqual(config.jwtSecret, DEV_DEFAULT_ACCESS_SECRET);
      assert.strictEqual(config.jwtRefreshSecret, DEV_DEFAULT_REFRESH_SECRET);
    });

    it('allows custom dev secrets if provided in development', () => {
      const config = validateJwtConfig({
        NODE_ENV: 'development',
        JWT_SECRET: 'my_local_dev_key',
        JWT_REFRESH_SECRET: 'my_local_dev_refresh_key',
      });
      assert.strictEqual(config.jwtSecret, 'my_local_dev_key');
      assert.strictEqual(config.jwtRefreshSecret, 'my_local_dev_refresh_key');
    });

    it('generateAuthTokens works without errors in development', () => {
      const tokens = generateAuthTokens(
        { _id: '652a1234567890abcdef1234', role: 'user' },
        { NODE_ENV: 'development' }
      );
      assert.ok(tokens.accessToken);
      assert.ok(tokens.refreshToken);
    });
  });
});
