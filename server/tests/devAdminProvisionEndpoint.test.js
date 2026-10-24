import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';

describe('Development Admin Provisioning Endpoint Tests (POST /api/v1/auth/dev-provision-admin)', () => {
  let server;
  let baseUrl;
  const TEST_VALID_SECRET = 'a_very_secure_test_provision_secret_32chars_long!';

  before(async () => {
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

  describe('Production Environment Guard', () => {
    it('returns 404 Not Found when NODE_ENV is production', async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origSecret = process.env.DEV_ADMIN_PROVISION_SECRET;
      process.env.NODE_ENV = 'production';
      process.env.DEV_ADMIN_PROVISION_SECRET = TEST_VALID_SECRET;

      try {
        const response = await fetch(`${baseUrl}/api/v1/auth/dev-provision-admin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-dev-provision-secret': TEST_VALID_SECRET,
          },
          body: JSON.stringify({
            name: 'Prod Admin Attempt',
            email: 'admin@prod.test',
            password: 'SuperSecurePassword2026!',
          }),
        });

        assert.strictEqual(response.status, 404);
        const body = await response.json();
        assert.strictEqual(body.success, false);
        assert.strictEqual(body.message, 'Endpoint not found');
      } finally {
        process.env.NODE_ENV = origNodeEnv;
        process.env.DEV_ADMIN_PROVISION_SECRET = origSecret;
      }
    });
  });

  describe('Provisioning Secret Header Verification', () => {
    it('returns 403 Forbidden if DEV_ADMIN_PROVISION_SECRET is not configured on server', async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origSecret = process.env.DEV_ADMIN_PROVISION_SECRET;
      process.env.NODE_ENV = 'development';
      delete process.env.DEV_ADMIN_PROVISION_SECRET;

      try {
        const response = await fetch(`${baseUrl}/api/v1/auth/dev-provision-admin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-dev-provision-secret': 'some_client_secret',
          },
          body: JSON.stringify({
            name: 'Dev Admin',
            email: 'admin@dev.test',
            password: 'SuperSecurePassword2026!',
          }),
        });

        assert.strictEqual(response.status, 403);
        const body = await response.json();
        assert.strictEqual(body.success, false);
        assert.ok(body.message.includes('Development admin provisioning is disabled'));
      } finally {
        process.env.NODE_ENV = origNodeEnv;
        process.env.DEV_ADMIN_PROVISION_SECRET = origSecret;
      }
    });

    it('returns 403 Forbidden if server secret is shorter than 32 characters', async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origSecret = process.env.DEV_ADMIN_PROVISION_SECRET;
      process.env.NODE_ENV = 'development';
      process.env.DEV_ADMIN_PROVISION_SECRET = 'short_weak_secret';

      try {
        const response = await fetch(`${baseUrl}/api/v1/auth/dev-provision-admin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-dev-provision-secret': 'short_weak_secret',
          },
          body: JSON.stringify({
            name: 'Dev Admin',
            email: 'admin@dev.test',
            password: 'SuperSecurePassword2026!',
          }),
        });

        assert.strictEqual(response.status, 403);
        const body = await response.json();
        assert.strictEqual(body.success, false);
        assert.ok(body.message.includes('Development admin provisioning is disabled'));
      } finally {
        process.env.NODE_ENV = origNodeEnv;
        process.env.DEV_ADMIN_PROVISION_SECRET = origSecret;
      }
    });

    it('returns 403 Forbidden if client omits x-dev-provision-secret header', async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origSecret = process.env.DEV_ADMIN_PROVISION_SECRET;
      process.env.NODE_ENV = 'development';
      process.env.DEV_ADMIN_PROVISION_SECRET = TEST_VALID_SECRET;

      try {
        const response = await fetch(`${baseUrl}/api/v1/auth/dev-provision-admin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: 'Dev Admin',
            email: 'admin@dev.test',
            password: 'SuperSecurePassword2026!',
          }),
        });

        assert.strictEqual(response.status, 403);
        const body = await response.json();
        assert.strictEqual(body.success, false);
        assert.ok(body.message.includes('Missing x-dev-provision-secret header'));
      } finally {
        process.env.NODE_ENV = origNodeEnv;
        process.env.DEV_ADMIN_PROVISION_SECRET = origSecret;
      }
    });

    it('returns 403 Forbidden if client provides incorrect x-dev-provision-secret', async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origSecret = process.env.DEV_ADMIN_PROVISION_SECRET;
      process.env.NODE_ENV = 'development';
      process.env.DEV_ADMIN_PROVISION_SECRET = TEST_VALID_SECRET;

      try {
        const response = await fetch(`${baseUrl}/api/v1/auth/dev-provision-admin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-dev-provision-secret': 'wrong_secret_attacker_guessing_12345!',
          },
          body: JSON.stringify({
            name: 'Dev Admin',
            email: 'admin@dev.test',
            password: 'SuperSecurePassword2026!',
          }),
        });

        assert.strictEqual(response.status, 403);
        const body = await response.json();
        assert.strictEqual(body.success, false);
        assert.ok(body.message.includes('Invalid provisioning secret'));
      } finally {
        process.env.NODE_ENV = origNodeEnv;
        process.env.DEV_ADMIN_PROVISION_SECRET = origSecret;
      }
    });
  });

  describe('Payload Input Validation', () => {
    it('returns 400 Bad Request if email, name, or password are invalid', async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origSecret = process.env.DEV_ADMIN_PROVISION_SECRET;
      process.env.NODE_ENV = 'development';
      process.env.DEV_ADMIN_PROVISION_SECRET = TEST_VALID_SECRET;

      try {
        const response = await fetch(`${baseUrl}/api/v1/auth/dev-provision-admin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-dev-provision-secret': TEST_VALID_SECRET,
          },
          body: JSON.stringify({
            name: 'A', // too short
            email: 'bad-email', // invalid format
            password: 'short', // < 8 chars
          }),
        });

        assert.strictEqual(response.status, 400);
        const body = await response.json();
        assert.strictEqual(body.success, false);
        assert.ok(body.errors.some((e) => e.includes('between 2 and 60 characters')));
        assert.ok(body.errors.some((e) => e.includes('valid email address')));
        assert.ok(body.errors.some((e) => e.includes('at least 8 characters long')));
      } finally {
        process.env.NODE_ENV = origNodeEnv;
        process.env.DEV_ADMIN_PROVISION_SECRET = origSecret;
      }
    });
  });

  describe('Privilege Escalation & Overwrite Protection', () => {
    it('returns 409 Conflict when account already exists as administrator without force=true', async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origSecret = process.env.DEV_ADMIN_PROVISION_SECRET;
      const origFindOne = User.findOne;

      process.env.NODE_ENV = 'development';
      process.env.DEV_ADMIN_PROVISION_SECRET = TEST_VALID_SECRET;

      const mockAdminUser = {
        _id: new mongoose.Types.ObjectId(),
        name: 'Existing Admin',
        email: 'chief.admin@dev.test',
        role: 'admin',
      };

      User.findOne = () => ({
        select: () => Promise.resolve(mockAdminUser),
      });

      try {
        const response = await fetch(`${baseUrl}/api/v1/auth/dev-provision-admin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-dev-provision-secret': TEST_VALID_SECRET,
          },
          body: JSON.stringify({
            name: 'Attempted Hijack',
            email: 'chief.admin@dev.test',
            password: 'NewPassword123!',
            force: false,
          }),
        });

        assert.strictEqual(response.status, 409);
        const body = await response.json();
        assert.strictEqual(body.success, false);
        assert.ok(body.message.includes('already an administrator'));
        assert.ok(body.message.includes('Set "force": true'));
      } finally {
        process.env.NODE_ENV = origNodeEnv;
        process.env.DEV_ADMIN_PROVISION_SECRET = origSecret;
        User.findOne = origFindOne;
      }
    });

    it('returns 409 Conflict when account already exists as standard user without force=true', async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origSecret = process.env.DEV_ADMIN_PROVISION_SECRET;
      const origFindOne = User.findOne;

      process.env.NODE_ENV = 'development';
      process.env.DEV_ADMIN_PROVISION_SECRET = TEST_VALID_SECRET;

      const mockStandardUser = {
        _id: new mongoose.Types.ObjectId(),
        name: 'Normal User',
        email: 'user@dev.test',
        role: 'user',
      };

      User.findOne = () => ({
        select: () => Promise.resolve(mockStandardUser),
      });

      try {
        const response = await fetch(`${baseUrl}/api/v1/auth/dev-provision-admin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-dev-provision-secret': TEST_VALID_SECRET,
          },
          body: JSON.stringify({
            name: 'Escalate Me',
            email: 'user@dev.test',
            password: 'NewPassword123!',
            force: false,
          }),
        });

        assert.strictEqual(response.status, 409);
        const body = await response.json();
        assert.strictEqual(body.success, false);
        assert.ok(body.message.includes('already exists as a standard user'));
        assert.ok(body.message.includes('Set "force": true'));
      } finally {
        process.env.NODE_ENV = origNodeEnv;
        process.env.DEV_ADMIN_PROVISION_SECRET = origSecret;
        User.findOne = origFindOne;
      }
    });
  });

  describe('Successful Administrator Provisioning', () => {
    it('creates new development administrator and returns 201 without leaking password or secrets', async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origSecret = process.env.DEV_ADMIN_PROVISION_SECRET;
      const origFindOne = User.findOne;
      const origWalletCreate = Wallet.create;
      const origWalletFindOne = Wallet.findOne;

      process.env.NODE_ENV = 'development';
      process.env.DEV_ADMIN_PROVISION_SECRET = TEST_VALID_SECRET;

      let savedUserDoc = null;
      User.findOne = () => ({
        select: () => Promise.resolve(null),
      });

      const origSave = User.prototype.save;
      User.prototype.save = async function () {
        savedUserDoc = this;
        return this;
      };

      Wallet.findOne = async () => null;
      Wallet.create = async () => ({ _id: new mongoose.Types.ObjectId(), balance: 0 });

      try {
        const response = await fetch(`${baseUrl}/api/v1/auth/dev-provision-admin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-dev-provision-secret': TEST_VALID_SECRET,
          },
          body: JSON.stringify({
            name: 'Dev Super Admin',
            email: 'super.admin@dev.test',
            password: 'StrongDevAdminPassword2026!',
          }),
        });

        assert.strictEqual(response.status, 201);
        const body = await response.json();
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.data.action, 'created');
        assert.strictEqual(body.data.user.role, 'admin');
        assert.strictEqual(body.data.user.email, 'super.admin@dev.test');
        assert.strictEqual(body.data.user.name, 'Dev Super Admin');

        // Security assertion: no credentials or secrets leaked
        assert.strictEqual(body.data.user.password, undefined);
        assert.strictEqual(body.data.password, undefined);
        assert.strictEqual(body.data.secret, undefined);
      } finally {
        process.env.NODE_ENV = origNodeEnv;
        process.env.DEV_ADMIN_PROVISION_SECRET = origSecret;
        User.findOne = origFindOne;
        User.prototype.save = origSave;
        Wallet.create = origWalletCreate;
        Wallet.findOne = origWalletFindOne;
      }
    });
  });
});
