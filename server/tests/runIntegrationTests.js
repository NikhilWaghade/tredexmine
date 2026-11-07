import { MongoMemoryServer, MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Withdrawal } from '../src/models/Withdrawal.js';
import { Wallet } from '../src/models/Wallet.js';
import { Transaction } from '../src/models/Transaction.js';
import { WebhookEvent } from '../src/models/WebhookEvent.js';

/**
 * ============================================================================
 * MAT-23: FINANCIAL INTEGRATION TEST RUNNER (ISOLATED DISPOSABLE DATABASE)
 * ============================================================================
 *
 * Verifies real database safety, ACID rollbacks, and idempotency guarantees
 * across Standalone and Replica-Set topologies using disposable in-memory
 * MongoDB instances.
 * ============================================================================
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');

// Safety assertion: never allow non-disposable or remote hosts
const validateSafety = (uri) => {
  if (!uri) throw new Error('Security Error: Empty connection URI');
  const lower = uri.toLowerCase();
  if (lower.includes('mongodb.net') || lower.includes('atlas') || lower.includes('prod')) {
    throw new Error('SECURITY VIOLATION: Execution blocked against remote/production cluster URI');
  }
  if (!lower.includes('127.0.0.1') && !lower.includes('localhost')) {
    throw new Error('SECURITY VIOLATION: Test target must strictly be localhost/127.0.0.1');
  }
};

const runCommand = (command, args, env = {}) => {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: serverRoot,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: true,
    });

    proc.on('close', (code) => {
      resolve(code);
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
};

async function main() {
  console.log('================================================================');
  console.log('MAT-23: Financial Safety & Database Integration Verification');
  console.log('================================================================\n');

  let standaloneServer = null;
  let replicaSet = null;

  try {
    // --------------------------------------------------------------------------
    // PART 1: STANDALONE TOPOLOGY TESTING
    // --------------------------------------------------------------------------
    console.log('[Phase 1] Provisioning isolated Standalone MongoDB instance...');
    standaloneServer = await MongoMemoryServer.create({
      instance: {
        dbName: 'minetrades_disposable_standalone_test',
        launchTimeout: 60000,
      },
    });

    const standaloneUri = standaloneServer.getUri();
    validateSafety(standaloneUri);
    console.log('[Phase 1] Standalone instance active. (Target: verified local disposable host)');

    // Verify Standalone-specific topology limits and idempotency
    const standaloneConn = await mongoose.createConnection(standaloneUri).asPromise();
    try {
      const TestWallet = standaloneConn.model('Wallet', Wallet.schema);
      const TestWebhookEvent = standaloneConn.model('WebhookEvent', WebhookEvent.schema);
      await TestWallet.init();
      await TestWebhookEvent.init();

      console.log('[Phase 1] 1. Confirming multi-document transactions fail on standalone topology...');
      let txError = null;
      let session = null;
      try {
        session = await standaloneConn.startSession();
        session.startTransaction();
        await TestWallet.create(
          [{ user: new mongoose.Types.ObjectId(), balance: 100, processedOperations: [] }],
          { session }
        );
        await session.commitTransaction();
      } catch (err) {
        txError = err;
      } finally {
        if (session) {
          try { await session.abortTransaction(); } catch (_) {}
          try { await session.endSession(); } catch (_) {}
        }
      }
      assert.ok(txError, 'Expected standalone MongoDB to reject multi-document transactions');
      assert.match(
        txError.message,
        /Transaction numbers are only allowed on a replica set member or mongos|transactions|retryable writes/i
      );
      console.log('  ✔ Standalone topology correctly rejects multi-document transactions (fail-closed verified)');

      console.log('[Phase 1] 2. Confirming atomic single-document CAS idempotency on standalone...');
      const tempUser = new mongoose.Types.ObjectId();
      const opKey = `OP-STANDALONE-${Date.now()}`;
      const wallet = await TestWallet.create({
        user: tempUser,
        balance: 1000,
        processedOperations: [],
      });

      const firstMutation = await TestWallet.findOneAndUpdate(
        { _id: wallet._id, processedOperations: { $ne: opKey } },
        { $inc: { balance: 250 }, $addToSet: { processedOperations: opKey } },
        { new: true }
      );
      assert.ok(firstMutation);
      assert.strictEqual(firstMutation.balance, 1250);

      const secondMutation = await TestWallet.findOneAndUpdate(
        { _id: wallet._id, processedOperations: { $ne: opKey } },
        { $inc: { balance: 250 }, $addToSet: { processedOperations: opKey } },
        { new: true }
      );
      assert.strictEqual(secondMutation, null, 'Second mutation must be rejected by CAS query');
      console.log('  ✔ Standalone atomic CAS idempotency verified on real storage');

      console.log('[Phase 1] 3. Confirming unique compound index on { provider, eventId }...');
      const eventId = `evt_standalone_${Date.now()}`;
      await TestWebhookEvent.create({
        provider: 'razorpay',
        eventId,
        eventType: 'payment.captured',
        status: 'processing',
      });

      let dupError = null;
      try {
        await TestWebhookEvent.create({
          provider: 'razorpay',
          eventId,
          eventType: 'payment.captured',
          status: 'processing',
        });
      } catch (err) {
        dupError = err;
      }
      assert.ok(dupError);
      assert.strictEqual(dupError.code, 11000);
      console.log('  ✔ Duplicate provider+eventId rejected by real database E11000 constraint');
    } finally {
      await standaloneConn.close();
    }

    console.log('[Phase 1] Standalone pre-flight checks passed successfully.\n');

    // --------------------------------------------------------------------------
    // PART 2: REPLICA SET TOPOLOGY TESTING
    // --------------------------------------------------------------------------
    console.log('[Phase 2] Provisioning isolated 1-Node Replica Set instance (ACID supported)...');
    replicaSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        name: 'rsTest',
        dbName: 'minetrades_disposable_rs_test',
      },
      instanceOpts: [
        {
          launchTimeout: 60000,
        },
      ],
    });

    const replSetUri = replicaSet.getUri();
    validateSafety(replSetUri);
    console.log('[Phase 2] Replica Set instance active. (Target: verified local disposable host)');

    // Verify Replica Set transaction rollback behavior
    const rsConn = await mongoose.createConnection(replSetUri).asPromise();
    try {
      const TestWallet = rsConn.model('Wallet', Wallet.schema);
      const TestTransaction = rsConn.model('Transaction', Transaction.schema);
      const TestWebhookEvent = rsConn.model('WebhookEvent', WebhookEvent.schema);
      await TestWallet.init();
      await TestTransaction.init();
      await TestWebhookEvent.init();

      console.log('[Phase 2] 1. Confirming multi-document ACID transaction rollback across entities...');
      const session = await rsConn.startSession();
      session.startTransaction();

      const tempUser = new mongoose.Types.ObjectId();
      const testEvtId = `evt_rollback_${Date.now()}`;
      const testRef = `TX-ROLLBACK-${Date.now()}`;

      const [w] = await TestWallet.create(
        [{ user: tempUser, balance: 500, processedOperations: [] }],
        { session }
      );
      await TestTransaction.create(
        [
          {
            user: tempUser,
            wallet: w._id,
            type: 'credit',
            amount: 500,
            status: 'completed',
            reference: testRef,
            balanceBefore: 0,
            balanceAfter: 500,
          },
        ],
        { session }
      );
      await TestWebhookEvent.create(
        [
          {
            provider: 'razorpay',
            eventId: testEvtId,
            eventType: 'payment.captured',
            status: 'processing',
          },
        ],
        { session }
      );

      // Abort transaction
      await session.abortTransaction();
      await session.endSession();

      // Verify complete rollback from database reads
      const checkWallet = await TestWallet.findOne({ user: tempUser });
      const checkTx = await TestTransaction.findOne({ reference: testRef });
      const checkEvt = await TestWebhookEvent.findOne({ eventId: testEvtId });

      assert.strictEqual(checkWallet, null, 'Wallet must be rolled back');
      assert.strictEqual(checkTx, null, 'Transaction must be rolled back');
      assert.strictEqual(checkEvt, null, 'WebhookEvent must be rolled back');
      console.log('  ✔ Multi-document transaction rollback verified: all 3 collections restored cleanly');
    } finally {
      await rsConn.close();
    }

    console.log('[Phase 2] Replica Set pre-flight checks passed successfully.\n');

    // --------------------------------------------------------------------------
    // PART 3: RUN THE 6 PREVIOUSLY SKIPPED INTEGRATION TESTS
    // --------------------------------------------------------------------------
    console.log('[Phase 3] Running integration test suite against disposable Replica Set...');
    const testEnv = {
      MONGODB_TEST_URI: replSetUri,
    };

    console.log('--- Executing withdrawalRecoverySafety.test.js ---');
    const exitCode1 = await runCommand('node', ['--test', 'tests/withdrawalRecoverySafety.test.js'], testEnv);
    assert.strictEqual(exitCode1, 0, `withdrawalRecoverySafety.test.js exited with non-zero code ${exitCode1}`);

    console.log('\n--- Executing webhookDeduplication.test.js ---');
    const exitCode2 = await runCommand('node', ['--test', 'tests/webhookDeduplication.test.js'], testEnv);
    assert.strictEqual(exitCode2, 0, `webhookDeduplication.test.js exited with non-zero code ${exitCode2}`);

    console.log('\n--- Executing adminWebhookQuarantine.test.js ---');
    const exitCode3 = await runCommand('node', ['--test', 'tests/adminWebhookQuarantine.test.js'], testEnv);
    assert.strictEqual(exitCode3, 0, `adminWebhookQuarantine.test.js exited with non-zero code ${exitCode3}`);

    console.log('\n================================================================');
    console.log('ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY AGAINST REAL MONGODB');
    console.log('================================================================');
  } finally {
    console.log('\n[Teardown] Cleaning up disposable database instances...');
    if (standaloneServer) {
      await standaloneServer.stop();
      console.log('[Teardown] Standalone instance stopped.');
    }
    if (replicaSet) {
      await replicaSet.stop();
      console.log('[Teardown] Replica Set instance stopped.');
    }
  }
}

main().catch((err) => {
  console.error('\n[FATAL ERROR]', err.message);
  process.exit(1);
});
