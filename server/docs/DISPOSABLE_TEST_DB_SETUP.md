# Disposable Test Database Setup Guide
**Financial Operations Safety & Durability Integration Testing**

This document provides exact, reproducible instructions for provisioning disposable, isolated local MongoDB test environments for verifying financial transactions, multi-document ACID rollback, idempotency constraints, and durability guarantees.

---

## 1. Safety Boundaries & Security Invariants

> [!CAUTION]
> **STRICT SECURITY RULE: NEVER RUN INTEGRATION TESTS AGAINST REMOTE PRODUCTION OR ATLAS CLUSTERS.**
> - The test runner explicitly blocks execution against any URI containing `mongodb.net`, `atlas`, `prod`, or live cluster endpoints.
> - Integration tests require an explicit local/disposable URI passed via `MONGODB_TEST_URI`.
> - If `MONGODB_TEST_URI` is unset or points to a non-disposable host, live integration test suites are marked **UNVERIFIED / SKIPPED**.

---

## 2. Supported Topologies

| Feature | Standalone Topology | 1-Node Replica Set Topology | 3-Node Replica Set Topology |
| :--- | :--- | :--- | :--- |
| **Port** | `27018` | `27019` | `27020`, `27021`, `27022` |
| **ACID Transactions (`session.startTransaction()`)** | ❌ Not Supported | ✅ Supported | ✅ Supported |
| **Write Concern `w: 'majority'`** | ⚠️ Evaluated against single node | ✅ Acknowledged on primary | ✅ Requires consensus on 2+ nodes |
| **Journaling (`journal: true`)** | ✅ On-disk WAL flush | ✅ On-disk WAL flush | ✅ On-disk WAL flush |
| **Recommended Use** | Testing recovery fallbacks & CAS locks | Local rapid transaction & rollback testing | Full consensus & network partition testing |

---

## 3. Option A: Disposable 1-Node Replica Set via Docker (Recommended)

A single-node replica set provides full support for MongoDB multi-document ACID transactions without the resource overhead of multiple containers.

### Quick Start (PowerShell / Bash)

```bash
# 1. Run disposable MongoDB container with replica set enabled
docker run --rm -d \
  --name mongo-test-rs \
  -p 27019:27017 \
  mongo:7.0 --replSet rs0 --bind_ip_all

# 2. Initialize the replica set
docker exec -it mongo-test-rs mongosh --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'localhost:27019'}]})"

# 3. Verify replica set status
docker exec -it mongo-test-rs mongosh --eval "rs.status().ok"
```

### Running Integration Tests

```powershell
# Set the disposable test URI
$env:MONGODB_TEST_URI = "mongodb://localhost:27019/minetrades_test?replicaSet=rs0&w=majority&journal=true"

# Execute test suite
node --test tests/withdrawalRecoverySafety.test.js
```

### Teardown

```bash
docker stop mongo-test-rs
```

---

## 4. Option B: Docker Compose for Multi-Topology Testing

Create a `docker-compose.test.yml` in the repository root or server directory:

```yaml
version: '3.8'

services:
  # Standalone instance for verifying single-node crash recovery & CAS fallbacks
  mongo-standalone:
    image: mongo:7.0
    container_name: minetrades-test-standalone
    ports:
      - "27018:27017"
    command: ["mongod", "--bind_ip_all"]

  # 1-Node Replica Set for multi-document ACID transaction verification
  mongo-rs:
    image: mongo:7.0
    container_name: minetrades-test-rs
    ports:
      - "27019:27017"
    command: ["mongod", "--replSet", "rsTest", "--bind_ip_all"]
    healthcheck:
      test: mongosh --eval "try { rs.status().ok } catch (e) { rs.initiate({_id:'rsTest', members:[{_id:0, host:'localhost:27019'}]}).ok }"
      interval: 5s
      timeout: 5s
      retries: 5
```

### Launch and Initialize

```bash
docker compose -f docker-compose.test.yml up -d
```

---

## 5. Option C: Direct Binary Execution (`mongod`)

If Docker is unavailable but local MongoDB binaries are installed:

### Standalone
```powershell
mongod --dbpath C:\temp\mongo_standalone --port 27018
```

### Replica Set
```powershell
# In terminal 1
mongod --dbpath C:\temp\mongo_rs --port 27019 --replSet rs0

# In terminal 2 (one-time setup)
mongosh --port 27019 --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: '127.0.0.1:27019'}]})"
```

---

## 6. Real Database Integration Checklist

When the disposable database is active, tests verify:

1. **Transaction Rollback:**
   - Intentional abort reverts wallet decrement and un-persists draft withdrawal records.
2. **Idempotent Wallet Operations:**
   - Unique operation references (`REFUND-WTH-...`) reject duplicate credit attempts.
   - `Wallet.findOneAndUpdate` with `processedOperations: { $ne: opRef }` atomically rejects second executions.
3. **Unique Database Indexes:**
   - Enforce uniqueness on `Transaction.reference` and `Withdrawal.idempotencyKey`.
4. **Durability Options Verification:**
   - Verifies driver write concern `w: 'majority'`, `journal: true`, and `wtimeoutMS: 10000`.
5. **Concurrent Reconciliation:**
   - Race conditions between parallel workers are safely handled via atomic compare-and-swap claims.
