# Authentication — Production

---

## AWS

```
EC2 / ECS (Fargate)
├── Auth Service (2-4 tasks)
├── Load Balancer (ALB)
├── Target Group
└── Auto Scaling Policy

ElastiCache
└── Redis Cluster (session store)

DocumentDB / MongoDB Atlas
└── Users collection
```

**IAM Roles**
- ECS Task Role: access to Secrets Manager, CloudWatch
- Secrets Manager: JWT_SECRET, OAuth credentials

**Secrets Manager**
```
/prod/auth/jwt-secret
/prod/auth/google-oauth-secret
/prod/auth/github-oauth-secret
```

---

## Docker

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

### docker-compose.yml

```yaml
services:
  auth-service:
    build: ./backend
    ports:
      - "3000:3000"
    environment:
      - MONGO_URI=mongodb://mongo:27017/ewp
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - mongo
      - redis

  mongo:
    image: mongo:7
    volumes:
      - mongo_data:/data/db

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  mongo_data:
  redis_data:
```

---

## Nginx

```nginx
upstream auth_service {
  least_conn;
  server auth-1:3000;
  server auth-2:3000;
  server auth-3:3000;
}

server {
  listen 443 ssl http2;
  server_name api.example.com;

  location /api/auth/ {
    proxy_pass http://auth_service;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    # Rate limiting
    limit_req zone=auth_limit burst=20 nodelay;
    limit_req_status 429;
  }
}

# Rate limit zone (100 req/min per IP)
limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=100r/m;
```

---

## CloudWatch

### Log Groups

- `/ecs/auth-service` — Application logs
- `/nginx/access` — Request logs
- `/nginx/error` — Error logs

### Log Insights Queries

```
# Failed login attempts
fields @timestamp, @message
| filter event = "login_failed"
| stats count(*) by ip, bin(5m)
| sort count desc

# Auth response times
fields @timestamp, duration
| filter event = "login_success"
| stats avg(duration), p95(duration), p99(duration) by bin(1h)
```

---

## Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| High Login Failure Rate | >100 failures/min | Critical |
| Auth Response Time P99 | >500ms for 5 min | Warning |
| Redis Down | Connection failures | Critical |
| JWT Secret Missing | Service fails to start | Critical |
| Session Store Full | Redis memory >80% | Warning |

**SNS Topics**
- `prod-critical-alerts` → PagerDuty
- `prod-warning-alerts` → Slack #alerts

---

## Backups

**Redis (Sessions)**
- AOF persistence enabled
- Snapshot every 6 hours to S3
- Retention: 7 days

**MongoDB (Users)**
- Daily automated backups (MongoDB Atlas)
- Point-in-time recovery up to 7 days
- Monthly snapshots retained 90 days

---

## Cost (Estimates)

| Resource | Spec | Monthly Cost |
|----------|------|-------------|
| ECS Fargate (2 tasks) | 0.5 vCPU, 1GB | ~$30 |
| ElastiCache Redis | cache.t3.micro | ~$25 |
| MongoDB Atlas | M10 | ~$60 |
| ALB | 10GB processed | ~$20 |
| CloudWatch Logs | 10GB/month | ~$5 |
| **Total** | | **~$140/month** |

---

## Scaling

### Horizontal Scale

```yaml
# ECS Auto Scaling
autoscaling:
  min_capacity: 2
  max_capacity: 20
  metrics:
    - type: CPUUtilization
      target: 70
    - type: RequestCountPerTarget
      target: 1000
```

### Redis Scale

- Scale ElastiCache cluster when memory >70%
- Add read replicas for cache reads
- Session sharding by userId prefix

### Database Scale

- MongoDB Atlas auto-scaling enabled
- Add read replicas for token validation queries
- Shard by orgId at M50+ tier
