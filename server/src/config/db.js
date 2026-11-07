import mongoose from 'mongoose';

/**
 * ============================================================================
 * FINANCIAL DATABASE DURABILITY & WRITE CONCERN SPECIFICATION
 * ============================================================================
 *
 * In a financial ledger system, database operations must distinguish three
 * distinct tiers of consistency and durability:
 *
 * 1. WRITE ACKNOWLEDGMENT (w):
 *    Controls how many MongoDB nodes must acknowledge a write before the client
 *    receives success. In production replica sets, 'majority' write acknowledgment
 *    ensures that mutations cannot be rolled back if the primary steps down.
 *
 * 2. ON-DISK DURABILITY (journal / j):
 *    Ensures that acknowledged operations are written to the WiredTiger write-ahead
 *    journal on disk before acknowledgment. This protects against data loss in the
 *    event of an abrupt host crash, OS kernel panic, or power interruption.
 *
 * 3. MULTI-DOCUMENT TRANSACTION GUARANTEES:
 *    Transactions provide ACID multi-document atomicity and snapshot isolation.
 *    They are ONLY available on replica set or sharded deployments. On standalone
 *    MongoDB instances, multi-document transactions are UNSUPPORTED; such environments
 *    must rely strictly on atomic single-document CAS queries ($inc, $addToSet, $ne)
 *    and compensating forward-reconciliation rather than claiming cross-document atomicity.
 * ============================================================================
 */

/**
 * Derives appropriate durability and driver options based on environment and topology
 * @param {string} [env=process.env.NODE_ENV]
 * @param {Object} [customConfig={}]
 * @returns {Object} Mongoose connection options
 */
export const getDurabilityOptions = (env = process.env.NODE_ENV, customConfig = {}) => {
  const isProd = env === 'production';
  const customW = customConfig.w !== undefined ? customConfig.w : process.env.MONGO_WRITE_CONCERN;
  const customJ = customConfig.journal !== undefined ? customConfig.journal : process.env.MONGO_JOURNAL;
  const customTimeout = customConfig.wtimeoutMS !== undefined ? customConfig.wtimeoutMS : parseInt(process.env.MONGO_WTIMEOUT_MS, 10);

  return {
    // Write acknowledgment: 'majority' in production to guarantee consensus across replica set nodes
    w: customW !== undefined ? (isNaN(Number(customW)) ? customW : Number(customW)) : (isProd ? 'majority' : 1),
    // Journaling: ensures write is committed to on-disk journal before acknowledgment
    journal: customJ !== undefined ? (typeof customJ === 'boolean' ? customJ : customJ === 'true') : true,
    // Prevent operations from hanging indefinitely if a secondary stalls
    wtimeoutMS: !isNaN(customTimeout) && customTimeout > 0 ? customTimeout : 10000,
    // Automatic retry of transient network write errors
    retryWrites: true,
  };
};

/**
 * Validates that active database topology and configuration satisfy the durability policy
 * @param {mongoose.Mongoose|string} connOrEnv
 * @param {Object|string} [topologyOrOptions={}]
 * @param {Object} [optionsMaybe={}]
 * @returns {{ isCompliant: boolean, topology: string, effectivePolicy: Object }}
 */
export const validateDurabilityPolicy = (connOrEnv, topologyOrOptions = {}, optionsMaybe = {}) => {
  let env = process.env.NODE_ENV;
  let topology = 'unknown';
  let options = {};
  let conn = null;

  if (typeof connOrEnv === 'string') {
    env = connOrEnv;
    topology = typeof topologyOrOptions === 'string' ? topologyOrOptions : 'unknown';
    options = optionsMaybe || {};
  } else if (connOrEnv && typeof connOrEnv === 'object') {
    conn = connOrEnv;
    topology = conn.connection?.client?.topology?.description?.type || 'Unknown';
    options = topologyOrOptions || {};
  }

  const isProd = env === 'production';

  // Security & Compliance: Fail closed if production writes are unacknowledged or journal disabled
  if (isProd) {
    if (options.w === 0 || options.w === '0' || options.w === false || options.journal === false) {
      throw new Error(
        'FATAL DURABILITY POLICY VIOLATION: Production deployment requires acknowledged majority writes and on-disk journaling.'
      );
    }
  } else {
    if (options.w === 0 || options.w === '0') {
      throw new Error(
        '[DurabilityPolicy] Unacknowledged writes (w: 0) are strictly forbidden in financial ledger environments'
      );
    }
  }

  // Fail closed if production is running on standalone topology
  const isStandalone =
    topology === 'standalone' ||
    topology === 'Single' ||
    topology === 'standalone_instance';
  if (isProd && isStandalone) {
    throw new Error(
      'FATAL TOPOLOGY POLICY VIOLATION: Production deployment requires a replica-set or sharded cluster topology.'
    );
  }

  // Safe structured logging: Never log connection strings or credentials
  if (conn) {
    const host = conn.connection?.host || 'unknown-host';
    const dbName = conn.connection?.name || 'unknown-db';
    console.log(
      `[MongoDB] Connected successfully: ${host} | Database: "${dbName}" | Topology: ${topology} | WriteConcern: ${options.w} | Journal: ${options.journal}`
    );
  }

  return {
    isCompliant: true,
    topology,
    effectivePolicy: options,
  };
};

/**
 * Connect to MongoDB database instance with verified durability options
 */
export const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/treadexmine';
  const options = getDurabilityOptions();

  try {
    const conn = await mongoose.connect(uri, options);
    validateDurabilityPolicy(conn, options);
    return conn;
  } catch (error) {
    console.error(`[MongoDB] Connection error: ${error.message}`);
    throw error;
  }
};

// Monitor connection events
mongoose.connection.on('disconnected', () => {
  console.warn('[MongoDB] Database connection disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error(`[MongoDB] Database error: ${err.message}`);
});

export default connectDB;
