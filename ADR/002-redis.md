# ADR-002: Redis for Caching and Sessions

**Status**: Accepted

**Date**: 2026-08-06

---

## Context

We need:
- Session storage for JWT refresh tokens
- Cache layer to reduce database load
- Job queue for async processing
- Real-time pub/sub for WebSocket communication

---

## Decision

We will use **Redis** for caching, sessions, queuing, and pub/sub.

---

## Consequences

### Positive

- **Fast**: In-memory, <1ms latency
- **Versatile**: Cache + sessions + queue + pub/sub in one system
- **TTL support**: Auto-expire sessions and cache
- **Persistence**: AOF and RDB for durability
- **Clustering**: Built-in sharding

### Negative

- **Memory cost**: More expensive than disk storage
- **Data loss risk**: If persistence not configured
- **Single point of failure**: Requires replication

---

## Alternatives Considered

### Memcached

**Pros**: Simple, fast  
**Cons**: No persistence, no data structures, no pub/sub

### Database-only

**Pros**: One less system to manage  
**Cons**: Too slow for sessions, cannot handle queue workloads

---

## Why Redis?

Best balance of performance, features, and operational simplicity.
