# ADR-001: MongoDB as Primary Database

**Status**: Accepted

**Date**: 2026-08-06

---

## Context

We need a database for storing users, organizations, projects, tasks, comments, and other domain entities. Requirements:

- Flexible schema (rapid iteration on domain model)
- Document-oriented (entities with nested structures)
- Horizontal scalability (multi-tenant SaaS)
- Rich query capabilities
- Strong consistency for critical operations

---

## Decision

We will use **MongoDB** as the primary database.

---

## Consequences

### Positive

- **Schema flexibility**: Add/modify fields without migrations
- **Rich documents**: Store nested objects (comments, metadata) naturally
- **Horizontal scaling**: Sharding built-in for multi-tenancy
- **Aggregation pipeline**: Complex queries and analytics
- **Change streams**: Real-time event processing
- **Strong consistency**: Configurable read/write concerns

### Negative

- **No foreign keys**: Must enforce referential integrity in application
- **No transactions** (limited): Multi-document transactions available but slower
- **Disk space**: More storage than normalized SQL
- **Learning curve**: Different query model than SQL

---

## Alternatives Considered

### PostgreSQL

**Pros**: ACID, foreign keys, transactions, mature ecosystem  
**Cons**: Schema migrations, harder to scale horizontally, JSONB not as flexible

### DynamoDB

**Pros**: Fully managed, infinite scale, low ops  
**Cons**: Complex data modeling, limited queries, vendor lock-in

---

## Why MongoDB?

Startup velocity and schema flexibility outweigh strict relational guarantees. MongoDB's document model matches our domain entities naturally.
