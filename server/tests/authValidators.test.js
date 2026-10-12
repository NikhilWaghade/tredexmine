import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerValidation, loginValidation } from '../src/validators/authValidators.js';

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
    it('passes validation for valid user registration input', () => {
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

    it('fails when role is not user or admin', () => {
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
      assert.ok(res.jsonData.errors.includes('Role must be either user or admin'));
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
});
