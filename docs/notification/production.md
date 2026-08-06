# Notification — Production

---

## AWS

```
ECS (Fargate)
├── Notification Service (2-4 tasks)
├── Notification Workers (5-10 tasks)
└── WebSocket Service (3-6 tasks)

ElastiCache
└── Redis (queue + socket state)

SES / SendGrid
└── Email delivery

SNS
└── Push notifications (mobile)
```

**Environment Variables**
```
REDIS_URL=redis://notification-redis.cache.amazonaws.com:6379
SENDGRID_API_KEY=<from Secrets Manager>
WS_PORT=3001
QUEUE_CONCURRENCY=10
```

---

## Docker

### Dockerfile (Worker)

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
CMD ["node", "dist/worker.js"]
```

### docker-compose.yml

```yaml
services:
  notification-api:
    build: ./backend
    command: npm run start:notification
    ports:
      - "3000:3000"
    environment:
      - REDIS_URL=redis://redis:6379
      - SENDGRID_API_KEY=${SENDGRID_API_KEY}
    depends_on:
      - redis

  notification-worker:
    build: ./backend
    command: npm run start:worker
    environment:
      - REDIS_URL=redis://redis:6379
      - SENDGRID_API_KEY=${SENDGRID_API_KEY}
    deploy:
      replicas: 3
    depends_on:
      - redis

  websocket:
    build: ./backend
    command: npm run start:websocket
    ports:
      - "3001:3001"
    environment:
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

---

## Nginx

```nginx
upstream websocket_service {
  ip_hash; # Sticky sessions for WebSocket
  server ws-1:3001;
  server ws-2:3001;
  server ws-3:3001;
}

server {
  listen 443 ssl http2;
  server_name api.example.com;

  location /ws {
    proxy_pass http://websocket_service;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    
    # WebSocket timeouts
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }

  location /api/notifications/ {
    proxy_pass http://notification_service;
    proxy_set_header Host $host;
  }
}
```

---

## CloudWatch

### Metrics

- `NotificationCreated` — Counter
- `NotificationDelivered` — Counter (dimension: channel)
- `NotificationFailed` — Counter (dimension: channel, reason)
- `QueueSize` — Gauge
- `WorkerProcessingTime` — Histogram

### Alarms

| Alert | Condition | Action |
|-------|-----------|--------|
| Queue Backlog | >1000 jobs for 10 min | Scale workers |
| Email Delivery Failure | >5% failure rate | Page on-call |
| WebSocket Disconnects | >100/min | Investigate |
| Worker Lag | Processing time >30s | Scale workers |

---

## Alerts

```yaml
# CloudWatch Alarm
NotificationQueueBacklog:
  Type: AWS::CloudWatch::Alarm
  Properties:
    MetricName: QueueSize
    Threshold: 1000
    ComparisonOperator: GreaterThanThreshold
    EvaluationPeriods: 2
    AlarmActions:
      - !Ref ScaleWorkersPolicy
      - !Ref SlackSNSTopic
```

---

## Backups

**Redis (Queue State)**
- AOF persistence enabled
- Snapshot every 1 hour to S3
- Retention: 24 hours (short-lived data)

---

## Cost

| Resource | Spec | Monthly Cost |
|----------|------|-------------|
| ECS Notification API (2 tasks) | 0.5 vCPU, 1GB | ~$30 |
| ECS Workers (3 tasks) | 0.5 vCPU, 1GB | ~$45 |
| ECS WebSocket (2 tasks) | 0.5 vCPU, 1GB | ~$30 |
| ElastiCache Redis | cache.t3.small | ~$40 |
| SendGrid | 100k emails/month | ~$20 |
| SNS | Push notifications | ~$5 |
| **Total** | | **~$170/month** |

---

## Scaling

### Worker Auto-Scaling

```yaml
autoscaling:
  target_metric: QueueSize
  target_value: 100  # 100 jobs per worker
  min_capacity: 2
  max_capacity: 20
```

### WebSocket Scaling

- Use sticky sessions (ip_hash) in Nginx
- Redis Pub/Sub for cross-server communication
- Scale based on connection count (1000 per instance)
