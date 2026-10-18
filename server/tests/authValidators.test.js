import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerValidation, loginValidation } from '../src/validators/authValidators.js';
import { register } from '../src/controllers/auth/authController.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';

describe('Auth Validators Unit Tests', () => {
  const createMockRes = () => {
    const res = {
      statusCode: null,
      jsonData: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.jsonData = data;
        return this;
      },
    };
    return res;
  };

  describe('registerValidation', () => {
    it('passes validation for valid user registration input without role', () => {
      const req = {
        body: {
          name: 'Jane Doe',
          email: 'jane@example.com',
          password: 'securepassword123',
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      registerValidation(req, res, next);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(res.statusCode, null);
    });

    it('fails when name is missing or too short', () => {
      const req = {
        body: {
          name: 'J',
          email: 'jane@example.com',
          password: 'securepassword123',
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      registerValidation(req, res, next);

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.jsonData.success, false);
      assert.ok(res.jsonData.errors.includes('Name must be between 2 and 60 characters'));
    });

    it('fails when email format is invalid', () => {
      const req = {
        body: {
          name: 'Jane Doe',
          email: 'invalid-email',
          password: 'securepassword123',
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      registerValidation(req, res, next);

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.jsonData.errors.includes('Please provide a valid email address'));
    });

    it('fails when password is fewer than 6 characters', () => {
      const req = {
        body: {
          name: 'Jane Doe',
          email: 'jane@example.com',
          password: '123',
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      registerValidation(req, res, next);

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.jsonData.errors.includes('Password must be at least 6 characters long'));
    });

    it('fails when role: admin is explicitly provided', () => {
      const req = {
        body: {
          name: 'Jane Doe',
          email: 'jane@example.com',
          password: 'securepassword123',
          role: 'admin',
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      registerValidation(req, res, next);

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.jsonData.success, false);
      assert.ok(res.jsonData.errors.includes('Role cannot be specified during registration'));
    });

    it('fails when other unsupported roles are provided', () => {
      const req = {
        body: {
          name: 'Jane Doe',
          email: 'jane@example.com',
          password: 'securepassword123',
          role: 'moderator',
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      registerValidation(req, res, next);

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.jsonData.success, false);
      assert.ok(res.jsonData.errors.includes('Role cannot be specified during registration'));
    });

    it('fails when role: user is explicitly provided in request body', () => {
      const req = {
        body: {
          name: 'Jane Doe',
          email: 'jane@example.com',
          password: 'securepassword123',
          role: 'user',
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      registerValidation(req, res, next);

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.jsonData.success, false);
      assert.ok(res.jsonData.errors.includes('Role cannot be specified during registration'));
    });
  });

  describe('loginValidation', () => {
    it('passes validation for valid login credentials', () => {
      const req = {
        body: {
          email: 'jane@example.com',
          password: 'securepassword123',
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      loginValidation(req, res, next);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(res.statusCode, null);
    });

    it('fails validation when email is missing', () => {
      const req = {
        body: {
          password: 'securepassword123',
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      loginValidation(req, res, next);

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.jsonData.errors.includes('Email is required'));
    });

    it('fails validation when password is missing', () => {
      const req = {
        body: {
          email: 'jane@example.com',
        },
      };
      const res = createMockRes();
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      loginValidation(req, res, next);

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.jsonData.errors.includes('Password is required'));
    });
  });

  describe('register controller role enforcement', () => {
    it('always creates user with role: user even if request attempts to supply role: admin', async () => {
      const originalUserFindOne = User.findOne;
      const originalUserCreate = User.create;
      const originalWalletFindOne = Wallet.findOne;
      const originalWalletCreate = Wallet.create;

      let capturedUserPayload = null;

      User.findOne = async () => null;
      User.create = async (payload) => {
        capturedUserPayload = payload;
        return {
          _id: '652a1234567890abcdef1234',
          ...payload,
          toJSON: () => ({ _id: '652a1234567890abcdef1234', ...payload }),
        };
      };
      Wallet.findOne = async () => null;
      Wallet.create = async (payload) => ({
        _id: '652a9999999999abcdef9999',
        ...payload,
      });

      const req = {
        body: {
          name: 'Attacker Test',
          email: 'attacker@example.com',
          password: 'password123',
          role: 'admin',
        },
      };

      const res = {
        statusCode: null,
        jsonData: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.jsonData = data;
          return this;
        },
        cookie() {},
      };

      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      try {
        await register(req, res, next);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 201);
        assert.strictEqual(res.jsonData.success, true);
        assert.strictEqual(capturedUserPayload.role, 'user');
        assert.notStrictEqual(capturedUserPayload.role, 'admin');
        assert.strictEqual(res.jsonData.data.user.role, 'user');
      } finally {
        User.findOne = originalUserFindOne;
        User.create = originalUserCreate;
        Wallet.findOne = originalWalletFindOne;
        Wallet.create = originalWalletCreate;
      }
    });
  });
});
