# ADR-003: WebSocket for Real-Time Communication

**Status**: Accepted

**Date**: 2026-08-06

---

## Context

Users need real-time updates for:
- Notifications
- Comments added by teammates
- Task status changes
- Presence indicators

Options: polling, SSE, WebSocket, Firebase.

---

## Decision

We will use **WebSocket** (via Socket.io) for real-time communication.

---

## Consequences

### Positive

- **True real-time**: <100ms latency
- **Bidirectional**: Server push + client acknowledgments
- **Fallback**: Socket.io falls back to polling if WS unavailable
- **Room support**: Easy to broadcast to specific users/orgs
- **Industry standard**: Well-understood patterns

### Negative

- **Stateful connections**: Requires sticky sessions or Redis adapter
- **Connection overhead**: Each client holds open connection
- **Scaling complexity**: Need to coordinate across multiple servers

---

## Alternatives Considered

### Polling

**Pros**: Stateless, simple  
**Cons**: High latency (30s+ delay), wasteful

### Server-Sent Events (SSE)

**Pros**: One-way push, simpler than WS  
**Cons**: No bidirectional, browser connection limits

### Firebase/Ably

**Pros**: Fully managed  
**Cons**: Vendor lock-in, costly at scale, less control

---

## Why WebSocket?

Real-time collaboration is a core feature. WebSocket provides the best UX with acceptable operational complexity.
