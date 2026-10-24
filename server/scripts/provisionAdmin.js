import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import validator from 'validator';

// Ensure environment variables from server/.env are loaded regardless of current working directory
const originalNodeEnv = process.env.NODE_ENV;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
if (originalNodeEnv) {
  process.env.NODE_ENV = originalNodeEnv;
}

import { User } from '../src/models/User.js';
import { createWalletForUser } from '../src/services/walletService.js';
import { connectDB } from '../src/config/db.js';

/**
 * Asserts that the current environment is not production.
 * @param {string} [env]
 * @throws {Error} If environment is production
 */
export const assertNotProduction = (env = process.env.NODE_ENV) => {
  if (env === 'production') {
    const error = new Error(
      '[SECURITY ERROR] Admin provisioning script is strictly for development and testing environments. Execution is blocked in production (NODE_ENV=production).'
    );
    error.code = 'ERR_PRODUCTION_BLOCKED';
    throw error;
  }
};

/**
 * Parses CLI arguments and environment variables for admin provisioning.
 * Never supplies or defaults to a hardcoded password.
 * @param {Array<string>} [argv]
 * @param {Object} [env]
 * @returns {{ email: string, password: string,name: string, force: boolean, showHelp: boolean }}
 */
export const parseProvisionArgs = (argv = process.argv.slice(2), env = process.env) => {
  let email = env.DEV_ADMIN_EMAIL || '';
  let password = env.DEV_ADMIN_PASSWORD || '';
  let name = env.DEV_ADMIN_NAME || '';
  let force = false;
  let showHelp = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      showHelp = true;
      continue;
    }

    if (arg === '--email' || arg === '-e') {
      email = argv[++i] || '';
    } else if (arg.startsWith('--email=')) {
      email = arg.split('=')[1] || '';
    } else if (arg === '--password' || arg === '-p') {
      password = argv[++i] || '';
    } else if (arg.startsWith('--password=')) {
      password = arg.split('=')[1] || '';
    } else if (arg === '--name' || arg === '-n') {
      name = argv[++i] || '';
    } else if (arg.startsWith('--name=')) {
      name = arg.split('=')[1] || '';
    } else if (arg === '--force' || arg === '-f') {
      force = true;
    }
  }

  return {
    email: String(email).trim().toLowerCase(),
    password: String(password),
    name: String(name).trim(),
    force,
    showHelp,
  };
};

/**
 * Validates admin provisioning input parameters.
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.password
 * @param {string} params.name
 */
export const validateProvisionInputs = ({ email, password, name }) => {
  if (!email) {
    const error = new Error('Admin email is required. Provide via --email <email> or DEV_ADMIN_EMAIL env.');
    error.code = 'ERR_INVALID_EMAIL';
    throw error;
  }

  if (!validator.isEmail(email)) {
    const error = new Error(`Invalid email address: "${email}". Must be a valid email format.`);
    error.code = 'ERR_INVALID_EMAIL';
    throw error;
  }

  if (!name || name.trim().length < 2 || name.trim().length > 60) {
    const error = new Error('Admin name is required and must be between 2 and 60 characters. Provide via --name <name> or DEV_ADMIN_NAME env.');
    error.code = 'ERR_INVALID_NAME';
    throw error;
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    const error = new Error('Admin password is required and must be at least 8 characters long for secure provisioning. Provide via --password <password> or DEV_ADMIN_PASSWORD env.');
    error.code = 'ERR_INVALID_PASSWORD';
    throw error;
  }
};

/**
 * Provisions a dedicated development administrator account.
 * Uses native User pre-save hook for standard bcryptjs hashing.
 * Never modifies production data.
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.password
 * @param {string} params.name
 * @param {boolean} [params.force]
 * @param {string} [params.env]
 * @param {Object} [dependencies]
 * @returns {Promise<{ user: Object, isNew: boolean, upgraded: boolean, message: string }>}
 */
export const provisionAdminUser = async (
  { email, password, name, force = false, env = process.env.NODE_ENV },
  dependencies = {}
) => {
  // 1. Enforce production environment guard
  assertNotProduction(env);

  // 2. Validate all inputs
  validateProvisionInputs({ email, password, name });

  const UserModel = dependencies.UserModel || User;
  const walletCreator = dependencies.createWalletForUser || createWalletForUser;

  // 3. Check if user already exists
  const existingUser = await UserModel.findOne({ email: email.toLowerCase().trim() }).select('+password');

  if (existingUser) {
    if (existingUser.role === 'admin') {
      if (!force) {
        return {
          user: {
            id: existingUser._id.toString(),
            name: existingUser.name,
            email: existingUser.email,
            role: existingUser.role,
          },
          isNew: false,
          upgraded: false,
          message: `User "${existingUser.email}" is already an active administrator. Use --force to update credentials.`,
        };
      }

      // Force update password and name
      existingUser.name = name.trim();
      existingUser.password = password;
      await existingUser.save();

      return {
        user: {
          id: existingUser._id.toString(),
          name: existingUser.name,
          email: existingUser.email,
          role: existingUser.role,
        },
        isNew: false,
        upgraded: false,
        message: `Existing administrator "${existingUser.email}" credentials updated successfully.`,
      };
    }

    // Existing user has role: 'user' -> upgrade to role: 'admin'
    existingUser.role = 'admin';
    existingUser.name = name.trim();
    if (force || password) {
      existingUser.password = password;
    }
    existingUser.isVerified = true;
    await existingUser.save();

    return {
      user: {
        id: existingUser._id.toString(),
        name: existingUser.name,
        email: existingUser.email,
        role: existingUser.role,
      },
      isNew: false,
      upgraded: true,
      message: `Existing user "${existingUser.email}" was successfully promoted to administrator.`,
    };
  }

  // 4. Create new user with role: 'admin' and isVerified: true
  // Note: user.save() invokes pre('save') hook to hash password via bcryptjs
  const newUser = new UserModel({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password,
    role: 'admin',
    isVerified: true,
  });

  await newUser.save();

  // 5. Ensure linked wallet is created for consistency
  try {
    await walletCreator(newUser._id);
  } catch (walletErr) {
    console.warn(`[Warning] Wallet auto-creation skipped or deferred: ${walletErr.message}`);
  }

  return {
    user: {
      id: newUser._id.toString(),
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
    },
    isNew: true,
    upgraded: false,
    message: `New development administrator "${newUser.email}" successfully created.`,
  };
};

/**
 * CLI Entry point for manual execution by developers.
 */
export const runCli = async () => {
  try {
    assertNotProduction(process.env.NODE_ENV);

    const args = parseProvisionArgs(process.argv.slice(2), process.env);

    if (args.showHelp) {
      console.log(`
================================================================================
TreadExMine — Development Admin Provisioning Utility
================================================================================

Usage:
  node scripts/provisionAdmin.js --email <email> --password <password> --name <name>

Options:
  -e, --email       Administrator email address (required)
  -p, --password    Administrator password (required, minimum 8 characters)
  -n, --name        Administrator display name (required, 2-60 characters)
  -f, --force       Force update password if administrator already exists
  -h, --help        Show this help message

Environment Variables:
  DEV_ADMIN_EMAIL      Alternative to --email
  DEV_ADMIN_PASSWORD   Alternative to --password
  DEV_ADMIN_NAME       Alternative to --name

Security Guard:
  Execution is permanently blocked if NODE_ENV=production.
================================================================================
      `);
      process.exit(0);
    }

    console.log('[Security] Checking environment safety guard...');
    assertNotProduction(process.env.NODE_ENV);

    console.log('[Database] Connecting to development MongoDB...');
    await connectDB();

    console.log(`[Provision] Provisioning development admin: ${args.email}...`);
    const result = await provisionAdminUser(args);

    console.log('\n================================================================================');
    console.log('TREADEXMINE DEVELOPMENT ADMIN PROVISIONING SUCCESS');
    console.log('================================================================================');
    console.log(`Status:       ${result.isNew ? 'CREATED (New Admin)' : result.upgraded ? 'UPGRADED (Promoted User to Admin)' : 'UPDATED'}`);
    console.log(`Admin User:   ${result.user.name} <${result.user.email}>`);
    console.log(`User ID:      ${result.user.id}`);
    console.log(`Role:         ${result.user.role}`);
    console.log(`Message:      ${result.message}`);
    console.log('--------------------------------------------------------------------------------');
    console.log('Next Steps:');
    console.log('  1. Login via frontend: http://localhost:5173 (Click Sign In)');
    console.log('  2. Verify access to Admin Plans: http://localhost:5173/admin/plans');
    console.log('================================================================================\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('\n[ERROR] Admin provisioning aborted:');
    console.error(err.message || err);
    if (mongoose.connection?.readyState !== 0) {
      try {
        await mongoose.disconnect();
      } catch (_) {}
    }
    process.exit(1);
  }
};

// Execute if run directly from command line
const isDirectRun =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith('provisionAdmin.js'));

if (isDirectRun) {
  runCli();
}
