# Authentication System — Production & SRE Guide

**Document Status**: Active  
**Last Updated**: 2026-08-07  
**Author**: SRE Team  
**Audience**: SRE, Platform Engineering, Security, On-Call Engineers

---

## Table of Contents

1. [Deployment Architecture](#1-deployment-architecture)
2. [AWS Infrastructure](#2-aws-infrastructure)
3. [Docker & Container Strategy](#3-docker--container-strategy)
4. [Load Balancing](#4-load-balancing)
5. [Auto Scaling](#5-auto-scaling)
6. [Monitoring & Observability](#6-monitoring--observability)
7. [Logging](#7-logging)
8. [Distributed Tracing](#8-distributed-tracing)
9. [Alerts & On-Call](#9-alerts--on-call)
10. [Backup Strategy](#10-backup-strategy)
11. [Disaster Recovery](#11-disaster-recovery)
12. [Incident Response](#12-incident-response)
13. [Failure Scenarios](#13-failure-scenarios)
14. [Cost Model](#14-cost-model)

---

## 1. Deployment Architecture

### 1.1 Overview

WHY this topology: The auth system is the single most critical path in the platform. Every user request that requires identity passes through it. The architecture is designed around three SRE principles: eliminate single points of failure, degrade gracefully rather than fail completely, and make every failure mode observable before it becomes an incident.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AWS us-east-1 (Primary)                      │
│                                                                     │
│  Route53 (health check routing, latency-based)                      │
│       │                                                             │
│       ▼                                                             │
│  CloudFront (WAF, DDoS protection, edge caching for static assets)  │
│       │                                                             │
│       ▼                                                             │
│  ALB (TLS termination, sticky sessions OFF, connection draining)    │
│       │                           │                                 │
│       ▼                           ▼                                 │
│  Nginx ECS (AZ-a)          Nginx ECS (AZ-b)                        │
│  [rate limiting,            [rate limiting,                         │
│   request routing]          request routing]                        │
│       │                           │                                 │
│       ▼                           ▼                                 │
│  NestJS Auth (AZ-a, 2-20)  NestJS Auth (AZ-b, 2-20)               │
│  Next.js Web  (AZ-a, 2-10) Next.js Web  (AZ-b, 2-10)              │
│       │                           │                                 │
│       └──────────┬────────────────┘                                │
│                  ▼                                                  │
│     ┌────────────────────────┐                                      │
│     │   ElastiCache Redis    │                                      │
│     │  Primary (AZ-a)        │                                      │
│     │  Replica (AZ-b)        │  ← auto-failover < 60s              │
│     └────────────────────────┘                                      │
│     ┌────────────────────────┐                                      │
│     │  MongoDB Atlas M30     │                                      │
│     │  Primary (AZ-a)        │                                      │
│     │  Secondary (AZ-b)      │  ← auto-election < 10s              │
│     │  Secondary (AZ-c)      │                                      │
│     └────────────────────────┘                                      │
│                                                                     │
│  ┌─────────────────────────────────┐                                │
│  │  Supporting Services            │                                │
│  │  AWS SES (email)                │                                │
│  │  AWS Secrets Manager (keys)     │                                │
│  │  AWS S3 (audit WORM, backups)   │                                │
│  │  AWS CloudWatch (logs, metrics) │                                │
│  │  AWS X-Ray (tracing)            │                                │
│  └─────────────────────────────────┘                                │
└─────────────────────────────────────────────────────────────────────┘
                                │
                         (Phase 4 only)
                                │
┌───────────────────────────────┴─────────────────────────────────────┐
│                        AWS eu-west-1 (DR / Secondary)               │
│  Same topology, warm standby, Route53 failover target               │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Multi-AZ Strategy

WHY two AZs minimum: An AZ failure (rare but documented AWS events) would take down any single-AZ service. Spreading NestJS, Nginx, Redis, and MongoDB across at least two AZs ensures an AZ failure is a degraded-capacity event, not an outage.

| Component | AZ-a | AZ-b | AZ-c | Failover Time |
|---|---|---|---|---|
| ALB | ✓ | ✓ | — | Automatic (DNS) |
| Nginx ECS | 1-5 tasks | 1-5 tasks | — | ECS respawns < 30s |
| NestJS ECS | 1-10 tasks | 1-10 tasks | — | ECS respawns < 30s |
| Next.js ECS | 1-5 tasks | 1-5 tasks | — | ECS respawns < 30s |
| ElastiCache | Primary | Replica | — | Auto-failover < 60s |
| MongoDB Atlas | Primary | Secondary | Secondary | Auto-election < 10s |


---

## 2. AWS Infrastructure

### 2.1 Network Architecture (VPC)

```
VPC: 10.0.0.0/16

Public Subnets (ALB, NAT Gateway):
  10.0.1.0/24  (AZ-a)
  10.0.2.0/24  (AZ-b)

Private Subnets (ECS tasks):
  10.0.11.0/24 (AZ-a)
  10.0.12.0/24 (AZ-b)

Data Subnets (Redis, MongoDB VPC peering):
  10.0.21.0/24 (AZ-a)
  10.0.22.0/24 (AZ-b)

Security Groups:
  sg-alb:        inbound 443 from 0.0.0.0/0
  sg-nginx:      inbound 80 from sg-alb only
  sg-nestjs:     inbound 3000 from sg-nginx only
  sg-redis:      inbound 6379 from sg-nestjs only
  sg-mongo:      inbound 27017 from sg-nestjs only (via Atlas VPC peering)
```

WHY private subnets for ECS: Application tasks must never be directly addressable from the internet. All inbound traffic flows through ALB → Nginx → NestJS. A misconfigured ECS task cannot be reached directly.

### 2.2 ECS Task Definitions

```json
// NestJS Auth API task definition
{
  "family": "auth-api",
  "cpu": "512",
  "memory": "1024",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::ACCOUNT:role/auth-task-role",
  "containerDefinitions": [{
    "name": "auth-api",
    "image": "ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/auth-api:${IMAGE_TAG}",
    "portMappings": [{ "containerPort": 3000, "protocol": "tcp" }],
    "environment": [
      { "name": "NODE_ENV", "value": "production" },
      { "name": "PORT", "value": "3000" }
    ],
    "secrets": [
      { "name": "MONGO_URI",        "valueFrom": "/prod/auth/mongo-uri" },
      { "name": "REDIS_URL",        "valueFrom": "/prod/auth/redis-url" },
      { "name": "JWT_SECRET",       "valueFrom": "/prod/auth/jwt-secret" },
      { "name": "GOOGLE_CLIENT_ID", "valueFrom": "/prod/auth/google-client-id" },
      { "name": "GOOGLE_SECRET",    "valueFrom": "/prod/auth/google-secret" }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/auth-api",
        "awslogs-region": "us-east-1",
        "awslogs-stream-prefix": "ecs"
      }
    },
    "healthCheck": {
      "command": ["CMD-SHELL", "curl -f http://localhost:3000/api/v1/auth/health || exit 1"],
      "interval": 30,
      "timeout": 5,
      "retries": 3,
      "startPeriod": 60
    },
    "stopTimeout": 30
  }]
}
```

### 2.3 IAM Least-Privilege Roles

```json
// auth-task-role — only what NestJS needs at runtime
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadSecrets",
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": ["arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:/prod/auth/*"]
    },
    {
      "Sid": "WriteLogs",
      "Effect": "Allow",
      "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": ["arn:aws:logs:us-east-1:ACCOUNT:log-group:/ecs/auth-api:*"]
    },
    {
      "Sid": "WriteMetrics",
      "Effect": "Allow",
      "Action": ["cloudwatch:PutMetricData"],
      "Resource": "*",
      "Condition": { "StringEquals": { "cloudwatch:namespace": "AuthService" } }
    },
    {
      "Sid": "Tracing",
      "Effect": "Allow",
      "Action": ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
      "Resource": "*"
    },
    {
      "Sid": "SendEmail",
      "Effect": "Allow",
      "Action": ["ses:SendTemplatedEmail"],
      "Resource": "arn:aws:ses:us-east-1:ACCOUNT:identity/noreply@example.com"
    }
  ]
}
```

WHY no S3 in the task role: Audit log S3 writes happen via a separate worker process with its own role, not from the auth API task. Principle of least privilege — the API never touches S3 directly.

### 2.4 AWS Secrets Manager

```
Secret paths:
  /prod/auth/mongo-uri          → MongoDB Atlas connection string
  /prod/auth/redis-url          → ElastiCache Redis connection string
  /prod/auth/jwt-secret         → JWT signing key (current)
  /prod/auth/jwt-secret-prev    → JWT signing key (previous, 15-min grace period on rotation)
  /prod/auth/google-client-id
  /prod/auth/google-secret
  /prod/auth/github-client-id
  /prod/auth/github-secret
  /prod/auth/session-hmac-key   → HMAC key for refresh token hashing
  /prod/auth/kms-key-id         → KMS key for TOTP secret encryption

Rotation policy:
  jwt-secret:      manual rotation (SRE-triggered, requires coordinated deployment)
  session-hmac-key: manual rotation (invalidates all sessions — planned maintenance)
  OAuth secrets:   rotate every 90 days (AWS Secrets Manager automatic rotation)

Access:
  auth-task-role:    GetSecretValue on /prod/auth/*
  No other role has access — enforced by resource policy
```


---

## 3. Docker & Container Strategy

### 3.1 Production Dockerfile (Multi-Stage, Hardened)

```dockerfile
# ── Stage 1: dependency installation ──────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# WHY: Copy only package files first — Docker layer cache means npm ci
# only re-runs when dependencies actually change, not on every code change
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci   # includes devDependencies for build
COPY . .
RUN npm run build

# ── Stage 3: production runtime ───────────────────────────────────────────────
FROM node:20-alpine AS runner

# WHY: Run as non-root. If the container is compromised,
# the attacker cannot write to most of the filesystem.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nestjs

WORKDIR /app

# Copy only build artifacts and production node_modules
COPY --from=deps    --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist         ./dist
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./

USER nestjs

ENV NODE_ENV=production
ENV PORT=3000

# WHY EXPOSE is documentation only — ECS ignores it, but it signals the intended port
EXPOSE 3000

# WHY: Use node directly, not npm start.
# npm adds an extra process layer. node is PID 1, handles SIGTERM correctly.
CMD ["node", "dist/main.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/auth/health || exit 1
```

### 3.2 docker-compose for Local Development

```yaml
# docker-compose.yml (local dev only — not used in production)
services:
  auth-api:
    build:
      context: apps/backend
      target: builder          # use builder stage for hot reload
    command: npm run start:dev
    ports:
      - "3001:3000"
    environment:
      NODE_ENV: development
      MONGO_URI: mongodb://mongo:27017/auth_dev
      REDIS_URL: redis://redis:6379
      JWT_SECRET: dev-secret-change-in-prod
    volumes:
      - ./apps/backend/src:/app/src:ro   # read-only mount — prevents accidental host writes
    depends_on:
      mongo: { condition: service_healthy }
      redis: { condition: service_healthy }

  mongo:
    image: mongo:7
    ports: ["27017:27017"]
    volumes: [mongo_dev:/data/db]
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    command: redis-server --save 60 1 --loglevel warning
    volumes: [redis_dev:/data]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

volumes:
  mongo_dev:
  redis_dev:
```

### 3.3 Container Security Hardening

```dockerfile
# Additional hardening applied in production image:

# 1. Read-only root filesystem (enforced at ECS task definition level)
#    containerDefinitions[].readonlyRootFilesystem: true
#    Writable paths mounted explicitly: /tmp, /var/tmp only

# 2. No new privileges
#    containerDefinitions[].linuxParameters.initProcessEnabled: false

# 3. Drop all Linux capabilities
#    containerDefinitions[].linuxParameters.capabilities.drop: ["ALL"]

# 4. Distroless base consideration:
#    Using node:20-alpine because distroless/nodejs has no shell for health checks.
#    Alpine is the pragmatic choice — smaller than full node image, has wget for healthchecks.

# 5. Image scanning:
#    ECR image scanning enabled — AWS Inspector scans on every push
#    CI pipeline blocks on CRITICAL findings
```

### 3.4 CI/CD Deployment Pipeline

```
Developer push → GitHub main branch
        │
        ▼
GitHub Actions CI:
  ├── npm test (unit + integration)
  ├── npm run lint
  ├── Docker build --target runner
  ├── Docker push → ECR (tagged with git SHA)
  └── AWS Inspector scan → fail on CRITICAL CVEs
        │
        ▼
        [manual approval gate for production]
        │
        ▼
GitHub Actions CD:
  ├── Update ECS task definition (new image tag)
  ├── ECS rolling deployment (25% max unavailable, 100% max healthy)
  ├── Wait for deployment stability (all tasks healthy)
  └── Smoke test: curl /api/v1/auth/health → assert 200
        │
        ▼ (on failure)
  ECS automatic rollback to previous task definition
```

WHY rolling deployment over blue/green: Auth is stateless (sessions in Redis). A new task starts taking traffic immediately as old tasks drain. Blue/green would double the infrastructure cost during deployment for a service that doesn't need it.


---

## 4. Load Balancing

### 4.1 ALB Configuration

```
ALB settings:
  Scheme: internet-facing
  IP address type: ipv4
  Idle timeout: 60 seconds  (WHY: auth requests complete in <1s; long idle = waste)
  Connection draining: 30 seconds (WHY: in-flight requests complete before task shutdown)
  Access logs: S3 bucket auth-alb-logs (WHY: ALB logs are the source of truth for traffic forensics)
  Deletion protection: ENABLED (WHY: prevent accidental terraform destroy in production)

Target group:
  Target type: IP (Fargate requires IP mode, not instance mode)
  Protocol: HTTP/2
  Port: 3000
  Health check path: /api/v1/auth/health
  Health check interval: 30s
  Healthy threshold: 2
  Unhealthy threshold: 3
  Deregistration delay: 30s  (must match stopTimeout in task definition)

Listener rules (port 443):
  1. /api/*    → forward to auth-api target group
  2. /*        → forward to nextjs target group
  3. Default   → 404 fixed response
```

WHY health check every 30s with threshold 2/3: A task is considered healthy after 2 consecutive successes (60s from start) and unhealthy after 3 consecutive failures (90s of failure before removal). This gives the app time to start (warmup) and tolerates brief blips without premature deregistration.

### 4.2 Nginx Layer (Rate Limiting + Routing)

```nginx
# /etc/nginx/nginx.conf

worker_processes auto;          # 1 worker per vCPU
worker_rlimit_nofile 65535;

events {
  worker_connections 4096;      # per worker
  use epoll;
  multi_accept on;
}

http {
  # Rate limit zones — shared memory (works across worker processes on same nginx instance)
  # WHY: Inter-instance coordination handled by Redis in NestJS. Nginx handles
  # the volumetric layer — catching flood attacks before they hit the app.
  limit_req_zone $binary_remote_addr zone=global:10m    rate=200r/m;
  limit_req_zone $binary_remote_addr zone=auth_login:1m  rate=10r/m;
  limit_req_zone $binary_remote_addr zone=auth_register:1m rate=5r/m;

  upstream auth_api {
    least_conn;                 # WHY: bcrypt makes some requests 300ms. Round-robin
                                # would pile up on busy upstreams. least_conn routes
                                # to the instance with fewest active connections.
    keepalive 32;               # WHY: persistent connections to NestJS — no TCP handshake per request
    server auth-api-1:3000;
    server auth-api-2:3000;
  }

  server {
    listen 80;
    server_name api.example.com;
    return 308 https://$host$request_uri;   # permanent redirect, browser caches
  }

  server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/ssl/certs/cert.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;
    ssl_protocols       TLSv1.3 TLSv1.2;
    ssl_ciphers         ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_session_cache   shared:SSL:50m;
    ssl_session_timeout 1d;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;

    location /api/v1/auth/login {
      limit_req zone=auth_login burst=5 nodelay;
      limit_req_status 429;
      proxy_pass http://auth_api;
      include /etc/nginx/proxy_params.conf;
    }

    location /api/v1/auth/register {
      limit_req zone=auth_register burst=3 nodelay;
      limit_req_status 429;
      proxy_pass http://auth_api;
      include /etc/nginx/proxy_params.conf;
    }

    location /api/ {
      limit_req zone=global burst=50 nodelay;
      limit_req_status 429;
      proxy_pass http://auth_api;
      include /etc/nginx/proxy_params.conf;
    }
  }
}
```

```nginx
# /etc/nginx/proxy_params.conf
proxy_http_version 1.1;
proxy_set_header Connection "";             # enable keepalive to upstream
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Correlation-ID $http_x_correlation_id;
proxy_connect_timeout 5s;
proxy_send_timeout 30s;
proxy_read_timeout 30s;
proxy_buffering off;                        # WHY: streaming responses pass through without buffering
```


---

## 5. Auto Scaling

### 5.1 ECS Service Auto Scaling

WHY two scaling metrics: CPU alone misses memory-bound scenarios (large session payloads). Request count alone misses CPU-bound scenarios (bcrypt spikes on login floods). Using both catches all real-world patterns.

```yaml
# auth-api ECS service auto scaling
autoscaling:
  min_capacity: 2         # WHY: never go below 2 — one per AZ; single task = single point of failure
  max_capacity: 20        # WHY: capped to protect MongoDB and Redis connection limits
                          # 20 tasks × 10 connections = 200 MongoDB connections (Atlas M30 limit: 300)

  target_tracking_policies:
    - policy_name: cpu-scaling
      metric: ECSServiceAverageCPUUtilization
      target_value: 60    # WHY 60% not 80%: bcrypt spikes are sudden; 60% headroom
                          # means scaling starts before users feel latency
      scale_out_cooldown: 60s
      scale_in_cooldown:  300s  # WHY longer scale-in: avoid flapping; let traffic settle

    - policy_name: request-scaling
      metric: ALBRequestCountPerTarget
      target_value: 500   # requests/target/minute — empirically derived from load tests
      scale_out_cooldown: 60s
      scale_in_cooldown:  300s

  step_scaling_policies:
    # Immediate scale-out for sudden spikes — target tracking is too slow (1-2 min lag)
    - policy_name: emergency-scale-out
      metric: ALBRequestCountPerTarget
      steps:
        - lower_bound: 2000  # 4× normal threshold
          adjustment: +5     # add 5 tasks immediately
        - lower_bound: 5000  # 10× normal
          adjustment: +10
```

### 5.2 Predictive Scaling (Phase 2+)

```
WHY predictive scaling: Auth traffic follows predictable daily patterns.
09:00 local time across timezones = login spike. Friday 17:00 = logout spike.
ML-based predictive scaling pre-warms capacity 5 minutes before predicted spikes,
eliminating the 60-90 second scale-out lag during known traffic events.

AWS Application Auto Scaling predictive mode:
  ForecastOnly mode → validate predictions for 2 weeks before enabling
  ForecastAndScale  → activate after validation

Scheduled scaling (for known events, e.g., Monday morning):
  rule: "cron(0 8 ? * MON-FRI *)"
  min_capacity: 6   # pre-scale before 9AM peak
  rule: "cron(0 10 ? * MON-FRI *)"
  min_capacity: 2   # return to normal after peak
```

### 5.3 Redis Scaling

```
Phase 1-2 (< 100K users):
  Single primary + 1 replica (Multi-AZ)
  Scale up instance class when: memory utilization > 70% OR connections > 80%
  r7g.large → r7g.xlarge → r7g.2xlarge

Phase 3+ (100K-1M users):
  Enable cluster mode: 6 shards × 2 nodes (primary + replica each)
  WHY cluster mode not just bigger instance:
  - Cluster mode = horizontal shard key distribution (6× write throughput)
  - Single large instance = vertical scaling (hardware limits, single-node failure)
  - Auth session writes are the bottleneck, not reads → need write throughput

  Scaling trigger: CloudWatch alarm on DatabaseMemoryUsagePercentage > 70%
  Operator action: add 2 shards via modify-replication-group
  No downtime: ElastiCache online resharding rebalances live
```

### 5.4 MongoDB Atlas Auto Scaling

```
Atlas auto-scaling enabled:
  Compute: M10 → M30 → M50 (upscale when CPU > 75% for 1 hour)
  Storage: auto-expand when usage > 90% (never manually manage disk)

Manual tier upgrades (planned, not auto):
  M50 → sharded cluster (requires shard key design review by SRE)

Connection pool tuning per NestJS task:
  maxPoolSize: 10           # WHY: 20 tasks × 10 = 200 connections < Atlas M30 limit (300)
  minPoolSize: 2            # maintain warm connections — cold connection = +50ms
  maxIdleTimeMS: 60000      # close idle connections after 60s
  serverSelectionTimeoutMS: 5000
  socketTimeoutMS: 45000
```


---

## 6. Monitoring & Observability

### 6.1 The Four Golden Signals (Auth-Specific)

| Signal | Metric | Tool | Normal | Warning | Critical |
|---|---|---|---|---|---|
| Latency | p99 login response time | CloudWatch | < 400ms | 400-800ms | > 800ms |
| Traffic | Logins / minute | CloudWatch | baseline ± 2σ | 3σ | > 5σ or < -3σ |
| Errors | Login failure rate % | CloudWatch | < 2% | 2-10% | > 10% |
| Saturation | ECS CPU utilization | CloudWatch | < 60% | 60-80% | > 80% |

### 6.2 Custom CloudWatch Metrics

All emitted from NestJS via `aws-sdk CloudWatch.putMetricData` with namespace `AuthService`:

```typescript
// Emitted on every significant auth event
Namespace: AuthService
Dimensions: [{ Name: "Environment", Value: "production" }]

Metrics:
  auth.login.success           Counter  (per minute)
  auth.login.failed            Counter  (per minute)
  auth.login.mfa_required      Counter
  auth.login.mfa_success       Counter
  auth.login.mfa_failed        Counter
  auth.register.success        Counter
  auth.register.failed         Counter
  auth.token.refresh.success   Counter
  auth.token.refresh.failed    Counter
  auth.token.theft.detected    Counter  → immediate alert
  auth.credential_stuffing     Counter  → immediate alert
  auth.session.revoked         Counter
  auth.password.reset.request  Counter
  auth.password.reset.complete Counter

  auth.latency.login           Histogram (ms, p50/p95/p99)
  auth.latency.refresh         Histogram (ms, p50/p95/p99)
  auth.latency.register        Histogram (ms, p50/p95/p99)
  auth.bcrypt.duration         Histogram (ms) — track if cost factor needs adjustment

  auth.active_sessions         Gauge     (sampled every 60s from Redis DBSIZE)
  auth.redis.memory_used_pct   Gauge
  auth.mongo.connections_used  Gauge
  auth.rate_limit.triggered    Counter   (per minute, by type: ip/account/stuffing)
```

### 6.3 CloudWatch Dashboard

```
Dashboard: Auth-Production
Widgets:

Row 1 — Traffic
  [Login req/min] [Register req/min] [Refresh req/min] [Logout req/min]

Row 2 — Errors
  [Login failure rate %] [Refresh failure rate %] [5xx rate %] [Rate limit triggered/min]

Row 3 — Latency (last 3h, p50/p95/p99)
  [Login latency] [Refresh latency] [bcrypt duration]

Row 4 — Infrastructure
  [ECS CPU%] [ECS task count] [Redis memory%] [MongoDB CPU%]

Row 5 — Security Events (last 24h)
  [Token theft detections] [Credential stuffing events] [Suspicious logins] [Accounts locked]

Row 6 — Dependency Health
  [Redis connection status] [MongoDB connection status] [SES queue depth]
```

### 6.4 Health Endpoint

```typescript
// GET /api/v1/auth/health
// Used by: ALB health checks, external uptime monitors, on-call runbooks
// Response time: must be < 100ms (does not block on slow operations)

{
  "status": "healthy" | "degraded" | "unhealthy",
  "version": "1.3.2",
  "uptime": 342000,        // seconds
  "timestamp": "2026-08-07T...",
  "dependencies": {
    "mongodb": {
      "status": "healthy",
      "latencyMs": 3,
      "replicaSetStatus": "PRIMARY"
    },
    "redis": {
      "status": "healthy",
      "latencyMs": 1,
      "memoryUsedPct": 42,
      "connectedClients": 8
    },
    "ses": {
      "status": "healthy",
      "queueDepth": 0
    },
    "secretsManager": {
      "status": "healthy",
      "lastRefreshMs": 180000  // last key cache refresh
    }
  },
  "checks": {
    "jwtKeyLoaded": true,
    "sessionHmacKeyLoaded": true,
    "rateLimit": "operational"
  }
}

// HTTP status codes:
// 200 → status: healthy (ALB marks target healthy)
// 200 → status: degraded (ALB keeps target — still serving, but emit alert)
// 503 → status: unhealthy (ALB removes target from rotation)
```

WHY 200 for degraded: If the SES queue is backed up but auth works, the instance should still serve traffic. Returning 503 on degraded would remove healthy instances from the pool unnecessarily.


---

## 7. Logging

### 7.1 Structured Log Format

All application logs are JSON. No unstructured strings in production.

```json
{
  "level": "info",
  "event": "login_success",
  "correlationId": "req_01HXYZ123",
  "userId": "665f...",
  "orgId": "442a...",
  "ip": "203.0.113.1",
  "country": "US",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...",
  "mfaUsed": true,
  "suspicious": false,
  "durationMs": 312,
  "bcryptDurationMs": 289,
  "sessionId": "sess_...",
  "timestamp": "2026-08-07T14:22:00.123Z",
  "service": "auth-api",
  "version": "1.3.2",
  "taskId": "arn:aws:ecs:..."
}
```

WHY every field is indexed: CloudWatch Logs Insights queries run against these fields. An on-call engineer must be able to answer "which IPs had more than 100 failed logins in the last hour?" in under 10 seconds.

### 7.2 Log Levels Policy

| Level | When to use | Examples |
|---|---|---|
| `error` | Unrecoverable failures, exceptions that return 5xx | MongoDB connection failure, JWT key load failure |
| `warn` | Recoverable failures, suspicious events, degraded state | Redis miss, TOTP failed attempt, slow bcrypt |
| `info` | Normal business events | login_success, logout, register, password_reset |
| `debug` | Development only — never in production logs | JWT decode steps, Redis key lookups |

WHY no `debug` in production: Debug logs at 1K logins/min = millions of log events. CloudWatch costs $0.50/GB ingested. One debug log line per request at 10K req/s = ~$500/month in log costs alone.

### 7.3 Log Groups and Retention

```
Log Groups:
  /ecs/auth-api          → 90 days  (operational queries, incident investigation)
  /ecs/auth-nginx        → 30 days  (request-level access logs)
  /ecs/auth-worker       → 90 days  (job processing logs)
  /auth/audit            → 365 days (compliance — never reduce below 1 year)
  /auth/security-events  → 365 days (token theft, stuffing, suspicious logins)

WHY separate security-events log group:
  Security events need different access controls (security team, not all engineers).
  CloudWatch resource policies enforce who can query each group.
  Separation also enables different alert configurations per group.
```

### 7.4 Key CloudWatch Logs Insights Queries

```
# Failed login attempts — group by IP (credential stuffing detection)
fields @timestamp, ip, email
| filter event = "login_failed"
| stats count(*) as attempts by ip
| sort attempts desc
| limit 20

# P99 login latency over time
fields @timestamp, durationMs
| filter event = "login_success"
| stats percentile(durationMs, 99) as p99, avg(durationMs) as avg by bin(5m)

# Security events in last 24 hours
fields @timestamp, event, userId, ip, country
| filter event in ["token_theft_detected", "credential_stuffing", "account_locked"]
| sort @timestamp desc

# Broken sessions — users who refresh-failed and were logged out
fields @timestamp, userId, correlationId
| filter event = "session_expired" and outcome = "failure"
| stats count(*) by userId
| sort count desc

# Bcrypt duration trend (detects hardware degradation)
fields @timestamp, bcryptDurationMs
| stats percentile(bcryptDurationMs, 99) as p99_bcrypt by bin(1h)
| sort @timestamp desc
```

### 7.5 PII in Logs

```
Fields that appear in logs → treatment:
  email       → logged on pre-auth events only; after user found, use userId
  userId      → always logged (internal, not PII in the legal sense)
  ip          → logged; GDPR: hashed in long-term audit store after 30 days
  userAgent   → logged, truncated to 256 chars
  password    → NEVER logged (ValidationPipe strips it before controller)
  refreshToken → NEVER logged (interceptor redacts cookie values)
  accessToken → NEVER logged (redacted in Authorization header logs)
```


---

## 8. Distributed Tracing

### 8.1 AWS X-Ray Integration

WHY X-Ray over Jaeger/Zipkin: The auth system runs entirely on AWS. X-Ray integrates natively with ALB, ECS, Lambda (future), and CloudWatch. No additional infrastructure to operate.

```typescript
// main.ts — X-Ray setup
import * as AWSXRay from 'aws-xray-sdk-core';
import * as http from 'http';
import * as https from 'https';

// Capture all outgoing HTTP calls (SES, Secrets Manager, OAuth providers)
AWSXRay.captureHTTPsGlobal(http, true);
AWSXRay.captureHTTPsGlobal(https, true);

// Capture MongoDB — all queries appear as subsegments
AWSXRay.captureMongoose(mongoose);

// Segment naming — identifies the service in X-Ray service map
AWSXRay.middleware.setSamplingRules({
  rules: [{
    description: 'Auth API sampling',
    http_method: '*',
    host: '*',
    url_path: '/api/*',
    fixed_target: 1,      // always sample 1 req/s (for baseline)
    rate: 0.05            // sample 5% of remaining traffic
  }],
  default: { fixed_target: 1, rate: 0.01 },
  version: 2
});
```

### 8.2 Trace Span Structure

```
[POST /api/v1/auth/login] — root segment (ALB starts this)
  ├── [NestJS: CorrelationIdInterceptor]        0ms
  ├── [NestJS: LoginRateLimitGuard]             1ms
  │   └── [Redis: GET login_fail_account:*]     0.5ms
  │   └── [Redis: GET login_fail_ip:*]          0.5ms
  ├── [NestJS: AuthController.login]
  │   ├── [MongoDB: users.findOne({ email })]   4ms
  │   ├── [bcrypt.compare]                      289ms  ← dominant operation
  │   ├── [Redis: HSET session:*]               1ms
  │   ├── [Redis: SADD user_sessions:*]         0.5ms
  │   └── [EventEmitter: LOGIN_SUCCESS]         0ms (async, not traced)
  └── [NestJS: AuditLogInterceptor]             0ms (async queue, not blocking)

Total: ~297ms (bcrypt dominates, everything else is noise)
```

### 8.3 Correlation ID Propagation

```
X-Correlation-ID header flows:
  Browser → ALB: browser generates UUID or uses existing
  ALB → Nginx: passthrough (ALB preserves custom headers)
  Nginx → NestJS: proxy_set_header X-Correlation-ID $http_x_correlation_id
  NestJS logs: correlationId field in every log entry
  NestJS → MongoDB: appended to MongoDB session comment (visible in MongoDB Atlas logs)
  NestJS response: X-Correlation-Id header echoed back to client

User-facing error response:
  { "correlationId": "req_01HXYZ" }
  → Support engineer queries: /auth/audit | filter correlationId = "req_01HXYZ"
  → Reconstructs full request flow in < 30 seconds
```

---

## 9. Alerts & On-Call

### 9.1 Alert Definitions

```yaml
# All alerts → SNS → PagerDuty (Critical) or Slack (Warning)

alerts:

  # ── Security ──────────────────────────────────────────────────────────
  - name: TokenTheftDetected
    condition: auth.token.theft.detected > 0 in 1 min
    severity: CRITICAL
    action: page-immediate
    runbook: runbooks/token-theft.md
    WHY: Token reuse detection is a positive signal of account compromise.
         Every occurrence requires human investigation.

  - name: CredentialStuffingDetected
    condition: auth.credential_stuffing > 0 in 1 min
    severity: CRITICAL
    action: page-immediate
    runbook: runbooks/credential-stuffing.md

  - name: LoginFailureRateHigh
    condition: auth.login.failed / (auth.login.success + auth.login.failed) > 0.15 for 5 min
    severity: CRITICAL
    action: page-immediate
    WHY: 15% failure rate is 7× normal. Either an attack or a deployment broke auth.

  - name: SuspiciousLoginSpike
    condition: auth.suspicious_login > 50 in 5 min
    severity: HIGH
    action: page-immediate

  # ── Availability ───────────────────────────────────────────────────────
  - name: RedisDown
    condition: redis health check fails for 2 consecutive checks (60s)
    severity: CRITICAL
    action: page-immediate
    runbook: runbooks/redis-outage.md
    WHY: Redis down = no new logins, no token refresh. All users get 503.

  - name: MongoDBDown
    condition: mongodb health check fails for 2 consecutive checks (60s)
    severity: CRITICAL
    action: page-immediate
    runbook: runbooks/mongodb-outage.md

  - name: AuthAPIUnhealthy
    condition: ALB HealthyHostCount < 2 for 2 min
    severity: CRITICAL
    action: page-immediate
    WHY: < 2 healthy tasks = single point of failure. One crash = full outage.

  - name: HighErrorRate5xx
    condition: ALB HTTPCode_Target_5XX_Count > 10 in 1 min
    severity: HIGH
    action: page-5min

  # ── Performance ────────────────────────────────────────────────────────
  - name: LoginLatencyHigh
    condition: auth.latency.login p99 > 800ms for 5 min
    severity: HIGH
    action: page-5min
    runbook: runbooks/latency-runbook.md

  - name: ECSCPUHigh
    condition: ECSServiceAverageCPUUtilization > 85% for 5 min
    severity: WARNING
    action: slack
    WHY: Warning before auto-scaling hits ceiling. Gives SRE time to verify
         scaling is working and plan capacity if not.

  - name: RedisMemoryHigh
    condition: redis DatabaseMemoryUsagePercentage > 80% for 10 min
    severity: WARNING
    action: slack

  - name: MongoDBConnectionsHigh
    condition: mongo CurrentConnections > 250 (M30 limit: 300)
    severity: WARNING
    action: slack

  # ── Business ───────────────────────────────────────────────────────────
  - name: LoginRateAnomaly
    condition: auth.login.success deviates > 3σ from 7-day baseline
    severity: WARNING
    action: slack
    WHY: Sudden drop could indicate a broken deployment. Sudden spike could be
         a bot wave that hasn't hit error thresholds yet.

  - name: RegistrationSpike
    condition: auth.register.success > 10× 7-day average in 5 min
    severity: WARNING
    action: slack
    WHY: Could be organic virality (good) or bot registration (bad). Needs eyes.
```

### 9.2 On-Call Rotation

```
Primary on-call: 1 SRE per week
Secondary (escalation): 1 senior SRE per week
Escalation path:
  PagerDuty alert → Primary on-call (5 min SLA to acknowledge)
  If no ack → Secondary on-call (page at +5 min)
  If still no ack → Engineering Manager (page at +10 min)

Alert SLAs:
  CRITICAL: acknowledge within 5 min, mitigate within 30 min
  HIGH:     acknowledge within 15 min, mitigate within 1 hour
  WARNING:  review during business hours, resolve within 24 hours

After-hours policy:
  CRITICAL always pages regardless of time
  HIGH pages during business hours; queues for next-day outside hours
  WARNING never pages — Slack + next business day
```


---

## 10. Backup Strategy

### 10.1 MongoDB Atlas Backups

```
Backup type: MongoDB Atlas Continuous Backup (oplog-based)

Policy:
  Point-in-time recovery (PITR): last 7 days at any second
  Daily snapshots: retained 30 days
  Weekly snapshots: retained 12 weeks
  Monthly snapshots: retained 12 months

WHY PITR over snapshot-only:
  A bulk delete of user records (accidental or malicious) requires recovery
  to a specific second — not the nearest daily snapshot. PITR restores to
  exactly 1 second before the bad operation.

Restore test: Monthly (first Saturday of each month)
  Restore to Atlas test cluster → verify user count + login smoke test
  Document restore time in RTO log (target < 15 minutes for M30)

Backup encryption:
  Atlas encrypts backups at rest with AWS KMS (Encryption at Rest)
  Backup data stays in the same AWS region as the cluster (us-east-1)
  Cross-region backup copy: enabled for DR cluster (eu-west-1)
```

### 10.2 Redis Session Store Backups

```
Redis persistence:
  AOF (Append-Only File): everysec mode
    - Durability: max 1 second of session data loss on crash
    - WHY everysec not always: "always" fsync = 100× write amplification;
      1-second loss of session data is acceptable (users re-login)

  RDB snapshots: every 6 hours → S3 bucket auth-redis-backups
    - Retention: 7 days (sessions expire in 7 days anyway)
    - WHY still back up: mass session revocation recovery,
      forensic investigation of session state at a point in time

Restore scenario:
  Redis crash → ElastiCache automatic failover to replica (< 60s, no data loss)
  Full cluster loss → restore from RDB snapshot (last 6h of sessions lost)
    → affected users simply re-login

WHY sessions are low-RPO but high-RTO-tolerance:
  Sessions are not critical business data. A lost session = forced re-login.
  We tolerate up to 6 hours of session data loss. We do NOT tolerate
  6 hours of downtime. Hence: replica for availability, RDB for forensics.
```

### 10.3 Audit Log WORM Archive

```
Architecture:
  MongoDB audit_logs → CloudWatch Logs (real-time stream)
                     → S3 Object Lock bucket (WORM, nightly export)

S3 Object Lock configuration:
  Bucket: auth-audit-archive-prod
  Mode: COMPLIANCE (cannot be deleted or modified even by root)
  Retention: 365 days (GDPR minimum for auth events)
  MFA delete: enabled (additional protection against insider deletion)

Nightly export job (Lambda, 00:00 UTC):
  Query MongoDB: last 24h audit events
  Write to S3: s3://auth-audit-archive-prod/YYYY/MM/DD/audit.json.gz
  Verify: object exists + size > 0 → alert if missing

WHY S3 Object Lock over just CloudWatch:
  CloudWatch log groups can have retention reduced via API.
  S3 Object Lock in COMPLIANCE mode is legally immutable — even AWS
  cannot delete the object before the retention period expires.
  Required for: SOC 2, ISO 27001, GDPR Article 5(e)
```

### 10.4 Configuration Backups

```
What is backed up:
  ECS task definitions → stored in git (infrastructure-as-code)
  Nginx configs → stored in git, built into Docker image
  AWS Secrets → Secrets Manager versioning (last 100 versions retained)
  CloudWatch dashboards → exported to JSON, stored in git
  Auto scaling policies → Terraform state in S3 with versioning

WHY git for infrastructure config:
  Every config change is auditable (who changed what, when, why).
  Rollback = git revert + terraform apply. No manual reconstruction.
```

---

## 11. Disaster Recovery

### 11.1 RTO and RPO Targets

| Scenario | RTO Target | RPO Target | Strategy |
|---|---|---|---|
| Single ECS task failure | < 30s | 0 | ECS restarts task, ALB routes around it |
| AZ failure | < 5 min | 0 | Multi-AZ deployment, ECS reschedules |
| Redis primary failure | < 60s | 0 (replica is current) | ElastiCache auto-failover |
| MongoDB primary failure | < 10s | 0 (replica is current) | Atlas auto-election |
| Full Redis cluster loss | < 15 min | 6h session data | Restore from RDB, users re-login |
| Full MongoDB loss | < 15 min | 0s (PITR) | Atlas PITR restore |
| Region failure (us-east-1) | < 60 min | 10 min | Failover to eu-west-1 warm standby |
| Account compromise (JWT key) | < 5 min | 0 | Key rotation runbook |

### 11.2 Multi-Region DR (Phase 4)

```
Active region: us-east-1 (primary, serves all traffic)
Standby region: eu-west-1 (warm standby, updated continuously)

Data replication:
  MongoDB Atlas Global Clusters:
    - Write primary: us-east-1
    - Read replica: eu-west-1 (< 100ms replication lag)
    - On failover: eu-west-1 elected as new primary
  Redis:
    - No cross-region replication (sessions are regional)
    - On failover: fresh cluster, all users re-login (acceptable)
  Audit logs:
    - S3 Cross-Region Replication: us-east-1 → eu-west-1 (continuous)

Failover trigger (automated):
  Route53 health check: polls /api/v1/auth/health every 30s
  If health check fails for 3 consecutive checks (90s) → Route53 switches DNS to eu-west-1
  DNS TTL: 60s → traffic switches within 2.5 minutes of us-east-1 failure

Failover procedure (manual steps if auto-failover doesn't trigger):
  1. Confirm us-east-1 is truly unavailable (not just a false alarm)
  2. Promote MongoDB eu-west-1 replica to primary
  3. Update /prod/auth/mongo-uri secret in eu-west-1 Secrets Manager
  4. Set Route53 record to eu-west-1 ALB (manual if health check didn't trigger)
  5. Verify eu-west-1 /health endpoint returns healthy
  6. Notify stakeholders via status page
  
Failback procedure (when us-east-1 recovers):
  1. Verify us-east-1 full health (all dependencies green)
  2. Re-sync MongoDB: eu-west-1 → us-east-1 (Atlas handles automatically)
  3. Wait for replication lag = 0
  4. Switch Route53 back to us-east-1
  5. Monitor for 15 minutes before declaring failback complete
```

### 11.3 DR Testing Schedule

```
Monthly: Chaos test in staging
  Kill a random NestJS ECS task → verify ALB routes around it within 30s
  Force Redis failover → verify session continuity within 60s

Quarterly: Full DR drill
  Execute full failover to eu-west-1 in production (during low-traffic window, 3AM UTC)
  Measure actual RTO vs. target
  Document gaps in post-mortem
  Required participants: SRE lead, Engineering Manager, Security

Annual: Recovery test
  Restore MongoDB Atlas from PITR backup to test cluster
  Verify: user count matches, logins work, audit log integrity
  Document restore time against RTO target
```


---

## 12. Incident Response

### 12.1 Incident Severity Levels

| Severity | Definition | Examples | SLA |
|---|---|---|---|
| SEV-1 | Full auth outage — users cannot log in | Redis down, MongoDB down, all ECS tasks crashed | Mitigate < 30 min |
| SEV-2 | Partial outage or security event | >15% login failure rate, token theft detected, one AZ down | Mitigate < 1 hour |
| SEV-3 | Degraded performance or isolated errors | P99 > 800ms, Redis memory high, single task failure | Mitigate < 4 hours |
| SEV-4 | Non-urgent issues | High bcrypt duration, warning-level alerts | Resolve < 24 hours |

### 12.2 Incident Response Playbook

```
STEP 1: Triage (0–5 min)
  □ Acknowledge PagerDuty alert
  □ Open #incident-auth Slack channel
  □ Announce: "Investigating [alert name], incident commander: [your name]"
  □ Check CloudWatch dashboard → identify affected component
  □ Assign severity (SEV-1 through SEV-4)

STEP 2: Communication (5–10 min)
  □ If SEV-1/SEV-2: notify Engineering Manager + VP Engineering
  □ Update status page: "Investigating authentication issues"
  □ If user-facing impact confirmed: update status page to "Identified"

STEP 3: Diagnosis (5–15 min)
  □ Check /api/v1/auth/health endpoint → which dependency is red?
  □ CloudWatch Logs Insights: errors in last 5 min
  □ X-Ray service map: which downstream is failing?
  □ ECS console: are all tasks running and healthy?

STEP 4: Mitigation (variable)
  □ Execute appropriate runbook (see Section 13 Failure Scenarios)
  □ Prefer fast mitigation over perfect fix
  □ Document every action in the #incident-auth channel

STEP 5: Resolution
  □ Confirm: /health returns healthy, login success rate back to baseline
  □ Update status page: "Resolved"
  □ Notify stakeholders

STEP 6: Post-Mortem (within 48 hours)
  □ Timeline of events
  □ Root cause analysis (5 Whys)
  □ What detected it, what mitigated it
  □ Action items with owners and due dates
  □ SLO impact calculation
```

### 12.3 Post-Mortem Template

```markdown
## Incident Post-Mortem: [Title]

**Date**: YYYY-MM-DD  
**Severity**: SEV-X  
**Duration**: Xh Xm  
**Incident Commander**: [name]  
**Affected Users**: [estimated count]

### Timeline
| Time (UTC) | Event |
|---|---|
| 14:22 | PagerDuty alert: LoginFailureRateHigh |
| 14:23 | [name] acknowledged |
| ... | ... |
| 14:51 | Alert resolved |

### Root Cause
[One paragraph: what failed, why it failed]

### Impact
- X users unable to log in for Y minutes
- Z successful logins during window (system partially functional / fully down)
- SLO impact: 99.9% monthly budget: X minutes consumed

### What Went Well
- Detection time < 5 min
- ...

### What Went Wrong
- Mitigation took 20 min instead of target 30 min — we were fast, but...
- ...

### Action Items
| Item | Owner | Due Date |
|---|---|---|
| Add Redis circuit breaker | [name] | 2026-08-21 |
| Improve health check to catch partial Redis failure | [name] | 2026-08-21 |
```

---

## 13. Failure Scenarios

> Each scenario follows the structure: **Impact → Detection → Mitigation → Recovery**

---

### SCENARIO 1: MongoDB Outage

**Trigger**: MongoDB Atlas primary failure, network partition, or Atlas planned maintenance overrun.

#### Impact

```
Immediate (0–10s):
  - Login: BLOCKED — cannot look up user by email
  - Register: BLOCKED — cannot create user document
  - Password reset: BLOCKED
  - OAuth login: BLOCKED (cannot upsert user)

Not impacted:
  - Token refresh: still works (Redis validates session, no MongoDB needed)
  - Logout: still works (Redis deletes session)
  - Any endpoint protected by JwtAuthGuard only: still works (JWT is stateless)
  - Audit log writes: queued in Bull, flushed on recovery

WHY refresh and logout still work:
  The refresh endpoint validates the Refresh_Token against Redis only.
  No MongoDB call in the hot path. Users who are already logged in stay logged in.
  Only NEW logins are blocked.

User experience:
  Existing sessions: unaffected for up to 7 days (refresh token TTL)
  New login attempts: "Service temporarily unavailable" (503)
  Blast radius: new users and users with expired sessions only
```

#### Detection

```
Primary: CloudWatch alarm → MongoDBDown
  - Trigger: MongoDB health check in /api/v1/auth/health fails for 2 checks (60s)
  - Alert fires in: < 90 seconds from outage start
  - PagerDuty pages on-call SRE immediately

Secondary: LoginFailureRateHigh
  - 5xx on login endpoints → failure rate > 15% → alert in ~5 min
  - WHY slower: requires enough traffic to accumulate failures

X-Ray traces:
  MongoDB subsegment shows timeout / connection refused → visible in service map
  Average trace latency spikes (MongoDB timeout = 5s before error)
```

#### Mitigation

```
Atlas auto-recovery (most common case):
  □ Atlas replica election: automatic, < 10s
  □ MongoDB driver follows new primary automatically
  □ No SRE action needed for failover within the replica set

If Atlas shows all nodes down (network partition or Atlas service issue):
  □ Check Atlas status page: https://status.mongodb.com
  □ Check VPC peering connection: AWS Console → VPC → Peering connections
  □ If VPC peering issue: investigate security group changes (common cause)

Circuit breaker (NestJS implements):
  After 5 consecutive MongoDB failures in 30s → circuit opens
  Auth API returns 503 immediately (no 5s timeout per request)
  Circuit probes every 30s → closes when MongoDB recovers
  WHY circuit breaker: without it, every login attempt holds a connection
  for 5s timeout × 20 concurrent = 100s of held connections → cascade failure

Temporary mitigation if outage is prolonged (> 30 min):
  □ Status page: "Login temporarily unavailable. Existing sessions unaffected."
  □ Consider: rate limit refresh endpoint to protect Redis from load spike
    when MongoDB recovers (all users simultaneously try to login)
```

#### Recovery

```
□ Monitor: Atlas shows primary elected → NestJS health check goes green
□ Verify: test login with known account → succeeds
□ Check: Bull audit queue depth → flush job ran → MongoDB audit_logs updated
□ Check: failed login attempts during outage → any in audit log that need attention?
□ Gradual traffic re-enable: auto-scaling naturally absorbs login backlog
□ Post-mortem: document timeline, root cause, any Atlas support case numbers

Recovery metric: auth.login.success rate returns to baseline within 5 minutes of MongoDB green
```

---

### SCENARIO 2: Redis Outage

**Trigger**: ElastiCache primary failure, Redis OOM (out of memory), or network issue.

#### Impact

```
Immediate (0–60s, before failover):
  - Token refresh: BLOCKED — cannot validate Refresh_Token (no Redis lookup)
  - Login: BLOCKED — cannot create session, cannot check rate limits
  - MFA verify: BLOCKED — MFA challenge stored in Redis
  - Session revocation: BLOCKED

Not impacted:
  - Access_Token validation: stateless JWT — no Redis call
  - Any request with a valid, non-expired Access_Token (< 15 min old): fully functional
  - Audit log reads (MongoDB only)

Why this is worse than MongoDB outage:
  Redis outage affects ALL users (token refresh), not just new logins.
  A user whose Access_Token expires during the outage is locked out even
  if they have a valid session — they cannot refresh. 15-minute token lifetime
  is the exposure window. After 15 minutes of Redis outage, users start losing access.

User experience at t=0: invisible (Access_Tokens still valid)
User experience at t=15min: sessions start expiring → users see "please log in again"
User experience at t=60min: all users logged out if Redis still down
```

#### Detection

```
Primary: CloudWatch alarm → RedisDown
  - ElastiCache CloudWatch: CacheClusterDown metric = 1
  - OR: /api/v1/auth/health → redis.status = "unhealthy"
  - Alert fires: < 90 seconds

Secondary: auth.token.refresh.failed spike
  - Refresh calls fail (Redis connection refused) → 503 returned
  - alert: token.refresh.failed > 50/min

NestJS circuit breaker:
  Redis connection error → ioredis reconnect attempts logged
  After 5 failures: circuit opens → immediate 503 (no hang)
```

#### Mitigation

```
ElastiCache auto-failover (primary failure only):
  □ ElastiCache promotes replica to primary: < 60 seconds
  □ NestJS ioredis client reconnects automatically (retryStrategy configured)
  □ Sessions are intact on replica (replica is in sync)
  □ No data loss for sessions created before primary failure
  □ SRE monitors: confirm new primary healthy, connection count normalizes

If failover doesn't complete (both nodes down, or cluster issue):
  □ Check ElastiCache console → confirm node status
  □ Forced failover: ElastiCache console → Actions → Failover primary
  □ If memory OOM caused the failure:
      redis-cli INFO memory → check used_memory vs maxmemory
      If OOM: connection count + memory spike → likely a key leak or large value
      redis-cli MEMORY DOCTOR → diagnosis report
      If session keys not expiring: check SCAN for session:* count vs expected

WHY we do NOT degrade to "no session validation" mode:
  Fallback to JWT-only would allow revoked sessions to work and stolen
  Refresh_Tokens to remain valid. The security regression is unacceptable.
  We fail hard (503) rather than silently degrade security.

Status page update if > 5 min outage:
  "Authentication service is experiencing issues. If you are already logged in,
   you may continue until your session expires. New logins temporarily unavailable."
```

#### Recovery

```
□ Confirm: ElastiCache both nodes show "available" status
□ Verify: NestJS ioredis connection pool reconnected (check /health endpoint)
□ Monitor: auth.token.refresh.success rate recovers to baseline
□ Check: user_sessions SET sizes — no orphaned session IDs (run cleanup job)
□ If memory OOM caused outage: identify offending key pattern before full recovery
  SCAN with MATCH + OBJECT ENCODING → find unexpectedly large values
□ Post-mortem: root cause, was OOM preventable, memory alert threshold review

Backlog absorption: login flood when Redis recovers
  → Auto-scaling handles if traffic spike from "everyone logging back in"
  → Rate limit guard prevents credential stuffing from exploiting the recovery window
```

---

### SCENARIO 3: AWS Regional Outage (us-east-1)

**Trigger**: Full AWS us-east-1 availability zone or regional degradation (rare but documented).

#### Impact

```
Full us-east-1 failure:
  - All auth endpoints: UNAVAILABLE
  - All user sessions: inaccessible (Redis is regional)
  - All user data: inaccessible until failover (MongoDB Atlas in us-east-1 VPC)

Impact duration without DR: indefinite (until AWS recovers)
Impact duration with DR (Phase 4): < 60 minutes

WHY this is a planned, not panicked, scenario:
  AWS regional failures are rare but predictable. We have a documented runbook.
  The response is NOT to manually rebuild — it's to execute the failover to eu-west-1.
```

#### Detection

```
CloudWatch cannot alert if the region is down (CloudWatch is also in us-east-1).

External detection:
  □ Route53 health checks: run from multiple AWS regions and external probers
     Health check → polls /api/v1/auth/health from 3 regions every 30s
     If 3 consecutive failures → Route53 fires SNS alert to on-call's cell (SMS)
     Route53 health check alarms go to us-west-2 SNS topic (separate region)
  □ External uptime monitor (Pingdom / UptimeRobot): independent of AWS
  □ User reports in #support Slack (often the first signal)
  □ AWS Service Health Dashboard: status.aws.amazon.com
```

#### Mitigation

```
Automated (Route53 health check failover):
  □ Route53 detects health check failure (3 checks × 30s = 90s)
  □ Route53 switches DNS CNAME from us-east-1 ALB to eu-west-1 ALB
  □ DNS TTL: 60s → clients switch within 2.5 minutes of Route53 decision
  □ eu-west-1 warm standby absorbs traffic

Manual verification steps (run in parallel with auto-failover):
  □ Confirm us-east-1 is truly down (AWS Health Dashboard, not just our service)
  □ Verify eu-west-1 NestJS tasks are healthy: check eu-west-1 ECS console
  □ Verify MongoDB Atlas promoted eu-west-1 replica to primary
     Atlas console → cluster → topology → confirm eu-west-1 is PRIMARY
  □ Update eu-west-1 /prod/auth/mongo-uri to point to new primary endpoint
     (Atlas updates this automatically for Atlas-managed connections)
  □ Smoke test: curl https://api.example.com/api/v1/auth/health → 200

Communication:
  □ Status page: "Authentication service is operating from backup region.
     Performance may be slightly degraded."
  □ Notify Engineering Manager and VP Engineering

Sessions during failover:
  eu-west-1 Redis starts empty — all users must re-login
  This is expected and acceptable. Users are notified via status page.
  Access_Tokens issued in us-east-1 within the last 15 min will work in eu-west-1
  (same JWT signing key in Secrets Manager, replicated to eu-west-1)
```

#### Recovery

```
Do NOT rush failback — confirm us-east-1 is stable before switching back.

□ Monitor AWS Health Dashboard: us-east-1 shows "Service Restored"
□ Allow 30 minutes of stability before initiating failback
□ MongoDB Atlas: confirm us-east-1 replica is fully caught up
   Replication lag should be 0 before failback
□ Failback procedure:
   1. Update Route53 health check target back to us-east-1 ALB
   2. Verify us-east-1 /health returns healthy
   3. Switch Route53 CNAME back to us-east-1
   4. Monitor: traffic shifts over 60s (DNS TTL)
   5. eu-west-1 drains traffic gracefully
□ Scale down eu-west-1 back to warm standby (reduce task count)
□ Post-mortem: actual RTO vs. target, DNS failover timing, user impact
```

---

### SCENARIO 4: Token Compromise (JWT Signing Key Leaked)

**Trigger**: JWT signing key exposed via: leaked environment variable, compromised ECS task role, insider threat, or Secrets Manager misconfiguration.

#### Impact

```
With the signing key, an attacker can:
  - Forge a JWT for ANY user, including admins
  - Set arbitrary roles, userId, orgId in the payload
  - Bypass all endpoint authorization
  - Exfiltrate data from any protected endpoint as any user

Current exposure window:
  - All issued tokens (up to 15-minute lifetime) are forgeable
  - Any forged token looks identical to a legitimate one
  - No way to distinguish real from forged without rotating the key

This is a SEV-1 security incident. Treat as confirmed breach.
```

#### Detection

```
Proactive:
  □ AWS GuardDuty: anomalous API call patterns using auth tokens from unexpected IPs
  □ AWS CloudTrail: Secrets Manager GetSecretValue from unexpected principal
  □ Unusual request patterns in X-Ray traces (same JWT with different IPs simultaneously)

Reactive:
  □ Security researcher report
  □ Unusual login events in audit log (impossible user IDs, malformed orgIds)
  □ Downstream services reporting authorization bypass

Security alert that fires:
  Multiple successful logins for the same userId from geographically impossible
  locations simultaneously → suspicious_login detected → SRE investigates
```

#### Mitigation

```
IMMEDIATE (0–5 min): Key rotation
  □ Generate new JWT signing key (v3)
  □ Add to AWS Secrets Manager: /prod/auth/jwt-secret-v3
  □ Update /prod/auth/jwt-secret to point to v3 (or update the secret value)
  □ All NestJS tasks refresh their key cache within 5 minutes (cache TTL)
  □ New tokens issued with kid: v3

  □ Add old kid (v2) to Redis rejected_kids SET:
     SADD rejected_kids "v2"
     EXPIRE rejected_kids 900   # 15 min — covers all in-flight v2 tokens
  □ All tokens with kid: v2 are immediately rejected by JwtStrategy
  □ Legitimate users get 401 → frontend triggers refresh → new v3 session issued

  Key rotation RTO: < 5 minutes (all in-flight v2 tokens expire naturally or are rejected)

SECONDARY (5–30 min): Session invalidation
  □ If attacker's session IDs are known from audit logs:
     DEL session:{known_attacker_sessionId}
  □ If scope is unclear: invalidate ALL sessions:
     SRE script: SCAN for all session:* keys → DEL all
     All users re-login with new v3 tokens — this is the nuclear option
  □ Force password reset for compromised user accounts (if specific accounts identified)

NOTIFICATION (parallel with mitigation):
  □ Notify CISO and Legal immediately — potential data breach
  □ Prepare breach notification if user data was accessed (GDPR 72-hour window)
  □ Engage AWS Support if Secrets Manager or IAM compromise is suspected
```

#### Recovery

```
□ Confirm: no tokens with kid: v2 are being accepted (check audit log for v2 usage)
□ Remove rejected_kids SET entry for v2 (after 15-min grace period)
□ Rotate all related secrets (session HMAC key, OAuth secrets) as precaution
□ Review CloudTrail: how was the key leaked? Who or what accessed /prod/auth/jwt-secret?
□ Review IAM: audit all principals with access to /prod/auth/* secrets
□ Security forensics: identify any data exfiltration via forged tokens
   X-Ray traces + audit logs: look for unusual data access patterns in the 24h before detection
□ Post-incident: implement key rotation automation, reduce key cache TTL to 1 minute,
  add CloudTrail alarm for Secrets Manager access from unexpected principals
```

---

### SCENARIO 5: Traffic Spike (DDoS or Viral Event)

**Trigger**: Sudden 10×–100× traffic increase from: DDoS attack, viral product event, bot wave, or press coverage.

#### Impact

```
Benign spike (organic traffic, e.g., product goes viral):
  - ECS auto-scaling lags 60–90s → brief latency increase
  - bcrypt CPU bottleneck: 10 logins/s baseline → 100 logins/s spike
    = 10× bcrypt CPU demand → 60% CPU → triggers scale-out
  - MongoDB: connection pool saturation if tasks scale faster than pool allows

Malicious spike (DDoS / credential stuffing):
  - Nginx rate limiter: absorbs volumetric HTTP flood at the edge
  - Redis per-IP rate limiter: blocks account-level attacks
  - If attack bypasses rate limits: ECS CPU saturates → legitimate users degraded

Worst case:
  Attack generates 10,000 login attempts/s against the login endpoint
  Each attempt = 300ms bcrypt (regardless of password correctness)
  CPU demand: 10,000 × 300ms = 3,000 CPU-seconds/s
  20 ECS tasks at 0.5 vCPU = 10 vCPU total → 33 concurrent bcrypt ops
  Queue depth explodes → latency → timeout → 503 for legitimate users
```

#### Detection

```
□ CloudWatch: auth.latency.login p99 > 800ms for 5 min → HighLoginLatency alert
□ CloudWatch: auth.rate_limit.triggered spike → credential stuffing alert
□ CloudWatch: ECSServiceAverageCPUUtilization > 85% → ECSCPUHigh alert
□ Nginx access log spike: log volume anomaly → LoginRateAnomaly alert
□ AWS Shield Advanced (if enabled): DDoS attack detected → automatic notification
```

#### Mitigation

```
Automatic mitigations (already in place):
  □ Nginx: 10 req/min/IP on /api/auth/login → volumetric flood drops at edge
  □ Redis: credential stuffing detection (>100 distinct emails/IP/5min) → IP blocked
  □ ECS auto-scaling: adds tasks within 60–90s (step scaling for >2000 req/min spikes)
  □ CloudFront + AWS Shield: Layer 3/4 DDoS absorbed before reaching ALB

Manual escalation if attack overwhelms automatic mitigations:
  □ Identify attack pattern: Nginx access logs → group by IP, User-Agent, email pattern
  □ Block at AWS WAF (CloudFront level):
     IP-based block: add attacking IP CIDR to WAF IP set
     Rate rule: if WAF rule not already blocking this pattern, add custom rule
     Bot signature: if known bot UA pattern, add managed rule group
  □ If account enumeration (random email pattern): add temporary CAPTCHA on login
  □ If legitimate traffic spike (product event): fast-path scaling
     Manually set ECS min_capacity to 20 (pre-scale, don't wait for auto-scale lag)

bcrypt CPU protection:
  □ If login endpoint CPU-saturated: temporarily raise nginx rate limit for login
     from 10 req/min/IP to 5 req/min/IP (tighten, not loosen)
  □ Return 429 early from Redis check before bcrypt — protects CPU from rate-limited IPs
```

#### Recovery

```
□ Monitor: attack traffic pattern → confirms subsiding (Nginx access log volume)
□ Remove manual WAF IP blocks (document which were added and why)
□ Return ECS min_capacity to normal (2 tasks)
□ Review: did rate limits hold? Were any legitimate users collateral damage?
□ If significant user impact: status page update "Service fully restored"
□ Post-mortem: attack vector, detection speed, mitigation effectiveness, WAF rule improvements
□ Action items: improve credential stuffing detection thresholds, add CAPTCHA trigger
```

---

### SCENARIO 6: Database Overload (MongoDB Connection Exhaustion or Query Saturation)

**Trigger**: Sudden spike in MongoDB queries due to traffic increase, N+1 query bug in new deployment, index dropping, or Atlas tier undersizing.

#### Impact

```
Connection exhaustion (most common):
  - Atlas M30 limit: 300 connections
  - 20 NestJS tasks × 10 connections/pool = 200 connections (normal)
  - Spike to 30 tasks × 10 = 300 → at limit → new connection attempts fail
  - Login: timeout on user lookup → 503
  - New task spin-up makes it worse (more tasks = more connections needed)

Query saturation (missing index):
  - Full collection scan on login: 100K users × ~1KB = 100MB scan per login
  - At 100 logins/s: 10GB/s scan → MongoDB CPU pegged → all queries slow
  - Symptoms: login p99 > 5s, MongoDB CPU > 90%

WHY this matters specifically for auth:
  Login runs a findOne({ email }) on every single login.
  It's the most frequent query in the system. Any degradation multiplies fast.
```

#### Detection

```
□ CloudWatch: MongoDBConnectionsHigh → connections > 250 → WARNING alert
□ CloudWatch: MongoDB CPU Utilization > 80% for 5 min → alert
□ X-Ray traces: MongoDB subsegment duration spike
□ /api/v1/auth/health: mongodb.latencyMs > 50ms → degraded status
□ Atlas built-in: Real-time Performance Panel → slow queries visible immediately
```

#### Mitigation

```
Connection exhaustion:
  □ Immediate: reduce ECS max_capacity to current task count (halt scale-out)
     This stops the feedback loop: more load → more tasks → more connections → exhaustion
  □ Check: are all connections legitimate? (no zombie connections from crashed tasks)
     Atlas → Cluster → Metrics → Connections → identify top connection sources
  □ Reduce connection pool per task: set maxPoolSize from 10 to 5 (NestJS env var)
     Deploy with zero-downtime rolling update → connection count halves within 5 min
  □ If Atlas tier is the hard limit: upgrade Atlas tier
     M30 → M50 (doubles connection limit to 1500) — Atlas upgrade is < 5 min downtime-free

Query saturation (missing index):
  □ Atlas Real-time Performance Panel → identify slow query (COLLSCAN = no index)
  □ Verify index exists: Atlas → Collections → users → Indexes → confirm { email: 1 }
  □ If index was dropped (deployment error or Atlas issue):
     db.users.createIndex({ email: 1 }, { unique: true, background: true })
     Background index build: does NOT block reads, builds online
     On 100K user collection: ~30 seconds
  □ If new query pattern introduced by deployment: identify in X-Ray, rollback deployment

Write amplification (audit log overload):
  □ Symptom: MongoDB write IOPS saturated, audit_logs collection growing unusually fast
  □ Verify: audit log event rate vs. expected
  □ Mitigation: increase Bull batch size (flush audit entries in batches of 1000 not 1)
  □ Temporary: disable audit for non-security events (login_success, logout)
     Keep: login_failed, token_theft, mfa events — security-critical
```

#### Recovery

```
□ Confirm: MongoDB Atlas metrics show CPU < 50%, connections < 200
□ Verify: /api/v1/auth/health → mongodb.latencyMs < 10ms
□ Restore: ECS max_capacity to 20, connection pool to 10
□ Verify: index exists and is used (explain plan on login query → IXSCAN not COLLSCAN)
□ If upgrade was needed: document new tier in infrastructure-as-code (Terraform)
□ Post-mortem: root cause, was it a deployment regression, was the Atlas tier undersized
□ Action items: add Atlas index existence check to deployment smoke test,
  add connection pool config to runbook, consider Atlas connection pooling proxy (mongos)
```

---

## 14. Cost Model

### 14.1 Per-Tier Cost Estimates

| Component | 1K Users (Phase 1) | 100K Users (Phase 2) | 1M Users (Phase 4) |
|---|---|---|---|
| ECS Fargate (NestJS) | 2 tasks × $15 = $30 | 6 tasks × $15 = $90 | 30 tasks × $30 = $900 |
| ECS Fargate (Next.js) | 2 tasks × $10 = $20 | 4 tasks × $10 = $40 | 10 tasks × $20 = $200 |
| ECS Fargate (Nginx) | 2 tasks × $5 = $10 | 4 tasks × $5 = $20 | 8 tasks × $10 = $80 |
| bcrypt workers | — | 4 tasks × $25 = $100 | 20 tasks × $50 = $1,000 |
| MongoDB Atlas | M10 = $60 | M30 = $200 | M80 sharded = $2,000 |
| ElastiCache Redis | r7g.large = $90 | r7g.xlarge = $180 | Cluster 12 nodes = $1,800 |
| ALB | $20 | $40 | $150 |
| CloudWatch | $10 | $30 | $150 |
| AWS SES | $1 | $5 | $50 |
| S3 (audit, backups) | $2 | $10 | $50 |
| AWS X-Ray | $0 | $5 | $30 |
| Secrets Manager | $2 | $2 | $5 |
| CloudFront + Shield | $20 | $50 | $300 |
| **Monthly Total** | **~$265** | **~$772** | **~$6,715** |

### 14.2 Cost Optimization Notes

```
bcrypt worker fleet:
  Use Spot Instances for bcrypt workers (not ECS Fargate — use ECS on EC2 Spot)
  bcrypt workers are stateless and interruption-tolerant (job retries on Bull queue)
  Spot saves ~70% on compute → bcrypt worker cost at 1M: $1,000 → $300/month

MongoDB Atlas:
  Atlas Flex Pausing (dev/staging): pause during off-hours → 70% cost saving for non-prod
  Reserved instances: 1-year commitment → 30% discount

ElastiCache:
  Reserved nodes (1-year) → 35% discount
  At Phase 1: consider Valkey (open-source Redis fork) on self-managed ECS
               if $90/month is too high — but adds operational overhead

CloudWatch Logs:
  Log filtering before ingestion (CloudWatch subscription filter):
  Drop debug-level logs before they hit CloudWatch → reduces ingestion cost
  DEBUG logs to ephemeral ECS task storage only (not shipped to CloudWatch)
```

---

## Related Documents

- [Architecture](./architecture.md)
- [Implementation Guide](./implementation.md)
- [ADR-001: MongoDB](../../ADR/001-mongodb.md)
- [ADR-002: Redis](../../ADR/002-redis.md)
- [Deployment Diagram](../../diagrams/authentication/Deployment.mmd)
