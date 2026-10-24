import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  assertNotProduction,
  parseProvisionArgs,
  validateProvisionInputs,
  provisionAdminUser,
} from '../scripts/provisionAdmin.js';

describe('Admin Provisioning Script Unit Tests (provisionAdmin)', () => {
  describe('Production Environment Guard', () => {
    it('refuses execution when environment is production', () => {
      assert.throws(
        () => assertNotProduction('production'),
        (err) => {
          assert.strictEqual(err.code, 'ERR_PRODUCTION_BLOCKED');
          assert.match(err.message, /Execution is blocked in production/);
          return true;
        }
      );
    });

    it('passes assertion when environment is development or test', () => {
      assert.doesNotThrow(() => assertNotProduction('development'));
      assert.doesNotThrow(() => assertNotProduction('test'));
      assert.doesNotThrow(() => assertNotProduction(undefined));
    });

    it('provisionAdminUser rejects immediately if invoked with env=production', async () => {
      await assert.rejects(
        async () => {
          await provisionAdminUser({
            email: 'admin@example.com',
            password: 'StrongAdminPassword123!',
            name: 'Dev Admin',
            env: 'production',
          });
        },
        (err) => {
          assert.strictEqual(err.code, 'ERR_PRODUCTION_BLOCKED');
          return true;
        }
      );
    });
  });

  describe('CLI and Environment Argument Parsing', () => {
    it('parses named flags correctly (--email, --password, --name, --force)', () => {
      const argv = [
        '--email', 'custom.admin@treadexmine.local',
        '--password', 'SecretPass2026!',
        '--name', 'Lead Administrator',
        '--force',
      ];

      const args = parseProvisionArgs(argv, {});
      assert.strictEqual(args.email, 'custom.admin@treadexmine.local');
      assert.strictEqual(args.password, 'SecretPass2026!');
      assert.strictEqual(args.name, 'Lead Administrator');
      assert.strictEqual(args.force, true);
      assert.strictEqual(args.showHelp, false);
    });

    it('parses key=value style arguments correctly', () => {
      const argv = [
        '--email=admin.kv@treadexmine.local',
        '--password=AnotherSecret2026!',
        '--name=KV Admin',
      ];

      const args = parseProvisionArgs(argv, {});
      assert.strictEqual(args.email, 'admin.kv@treadexmine.local');
      assert.strictEqual(args.password, 'AnotherSecret2026!');
      assert.strictEqual(args.name, 'KV Admin');
      assert.strictEqual(args.force, false);
    });

    it('falls back to environment variables when flags are omitted', () => {
      const env = {
        DEV_ADMIN_EMAIL: 'env.admin@treadexmine.local',
        DEV_ADMIN_PASSWORD: 'EnvPassword999!',
        DEV_ADMIN_NAME: 'Environment Admin',
      };

      const args = parseProvisionArgs([], env);
      assert.strictEqual(args.email, 'env.admin@treadexmine.local');
      assert.strictEqual(args.password, 'EnvPassword999!');
      assert.strictEqual(args.name, 'Environment Admin');
      assert.strictEqual(args.force, false);
    });

    it('detects --help flag', () => {
      const args = parseProvisionArgs(['--help'], {});
      assert.strictEqual(args.showHelp, true);
    });
  });

  describe('Input Validation (validateProvisionInputs)', () => {
    it('throws error when email is missing or empty', () => {
      assert.throws(
        () => validateProvisionInputs({ email: '', password: 'ValidPassword123!', name: 'Admin' }),
        (err) => {
          assert.strictEqual(err.code, 'ERR_INVALID_EMAIL');
          assert.match(err.message, /Admin email is required/);
          return true;
        }
      );
    });

    it('throws error when email format is invalid', () => {
      assert.throws(
        () => validateProvisionInputs({ email: 'not-an-email', password: 'ValidPassword123!', name: 'Admin' }),
        (err) => {
          assert.strictEqual(err.code, 'ERR_INVALID_EMAIL');
          assert.match(err.message, /Invalid email address/);
          return true;
        }
      );
    });

    it('throws error when name is missing or too short', () => {
      assert.throws(
        () => validateProvisionInputs({ email: 'admin@example.com', password: 'ValidPassword123!', name: 'A' }),
        (err) => {
          assert.strictEqual(err.code, 'ERR_INVALID_NAME');
          assert.match(err.message, /between 2 and 60 characters/);
          return true;
        }
      );
    });

    it('throws error when password is shorter than 8 characters', () => {
      assert.throws(
        () => validateProvisionInputs({ email: 'admin@example.com', password: 'short', name: 'Admin' }),
        (err) => {
          assert.strictEqual(err.code, 'ERR_INVALID_PASSWORD');
          assert.match(err.message, /at least 8 characters long/);
          return true;
        }
      );
    });

    it('passes validation when all fields meet constraints', () => {
      assert.doesNotThrow(() =>
        validateProvisionInputs({
          email: 'valid.admin@example.com',
          password: 'SecurePassword2026!',
          name: 'Valid Administrator',
        })
      );
    });
  });

  describe('Admin Account Provisioning Logic (Mocked In-Memory)', () => {
    it('creates a new admin user when email does not exist', async () => {
      let savedUser = null;
      let walletCreatedFor = null;

      class MockUser {
        constructor(doc) {
          Object.assign(this, doc);
          this._id = new mongoose.Types.ObjectId();
        }

        async save() {
          savedUser = this;
          return this;
        }

        static findOne() {
          return {
            select: () => Promise.resolve(null),
          };
        }
      }

      const mockCreateWallet = async (userId) => {
        walletCreatedFor = userId;
        return { user: userId, balance: 0 };
      };

      const result = await provisionAdminUser(
        {
          email: 'new.admin@example.com',
          password: 'Password123!',
          name: 'New Administrator',
          env: 'development',
        },
        {
          UserModel: MockUser,
          createWalletForUser: mockCreateWallet,
        }
      );

      assert.strictEqual(result.isNew, true);
      assert.strictEqual(result.upgraded, false);
      assert.strictEqual(result.user.email, 'new.admin@example.com');
      assert.strictEqual(result.user.role, 'admin');
      assert.strictEqual(savedUser.role, 'admin');
      assert.strictEqual(savedUser.isVerified, true);
      assert.strictEqual(walletCreatedFor, savedUser._id);
    });

    it('promotes an existing regular user (role: user) to admin', async () => {
      const existingUserDoc = {
        _id: new mongoose.Types.ObjectId(),
        name: 'Regular Joe',
        email: 'joe@example.com',
        role: 'user',
        isVerified: false,
        save: async function () {
          return this;
        },
      };

      class MockUser {
        static findOne() {
          return {
            select: () => Promise.resolve(existingUserDoc),
          };
        }
      }

      const result = await provisionAdminUser(
        {
          email: 'joe@example.com',
          password: 'NewAdminPassword123!',
          name: 'Joe The Admin',
          env: 'development',
        },
        {
          UserModel: MockUser,
          createWalletForUser: async () => {},
        }
      );

      assert.strictEqual(result.isNew, false);
      assert.strictEqual(result.upgraded, true);
      assert.strictEqual(existingUserDoc.role, 'admin');
      assert.strictEqual(existingUserDoc.name, 'Joe The Admin');
      assert.strictEqual(existingUserDoc.isVerified, true);
      assert.strictEqual(result.user.role, 'admin');
    });

    it('does not overwrite existing admin without --force flag', async () => {
      const existingAdminDoc = {
        _id: new mongoose.Types.ObjectId(),
        name: 'Existing Chief Admin',
        email: 'chief@example.com',
        role: 'admin',
        isVerified: true,
        save: async function () {
          throw new Error('Save should not be called without --force');
        },
      };

      class MockUser {
        static findOne() {
          return {
            select: () => Promise.resolve(existingAdminDoc),
          };
        }
      }

      const result = await provisionAdminUser(
        {
          email: 'chief@example.com',
          password: 'AttemptedPassword123!',
          name: 'New Name',
          force: false,
          env: 'development',
        },
        {
          UserModel: MockUser,
          createWalletForUser: async () => {},
        }
      );

      assert.strictEqual(result.isNew, false);
      assert.strictEqual(result.upgraded, false);
      assert.strictEqual(result.user.role, 'admin');
      assert.ok(result.message.includes('already an active administrator'));
    });

    it('updates existing admin when --force flag is passed', async () => {
      let saved = false;
      const existingAdminDoc = {
        _id: new mongoose.Types.ObjectId(),
        name: 'Old Admin Name',
        email: 'chief@example.com',
        role: 'admin',
        isVerified: true,
        save: async function () {
          saved = true;
          return this;
        },
      };

      class MockUser {
        static findOne() {
          return {
            select: () => Promise.resolve(existingAdminDoc),
          };
        }
      }

      const result = await provisionAdminUser(
        {
          email: 'chief@example.com',
          password: 'UpdatedPassword123!',
          name: 'Updated Admin Name',
          force: true,
          env: 'development',
        },
        {
          UserModel: MockUser,
          createWalletForUser: async () => {},
        }
      );

      assert.strictEqual(saved, true);
      assert.strictEqual(existingAdminDoc.name, 'Updated Admin Name');
      assert.strictEqual(result.isNew, false);
      assert.strictEqual(result.user.name, 'Updated Admin Name');
    });
  });
});
