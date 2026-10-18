import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

// Ensure environment variables from server/.env are loaded regardless of current working directory
// Preserve pre-existing environment variables such as explicit NODE_ENV=production
const originalNodeEnv = process.env.NODE_ENV;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
if (originalNodeEnv) {
  process.env.NODE_ENV = originalNodeEnv;
}

import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { Transaction } from '../src/models/Transaction.js';
import { getWalletByUserId } from '../src/services/walletService.js';
import { connectDB } from '../src/config/db.js';

/**
 * Asserts that the current environment is not production.
 * @param {string} [env]
 * @throws {Error} If environment is production
 */
export const assertNotProduction = (env = process.env.NODE_ENV) => {
  if (env === 'production') {
    const error = new Error(
      '[SECURITY ERROR] fundTestWallet script is strictly for development and testing. Execution is blocked in production (NODE_ENV=production).'
    );
    error.code = 'ERR_PRODUCTION_BLOCKED';
    throw error;
  }
};

/**
 * Parses CLI arguments and environment variables for wallet funding.
 * @param {Array<string>} [argv]
 * @param {Object} [env]
 * @returns {{ userId: string, amount: number, reference: string, showHelp: boolean }}
 */
export const parseFundingArgs = (argv = process.argv.slice(2), env = process.env) => {
  let userId = env.TEST_USER_ID || env.USER_ID || '';
  let amount = env.FUND_AMOUNT || env.AMOUNT || '';
  let reference = env.FUNDING_REFERENCE || env.REFERENCE || '';
  let showHelp = false;

  const positionalArgs = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      showHelp = true;
      continue;
    }

    if (arg === '--user' || arg === '-u') {
      userId = argv[++i] || '';
    } else if (arg.startsWith('--user=')) {
      userId = arg.split('=')[1] || '';
    } else if (arg === '--userId' || arg.startsWith('--userId=')) {
      userId = arg.includes('=') ? arg.split('=')[1] : argv[++i] || '';
    } else if (arg === '--amount' || arg === '-a') {
      amount = argv[++i] || '';
    } else if (arg.startsWith('--amount=')) {
      amount = arg.split('=')[1] || '';
    } else if (arg === '--reference' || arg === '-r' || arg === '--ref') {
      reference = argv[++i] || '';
    } else if (arg.startsWith('--reference=') || arg.startsWith('--ref=')) {
      reference = arg.split('=')[1] || '';
    } else if (!arg.startsWith('-')) {
      positionalArgs.push(arg);
    }
  }

  // Fallback to positional arguments: [userId, amount, reference]
  if (positionalArgs.length > 0) {
    if (!userId && positionalArgs[0]) {
      userId = positionalArgs[0];
    }
    if ((amount === '' || isNaN(Number(amount))) && positionalArgs[1]) {
      amount = positionalArgs[1];
    }
    if (!reference && positionalArgs[2]) {
      reference = positionalArgs[2];
    }
  }

  return {
    userId: String(userId).trim(),
    amount: amount !== '' ? Number(amount) : NaN,
    reference: reference ? String(reference).trim() : '',
    showHelp,
  };
};

/**
 * Validates funding inputs.
 * @param {Object} params
 * @param {string} params.userId
 * @param {number} params.amount
 */
export const validateFundingInputs = ({ userId, amount }) => {
  if (!userId) {
    const error = new Error('Missing required test user ID. Provide via --user <userId> or TEST_USER_ID env.');
    error.code = 'ERR_INVALID_USER_ID';
    throw error;
  }

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    const error = new Error(`Invalid user ID format: "${userId}". Must be a valid 24-character hexadecimal ObjectId.`);
    error.code = 'ERR_INVALID_USER_ID';
    throw error;
  }

  if (typeof amount !== 'number' || isNaN(amount) || !isFinite(amount) || amount <= 0) {
    const error = new Error(`Invalid funding amount: "${amount}". Amount must be a positive finite number greater than 0.`);
    error.code = 'ERR_INVALID_AMOUNT';
    throw error;
  }
};

/**
 * Safe development-only wallet funding function.
 * Atomically credits a user's wallet balance and records a completed credit Transaction ledger entry.
 * Idempotent: Rerunning with the same reference does not credit the balance twice.
 *
 * @param {Object} options
 * @param {string} options.userId - Target user MongoDB ObjectId
 * @param {number} options.amount - Positive amount to credit
 * @param {string} [options.reference] - Idempotency reference key (generated if omitted)
 * @param {string} [options.env] - Current runtime environment (defaults to process.env.NODE_ENV)
 * @param {mongoose.ClientSession} [options.session] - Optional pre-existing session (for testing)
 * @returns {Promise<{ isIdempotent: boolean, reference: string, user: Object, wallet: Object, transaction: Object, message: string }>}
 */
export const fundTestWallet = async (options = {}) => {
  const {
    userId,
    amount,
    reference: userRef,
    env = process.env.NODE_ENV,
    session: providedSession = null,
  } = options;

  // 1. Guard against executing in production environment
  assertNotProduction(env);

  // 2. Validate user ID format and funding amount
  validateFundingInputs({ userId, amount });

  const numAmount = Math.round(Number(amount) * 100) / 100;

  // 3. Resolve deterministic reference key if not explicitly passed
  const reference = userRef && String(userRef).trim().length > 0
    ? String(userRef).trim()
    : `dev-fund-${userId}-${numAmount}`;

  // 4. Verify user exists in the database
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error(`User not found with ID: ${userId}`);
    error.code = 'ERR_USER_NOT_FOUND';
    throw error;
  }

  // 5. Pre-check idempotency outside transaction
  const existingTx = await Transaction.findOne({ reference });
  if (existingTx) {
    const wallet = await getWalletByUserId(userId);
    return {
      isIdempotent: true,
      reference,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
      },
      wallet: {
        id: wallet?._id ? wallet._id.toString() : '',
        balance: wallet?.balance ?? 0,
      },
      transaction: existingTx,
      message: `Funding reference "${reference}" has already been processed. No duplicate credit applied.`,
    };
  }

  // 6. Check transaction support on the active database connection
  let session = providedSession;
  let transactionStarted = false;
  let ownSession = false;

  if (!session && mongoose.connection?.readyState === 1) {
    try {
      session = await mongoose.startSession();
      session.startTransaction();
      transactionStarted = true;
      ownSession = true;
    } catch (sessionErr) {
      if (session) {
        try {
          await session.endSession();
        } catch (_) {}
        session = null;
      }
      transactionStarted = false;
    }
  } else if (session) {
    transactionStarted = true;
  }

  if (!transactionStarted || !session) {
    const error = new Error(
      'MongoDB session transactions are unavailable on this database connection (transactions require a replica set or mongos cluster, such as MongoDB Atlas). Wallet funding was aborted safely to prevent non-atomic or partial updates.'
    );
    error.code = 'TRANSACTIONS_UNAVAILABLE';
    throw error;
  }

  try {
    // 7. Ensure wallet exists within the transaction session
    const walletQuery = Wallet.findOne({ user: userId });
    let wallet = typeof walletQuery?.session === 'function'
      ? await walletQuery.session(session)
      : await walletQuery;

    if (!wallet) {
      const created = await Wallet.create([{ user: userId, balance: 0 }], { session });
      wallet = Array.isArray(created) ? created[0] : created;
    }

    // 8. Re-check idempotency within transaction session to guard against concurrent writes
    const sessionTxQuery = Transaction.findOne({ reference });
    const sessionTx = typeof sessionTxQuery?.session === 'function'
      ? await sessionTxQuery.session(session)
      : await sessionTxQuery;

    if (sessionTx) {
      if (ownSession) {
        await session.abortTransaction();
      }
      return {
        isIdempotent: true,
        reference,
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
        },
        wallet: {
          id: wallet?._id ? wallet._id.toString() : '',
          balance: wallet?.balance ?? 0,
        },
        transaction: sessionTx,
        message: `Funding reference "${reference}" has already been processed. No duplicate credit applied.`,
      };
    }

    // 9. Record completed credit Transaction ledger entry
    const transactionData = {
      user: user._id,
      wallet: wallet._id,
      type: 'credit',
      amount: numAmount,
      description: `Development test wallet funding: +$${numAmount.toFixed(2)} [Ref: ${reference}]`,
      status: 'completed',
      reference,
    };

    const createdTxs = await Transaction.create([transactionData], { session });
    const transaction = Array.isArray(createdTxs) ? createdTxs[0] : createdTxs;

    // 10. Atomically increment wallet balance within the same session
    const updatedWallet = await Wallet.findOneAndUpdate(
      { _id: wallet._id },
      { $inc: { balance: numAmount } },
      { new: true, session }
    );

    if (ownSession) {
      await session.commitTransaction();
    }

    return {
      isIdempotent: false,
      reference,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
      },
      wallet: {
        id: updatedWallet?._id ? updatedWallet._id.toString() : wallet._id.toString(),
        balance: updatedWallet?.balance ?? (wallet.balance + numAmount),
      },
      transaction,
      message: `Successfully credited $${numAmount.toFixed(2)} to user ${user.email}. New wallet balance: $${(updatedWallet?.balance ?? (wallet.balance + numAmount)).toFixed(2)}.`,
    };
  } catch (error) {
    if (ownSession && transactionStarted && session) {
      try {
        await session.abortTransaction();
      } catch (_) {}
    }
    throw error;
  } finally {
    if (ownSession && session) {
      try {
        await session.endSession();
      } catch (_) {}
    }
  }
};

/**
 * Print formatted usage guide
 */
const printUsage = () => {
  console.log(`
================================================================================
TreadExMine - Safe Development Wallet Funding Script
================================================================================

USAGE:
  node scripts/fundTestWallet.js --user <USER_ID> --amount <AMOUNT> [--reference <REF>]
  node scripts/fundTestWallet.js <USER_ID> <AMOUNT> [<REF>]

OPTIONS:
  -u, --user, --userId       (Required) Valid 24-character hexadecimal MongoDB User ID
  -a, --amount               (Required) Positive funding amount (e.g., 500 or 1000.50)
  -r, --ref, --reference     (Optional) Unique idempotency reference (defaults to deterministic key)
  -h, --help                 Show this help screen

ENVIRONMENT VARIABLES (Alternative to CLI flags):
  TEST_USER_ID               Target test user ObjectId
  FUND_AMOUNT                Funding amount
  FUNDING_REFERENCE          Optional idempotency reference

EXAMPLES (PowerShell):
  # 1. Fund $500 to a specific test user:
  node scripts/fundTestWallet.js --user 652a1234567890abcdef1234 --amount 500

  # 2. Fund with an explicit idempotency reference:
  node scripts/fundTestWallet.js --user 652a1234567890abcdef1234 --amount 500 --reference dev-fund-run-01

  # 3. Using PowerShell environment variables:
  $env:TEST_USER_ID="652a1234567890abcdef1234"; $env:FUND_AMOUNT="500"; node scripts/fundTestWallet.js

SECURITY & INTEGRITY:
  - Execution is strictly blocked when NODE_ENV=production.
  - Requires explicit user ID and positive amount (never funds arbitrary users).
  - Uses atomic MongoDB session transactions (supported on MongoDB Atlas).
  - Rerunning with the same reference is idempotent and will not credit twice.
================================================================================
`);
};

/**
 * Main CLI execution runner
 */
export const runCli = async () => {
  try {
    assertNotProduction();

    const { userId, amount, reference, showHelp } = parseFundingArgs();

    if (showHelp) {
      printUsage();
      process.exit(0);
    }

    if (!userId || isNaN(amount)) {
      console.error('\n[ERROR] Both user ID and a positive funding amount are required.\n');
      printUsage();
      process.exit(1);
    }

    console.log('[Database] Connecting to MongoDB...');
    await connectDB();

    console.log(`[Funding] Initiating development funding for user: ${userId}...`);
    const result = await fundTestWallet({ userId, amount, reference });

    console.log('\n================================================================================');
    console.log('TREADEXMINE DEVELOPMENT WALLET FUNDING SUCCESS');
    console.log('================================================================================');
    console.log(`Status:       ${result.isIdempotent ? 'ALREADY PROCESSED (Idempotent - No Balance Change)' : 'SUCCESS'}`);
    console.log(`User:         ${result.user.name} <${result.user.email}> (Role: ${result.user.role})`);
    console.log(`User ID:      ${result.user.id}`);
    console.log(`Amount:       +$${Number(result.transaction.amount).toFixed(2)}`);
    console.log(`New Balance:  $${Number(result.wallet.balance).toFixed(2)}`);
    console.log(`Tx ID:        ${result.transaction._id}`);
    console.log(`Tx Type:      ${result.transaction.type}`);
    console.log(`Tx Status:    ${result.transaction.status}`);
    console.log(`Reference:    ${result.reference}`);
    console.log(`Description:  ${result.transaction.description}`);
    console.log('================================================================================\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('\n[ERROR] Failed to fund test wallet:');
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
    process.argv[1].endsWith('fundTestWallet.js'));

if (isDirectRun) {
  runCli();
}
