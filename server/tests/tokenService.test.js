import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateAuthTokens,
} from '../src/utils/tokenService.js';

describe('Token Service Unit Tests', () => {
  const mockUser = {
    _id: '652a1234567890abcdef1234',
    role: 'user',
  };

  it('generates a valid JWT access token and decodes payload successfully', () => {
    const token = generateAccessToken({ id: mockUser._id, role: mockUser.role });
    assert.ok(typeof token === 'string' && token.length > 0);

    const decoded = verifyAccessToken(token);
    assert.strictEqual(decoded.id, mockUser._id);
    assert.strictEqual(decoded.role, mockUser.role);
    assert.ok(decoded.exp);
  });

  it('generates a valid JWT refresh token and decodes payload successfully', () => {
    const token = generateRefreshToken({ id: mockUser._id });
    assert.ok(typeof token === 'string' && token.length > 0);

    const decoded = verifyRefreshToken(token);
    assert.strictEqual(decoded.id, mockUser._id);
    assert.ok(decoded.exp);
  });

  it('generateAuthTokens returns both accessToken and refreshToken', () => {
    const tokens = generateAuthTokens(mockUser);
    assert.ok(tokens.accessToken);
    assert.ok(tokens.refreshToken);

    const accessDecoded = verifyAccessToken(tokens.accessToken);
    const refreshDecoded = verifyRefreshToken(tokens.refreshToken);

    assert.strictEqual(accessDecoded.id, mockUser._id);
    assert.strictEqual(refreshDecoded.id, mockUser._id);
  });

  it('throws an error when verifying an invalid or tampered token', () => {
    assert.throws(
      () => {
        verifyAccessToken('invalid.jwt.token');
      },
      (err) => err.name === 'JsonWebTokenError'
    );
  });
});
