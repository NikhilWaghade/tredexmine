# TreadExMine — DevOps & Infrastructure Roadmap

This document outlines the DevOps, CI/CD, Containerization, and Cloud Infrastructure engineering roadmap for **TreadExMine**.

---

## Roadmap Milestones & Status Overview

| Milestone | Status | Description | Target Environment |
| :--- | :--- | :--- | :--- |
| **1. GitHub Actions CI** | **Completed** | Automated CI pipeline for frontend & backend verification | GitHub Actions (Ubuntu) |
| **2. Automated Testing** | **In Progress** | Unit, validator, and endpoint integration test suites | In-memory / Test runner |
| **3. Docker** | **Planned** | Multi-stage containerization for client and server | Docker Engine |
| **4. Docker Compose** | **Planned** | Local multi-service orchestration (Client, Server, Mongo) | Local Development |
| **5. Deployment / CD** | **Planned** | Continuous Delivery pipelines with rolling updates | Staging & Production |
| **6. Secrets Management** | **In Progress** | GitHub Secrets, environment segregation, `.env` hygiene | CI/CD & Cloud Vaults |
| **7. Monitoring & Logging** | **Planned** | Health probes, structured logs, APM, and alerting | Production Observability |
| **8. Future Enterprise Cloud** | **Planned** | AWS, Terraform IaC, Jenkins, Kubernetes (EKS/K8s) | Enterprise Cloud |

---

## Detailed Milestone Specifications

### Milestone 1: GitHub Actions CI (Completed)
- **Workflow File**: `.github/workflows/ci.yml`
- **Triggers**:
  - `push` to `development`, `develop`, `dev`, and all `feature/**` branches.
  - `pull_request` targeting `main` and `feature/project-setup`.
  - `workflow_dispatch` for manual pipeline triggers.
- **Security & Permissions**:
  - Workflow-level least privilege: `permissions: contents: read`.
  - Isolated runner environments (`ubuntu-latest`).
- **Frontend Verification Job**:
  - Node.js 20 LTS setup with npm dependency caching (`package-lock.json`).
  - Strict dependency installation via `npm ci`.
  - Code hygiene and lint enforcement via `npm run lint` (ESLint 9+ Flat Config).
  - Production bundle compilation via `npm run build` (Vite 8+ / Rolldown).
- **Backend Verification Job**:
  - Node.js 20 LTS setup with npm dependency caching (`package-lock.json`).
  - Deterministic dependency installation via `npm ci`.
  - Automated test suite execution via `npm test` (`node --test`).
  - Zero reliance on external production database connections.

### Milestone 2: Automated Testing (Foundation Complete)
- **Implemented Suites** (`server/tests/`):
  1. `tokenService.test.js`: JWT Access & Refresh token generation, expiration claims, payload verification, signature tampering rejection.
  2. `authValidators.test.js`: User registration validator rules (name, email format, password length, role boundaries) and login validator rules.
  3. `health.test.js`: Loopback integration tests for `GET /api/v1/health`, 404 handler for unmatched routes, and authorization middleware rejection on protected routes (`/api/v1/wallet`).
- **Execution Engine**: Node.js native test runner (`node:test`, `node:assert/strict`) — zero additional third-party dependencies required.
- **Future Test Phases**:
  - Integration testing with in-memory MongoDB (`mongodb-memory-server`).
  - Wallet balance deposit, transfer, and transaction ledger integration testing.
  - End-to-end API testing using mock gateways.

### Milestone 3: Docker (Planned)
- Multi-stage Dockerfile for Frontend (`client`):
  - Build stage: Node.js 20 base for `npm ci` and `vite build`.
  - Production stage: Lightweight `nginx:alpine` image serving compiled static assets with optimized HTTP/2, caching headers, and SPA fallback routing.
- Multi-stage Dockerfile for Backend (`server`):
  - Dependency stage: Node.js 20 alpine with production dependencies.
  - Runner stage: Non-root user (`USER node`), dumb-init / tini PID 1 handler, minimal attack surface.
- Custom `.dockerignore` for each tier to prevent build context pollution.

### Milestone 4: Docker Compose (Planned)
- Local orchestration file (`docker-compose.yml`) defining:
  - `treadexmine-client`: Exposed on port 5173 / 80.
  - `treadexmine-server`: Exposed on port 5000.
  - `treadexmine-mongo`: MongoDB 7.0 container with persistent volume mounts.
- Bridge network isolating internal backend communication from public entrypoints.
- Container healthchecks on `/api/v1/health` and `mongosh --eval "db.adminCommand('ping')"`.

### Milestone 5: Deployment & CD (Continuous Delivery)
- Automated deployment on pull request merge to `main` and `staging`.
- Environments:
  - **Staging**: Ephemeral preview environments or dedicated staging server for integration validation.
  - **Production**: Zero-downtime rolling update deployment.
- Rollback automation on deployment health check failure.

### Milestone 6: Secrets Management
- Enforced strict repository hygiene:
  - Never commit `.env` or configuration containing credentials.
  - Keep `.env.example` up to date with non-sensitive placeholder variables.
- GitHub Actions repository and environment secrets (`JWT_SECRET`, `MONGO_URI`, `CLOUDINARY_URL`, etc.).
- Cloud-native secret integration (AWS Secrets Manager / Parameter Store) for runtime injection.

### Milestone 7: Monitoring, Logging & Observability
- Health Probes:
  - Liveness probe: `/api/v1/health` verifying Express event loop.
  - Readiness probe: Verifying database connectivity and essential external services.
- Structured JSON logging with request correlation IDs (`x-request-id`).
- Real-time application performance monitoring (APM) and centralized log aggregation.

### Milestone 8: Future Cloud Infrastructure & Orchestration
- **Infrastructure as Code (IaC)**:
  - Terraform modules for reproducible cloud infrastructure: VPC, subnets, security groups, RDS / DocumentDB, ECS / EKS clusters, and S3 / CloudFront distributions.
- **AWS Cloud Target**:
  - Container hosting via AWS ECS Fargate or AWS EKS.
  - Database managed via AWS DocumentDB or MongoDB Atlas on AWS.
  - Static frontend assets served via Amazon CloudFront + S3.
- **Enterprise CI/CD via Jenkins**:
  - Declarative Jenkinsfile pipeline supporting hybrid enterprise CI/CD workflows and self-hosted runners.
- **Kubernetes (K8s)**:
  - Declarative manifests / Helm charts for client, server, configmaps, and secrets.
  - Horizontal Pod Autoscaling (HPA) driven by CPU / memory / request rate metrics.
  - Ingress NGINX controller with TLS termination (Let's Encrypt / cert-manager).
