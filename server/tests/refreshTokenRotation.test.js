import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { RefreshToken } from '../src/models/RefreshToken.js';
import { register, login, refresh, logout } from '../src/controllers/auth/authController.js';
import { validateAuthCsrf } from '../src/middleware/csrfProtection.js';
import {
  generateAuthTokens,
  generateRefreshToken,
  hashToken,
  getRefreshCookieOptions,
} from '../src/utils/tokenService.js';

describe('MAT-15 — Refresh Token Rotation, Storage & Revocation Security Tests', () => {
  const mockUserId = new mongoose.Types.ObjectId().toString();
  const mockUser = {
    _id: mockUserId,
    name: 'Security Tester',
    email: 'sectester@example.com',
    role: 'user',
    matchPassword: async () => true,
  };

  // In-memory mock store for RefreshToken collection
  let refreshTokensMap = new Map();

  let origRefreshTokenFindOne;
  let origRefreshTokenFindOneAndUpdate;
  let origRefreshTokenCreate;
  let origRefreshTokenUpdateMany;
  let origUserFindOne;
  let origUserFindById;
  let origUserCreate;
  let origWalletCreate;
  let origWalletFindOne;

  // Helper to create mock Express response
  const createMockRes = () => {
    return {
      statusCode: 200,
      jsonData: null,
      cookies: {},
      clearedCookies: [],
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.jsonData = data;
        return this;
      },
      cookie(name, val, opts) {
        this.cookies[name] = { value: val, options: opts };
      },
      clearCookie(name, opts) {
        this.clearedCookies.push({ name, options: opts });
        delete this.cookies[name];
      },
    };
  };

  beforeEach(() => {
    refreshTokensMap = new Map();

    origRefreshTokenFindOne = RefreshToken.findOne;
    origRefreshTokenFindOneAndUpdate = RefreshToken.findOneAndUpdate;
    origRefreshTokenCreate = RefreshToken.create;
    origRefreshTokenUpdateMany = RefreshToken.updateMany;
    origUserFindOne = User.findOne;
    origUserFindById = User.findById;
    origUserCreate = User.create;
    origWalletCreate = Wallet.create;
    origWalletFindOne = Wallet.findOne;

    // In-memory mock implementations for RefreshToken collection
    RefreshToken.create = async (doc) => {
      const items = Array.isArray(doc) ? doc : [doc];
      const created = [];
      for (const item of items) {
        const id = item._id || new mongoose.Types.ObjectId().toString();
        const record = {
          _id: id,
          ...item,
          isRevoked: item.isRevoked || false,
          save: async function () {
            refreshTokensMap.set(String(this._id), { ...this });
            return this;
          },
        };
        refreshTokensMap.set(String(id), record);
        created.push(record);
      }
      return Array.isArray(doc) ? created : created[0];
    };

    RefreshToken.findOne = async (query) => {
      for (const doc of refreshTokensMap.values()) {
        const hashMatch = query.tokenHash ? doc.tokenHash === query.tokenHash : true;
        const idMatch = query._id ? String(doc._id) === String(query._id) : true;
        if (hashMatch && idMatch) {
          return {
            ...doc,
            save: async function () {
              refreshTokensMap.set(String(this._id), { ...this });
              return this;
            },
          };
        }
      }
      return null;
    };

    RefreshToken.findOneAndUpdate = async (filter, update, options = {}) => {
      let matched = null;
      for (const doc of refreshTokensMap.values()) {
        const idMatch = filter._id ? String(doc._id) === String(filter._id) : true;
        const hashMatch = filter.tokenHash ? doc.tokenHash === filter.tokenHash : true;
        const revokedMatch = filter.isRevoked !== undefined ? doc.isRevoked === filter.isRevoked : true;

        if (idMatch && hashMatch && revokedMatch) {
          matched = doc;
          break;
        }
      }

      if (!matched) return null;

      if (update.$set) {
        Object.assign(matched, update.$set);
      }

      return {
        ...matched,
        save: async function () {
          refreshTokensMap.set(String(this._id), { ...this });
          return this;
        },
      };
    };

    RefreshToken.updateMany = async (filter, update) => {
      let count = 0;
      for (const doc of refreshTokensMap.values()) {
        const familyMatch = filter.family ? doc.family === filter.family : true;
        if (familyMatch) {
          if (update.$set) {
            Object.assign(doc, update.$set);
          }
          count++;
        }
      }
      return { modifiedCount: count };
    };

    User.findById = async (id) => {
      if (String(id) === mockUserId) return mockUser;
      return null;
    };

    User.findOne = () => ({
      select: () => Promise.resolve(mockUser),
    });

    Wallet.findOne = async () => null;
    Wallet.create = async (payload) => ({
      _id: new mongoose.Types.ObjectId(),
      ...payload,
      balance: 0,
    });
  });

  afterEach(() => {
    RefreshToken.findOne = origRefreshTokenFindOne;
    RefreshToken.findOneAndUpdate = origRefreshTokenFindOneAndUpdate;
    RefreshToken.create = origRefreshTokenCreate;
    RefreshToken.updateMany = origRefreshTokenUpdateMany;
    User.findOne = origUserFindOne;
    User.findById = origUserFindById;
    User.create = origUserCreate;
    Wallet.create = origWalletCreate;
    Wallet.findOne = origWalletFindOne;
  });

  /* ==========================================================================
     1. LOGIN & REGISTRATION RESPONSE SECURITY & COOKIE OPTIONS
     ========================================================================== */
  describe('Login & Registration Response Security', () => {
    it('login sets httpOnly cookie and never exposes refreshToken in JSON response', async () => {
      const req = {
        body: { email: 'sectester@example.com', password: 'password123' },
        ip: '127.0.0.1',
        headers: { 'user-agent': 'SecurityTestAgent/1.0' },
      };
      const res = createMockRes();

      await login(req, res, () => {});

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.jsonData.success, true);

      // JSON response must contain user and accessToken
      assert.ok(res.jsonData.data.accessToken);
      assert.ok(res.jsonData.data.user);

      // CRITICAL: refreshToken must NEVER be returned in JSON body
      assert.strictEqual(res.jsonData.data.refreshToken, undefined);
      assert.strictEqual(JSON.stringify(res.jsonData).includes('refreshToken'), false);

      // Cookie must be set with httpOnly, path: '/api/v1/auth', and maxAge
      const cookie = res.cookies.refreshToken;
      assert.ok(cookie);
      assert.strictEqual(cookie.options.httpOnly, true);
      assert.strictEqual(cookie.options.path, '/api/v1/auth');
      assert.strictEqual(cookie.options.sameSite, 'lax');
      assert.strictEqual(cookie.options.maxAge, 7 * 24 * 60 * 60 * 1000);

      // Token in cookie must NOT match the hash in the database
      const rawToken = cookie.value;
      const expectedHash = hashToken(rawToken);

      let foundDbRecord = null;
      for (const rec of refreshTokensMap.values()) {
        if (rec.tokenHash === expectedHash) {
          foundDbRecord = rec;
          break;
        }
      }

      assert.ok(foundDbRecord, 'Token hash must be stored in database');
      assert.notStrictEqual(foundDbRecord.tokenHash, rawToken);
      assert.strictEqual(foundDbRecord.isRevoked, false);
      assert.ok(foundDbRecord.family);
    });

    it('register sets httpOnly cookie and never exposes refreshToken in JSON response', async () => {
      User.findOne = async () => null; // Email not registered
      User.create = async (payload) => ({
        _id: mockUserId,
        ...payload,
        toJSON: () => ({ _id: mockUserId, ...payload }),
      });

      const req = {
        body: { name: 'New User', email: 'newuser@example.com', password: 'password123' },
        ip: '127.0.0.1',
        headers: { 'user-agent': 'SecurityTestAgent/1.0' },
      };
      const res = createMockRes();

      await register(req, res, () => {});

      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.jsonData.success, true);
      assert.ok(res.jsonData.data.accessToken);
      assert.strictEqual(res.jsonData.data.refreshToken, undefined);

      const cookie = res.cookies.refreshToken;
      assert.ok(cookie);
      assert.strictEqual(cookie.options.httpOnly, true);
      assert.strictEqual(cookie.options.path, '/api/v1/auth');
    });
  });

  /* ==========================================================================
     2. REFRESH TOKEN ROTATION (ATOMIC INVALIDATION & REPLACEMENT)
     ========================================================================== */
  describe('Refresh Token Rotation Lifecycle', () => {
    it('rotates refresh token: revokes old token and issues single replacement in cookie', async () => {
      const family = crypto.randomUUID();
      const { refreshToken: oldToken } = generateAuthTokens(mockUser, process.env, { family });
      const oldHash = hashToken(oldToken);

      // Seed active refresh token
      await RefreshToken.create({
        user: mockUserId,
        tokenHash: oldHash,
        family,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        isRevoked: false,
      });

      const req = {
        cookies: { refreshToken: oldToken },
        ip: '127.0.0.1',
        headers: { 'user-agent': 'SecurityTestAgent/1.0' },
      };
      const res = createMockRes();

      await refresh(req, res, () => {});

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.jsonData.success, true);
      assert.ok(res.jsonData.data.accessToken);
      assert.strictEqual(res.jsonData.data.refreshToken, undefined);

      // Verify new rotated token in cookie
      const newCookie = res.cookies.refreshToken;
      assert.ok(newCookie);
      const newToken = newCookie.value;
      assert.notStrictEqual(newToken, oldToken, 'New token must differ from old token');

      // Verify old token is now marked isRevoked: true in DB with replacedBy link
      const oldRecord = Array.from(refreshTokensMap.values()).find((r) => r.tokenHash === oldHash);
      assert.ok(oldRecord);
      assert.strictEqual(oldRecord.isRevoked, true);
      assert.ok(oldRecord.revokedAt);
      assert.strictEqual(oldRecord.replacedByTokenHash, hashToken(newToken));

      // Verify new token is active in DB under the SAME family
      const newHash = hashToken(newToken);
      const newRecord = Array.from(refreshTokensMap.values()).find((r) => r.tokenHash === newHash);
      assert.ok(newRecord);
      assert.strictEqual(newRecord.isRevoked, false);
      assert.strictEqual(newRecord.family, family, 'Family session ID must be preserved');
    });

    it('rejects attempt to reuse an already-rotated token and revokes entire token family', async () => {
      const family = 'session-family-abc-123';
      const { refreshToken: initialToken } = generateAuthTokens(mockUser, process.env, { family });
      const initialHash = hashToken(initialToken);

      // Token 1 was rotated and is marked revoked
      await RefreshToken.create({
        user: mockUserId,
        tokenHash: initialHash,
        family,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        isRevoked: true,
        revokedAt: new Date(),
      });

      // Token 2 is currently active in that family
      const { refreshToken: secondToken } = generateAuthTokens(mockUser, process.env, { family });
      const secondHash = hashToken(secondToken);
      await RefreshToken.create({
        user: mockUserId,
        tokenHash: secondHash,
        family,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        isRevoked: false,
      });

      // Attacker replays old initialToken
      const req = {
        cookies: { refreshToken: initialToken },
        ip: '198.51.100.1',
        headers: { 'user-agent': 'AttackerBrowser/1.0' },
      };
      const res = createMockRes();

      await refresh(req, res, () => {});

      assert.strictEqual(res.statusCode, 401);
      assert.match(res.jsonData.message, /already been used and was revoked: session terminated/);

      // Verify entire family is now revoked (Token 2 revoked as well)
      const secondRecord = Array.from(refreshTokensMap.values()).find((r) => r.tokenHash === secondHash);
      assert.ok(secondRecord);
      assert.strictEqual(secondRecord.isRevoked, true, 'Token 2 must be revoked upon reuse detection');

      // Client cookie must be cleared
      assert.ok(res.clearedCookies.some((c) => c.name === 'refreshToken'));
    });
  });

  /* ==========================================================================
     3. CONCURRENT REFRESH REQUESTS (AT MOST ONE ROTATION)
     ========================================================================== */
  describe('Concurrent Refresh Request Concurrency', () => {
    it('prevents race conditions: concurrent refresh calls produce at most one successful rotation', async () => {
      const family = 'race-session-xyz-789';
      const { refreshToken: racingToken } = generateAuthTokens(mockUser, process.env, { family });
      const racingHash = hashToken(racingToken);

      await RefreshToken.create({
        user: mockUserId,
        tokenHash: racingHash,
        family,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        isRevoked: false,
      });

      const req1 = { cookies: { refreshToken: racingToken } };
      const req2 = { cookies: { refreshToken: racingToken } };
      const res1 = createMockRes();
      const res2 = createMockRes();

      // Launch both requests simultaneously
      await Promise.all([
        refresh(req1, res1, () => {}),
        refresh(req2, res2, () => {}),
      ]);

      const responses = [res1, res2];
      const successCount = responses.filter((r) => r.statusCode === 200).length;
      const failureCount = responses.filter((r) => r.statusCode === 401).length;

      assert.strictEqual(successCount, 1, 'Exactly one concurrent refresh call must succeed');
      assert.strictEqual(failureCount, 1, 'Losing concurrent call must be rejected');
    });
  });

  /* ==========================================================================
     4. LOGOUT & REVOCATION
     ========================================================================== */
  describe('Logout & Session Revocation', () => {
    it('logout revokes refresh token in database and clears cookies', async () => {
      const family = 'logout-session-001';
      const { refreshToken: activeToken } = generateAuthTokens(mockUser, process.env, { family });
      const activeHash = hashToken(activeToken);

      await RefreshToken.create({
        user: mockUserId,
        tokenHash: activeHash,
        family,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        isRevoked: false,
      });

      const req = { cookies: { refreshToken: activeToken } };
      const res = createMockRes();

      await logout(req, res, () => {});

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.jsonData.success, true);

      // Verify token marked revoked in DB
      const record = Array.from(refreshTokensMap.values()).find((r) => r.tokenHash === activeHash);
      assert.ok(record);
      assert.strictEqual(record.isRevoked, true);

      // Verify cookie cleared on both /api/v1/auth and /
      assert.ok(res.clearedCookies.some((c) => c.name === 'refreshToken' && c.options.path === '/api/v1/auth'));
      assert.ok(res.clearedCookies.some((c) => c.name === 'refreshToken' && c.options.path === '/'));

      // Subsequent attempt to refresh with this logged-out token must fail
      const refreshReq = { cookies: { refreshToken: activeToken } };
      const refreshRes = createMockRes();
      await refresh(refreshReq, refreshRes, () => {});
      assert.strictEqual(refreshRes.statusCode, 401);
    });
  });

  /* ==========================================================================
     5. MALFORMED, EXPIRED, AND UNKNOWN TOKENS
     ========================================================================== */
  describe('Invalid and Expired Tokens', () => {
    it('rejects missing refresh token with 401', async () => {
      const req = { cookies: {} };
      const res = createMockRes();
      await refresh(req, res, () => {});
      assert.strictEqual(res.statusCode, 401);
      assert.match(res.jsonData.message, /Refresh token is required/);
    });

    it('rejects malformed refresh token string with 401', async () => {
      const req = { cookies: { refreshToken: 'malformed.jwt.token' } };
      const res = createMockRes();
      await refresh(req, res, () => {});
      assert.strictEqual(res.statusCode, 401);
      assert.match(res.jsonData.message, /Invalid or expired refresh token/);
    });

    it('rejects token with valid signature but unknown hash with 401', async () => {
      // Valid signed JWT that was never saved to DB (or already expired & purged)
      const token = generateRefreshToken({ id: mockUserId });
      const req = { cookies: { refreshToken: token } };
      const res = createMockRes();
      await refresh(req, res, () => {});
      assert.strictEqual(res.statusCode, 401);
      assert.match(res.jsonData.message, /Invalid or expired refresh token/);
    });

    it('rejects database-expired token with 401', async () => {
      const family = 'expired-family-123';
      const token = generateRefreshToken({ id: mockUserId, family });
      const tokenHash = hashToken(token);

      await RefreshToken.create({
        user: mockUserId,
        tokenHash,
        family,
        expiresAt: new Date(Date.now() - 1000), // In the past
        isRevoked: false,
      });

      const req = { cookies: { refreshToken: token } };
      const res = createMockRes();
      await refresh(req, res, () => {});
      assert.strictEqual(res.statusCode, 401);
      assert.match(res.jsonData.message, /Refresh token has expired/);
    });
  });

  /* ==========================================================================
     6. CSRF PROTECTION MIDDLEWARE (validateAuthCsrf)
     ========================================================================== */
  describe('CSRF Protection on Cookie-based Auth Endpoints', () => {
    it('blocks cross-site fetch metadata requests (Sec-Fetch-Site: cross-site) with 403', () => {
      const req = {
        headers: { 'sec-fetch-site': 'cross-site', origin: 'http://localhost:5173' },
      };
      const res = createMockRes();
      let nextCalled = false;

      validateAuthCsrf(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 403);
      assert.match(res.jsonData.message, /Cross-site request blocked by CSRF protection/);
    });

    it('blocks unauthorized Origin header with 403', () => {
      const req = {
        headers: { origin: 'https://malicious-attacker.com' },
      };
      const res = createMockRes();
      let nextCalled = false;

      validateAuthCsrf(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 403);
      assert.match(res.jsonData.message, /Request Origin is not authorized by CSRF policy/);
    });

    it('blocks unauthorized Referer header with 403', () => {
      const req = {
        headers: { referer: 'https://evil-phishing.org/steal-session' },
      };
      const res = createMockRes();
      let nextCalled = false;

      validateAuthCsrf(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 403);
      assert.match(res.jsonData.message, /Request Referer is not authorized by CSRF policy/);
    });

    it('allows authorized frontend Origin (http://localhost:5173)', () => {
      const req = {
        headers: { origin: 'http://localhost:5173' },
      };
      const res = createMockRes();
      let nextCalled = false;

      validateAuthCsrf(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(res.statusCode, 200);
    });

    it('allows non-browser programmatic requests without Origin/Referer (e.g. Node tests, curl)', () => {
      const req = {
        headers: {},
      };
      const res = createMockRes();
      let nextCalled = false;

      validateAuthCsrf(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, true);
    });
  });
});
