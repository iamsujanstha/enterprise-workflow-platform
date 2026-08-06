---
inclusion: manual
---

# AI Workflow Prompt Templates

Copy-paste these prompts for step-by-step feature development.

---

## Step 1: README

```
Create README.md for [FEATURE_NAME] that explains:
- What this feature does
- Why it exists (business problem)
- Key capabilities
- Links to architecture, implementation, and production docs

Keep it concise (under 200 words).
```

**Example**:
```
Create README.md for notification system that explains:
- What this feature does
- Why it exists (business problem)
- Key capabilities
- Links to architecture, implementation, and production docs

Keep it concise (under 200 words).
```

---

## Step 2: Architecture

```
Create architecture.md for [FEATURE_NAME] following this exact template:

# [Feature Name]

---

## Business Problem
Why does this exist?

---

## Requirements

### Functional
- List functional requirements

### Non-Functional
- Performance targets
- Reliability targets
- Security requirements

---

## High Level Architecture
```mermaid
[Mermaid diagram]
```

---

## Data Flow
```mermaid
sequenceDiagram
[Sequence diagram]
```

---

## Database

### Collections
[Schema definitions]

### Indexes
[Index definitions]

---

## API Design

### Endpoints
[API table]

### DTOs
[TypeScript interfaces]

---

## Frontend

### Component Hierarchy
[Component tree]

### State
[State structure]

### Cache
[Caching strategy]

---

## Backend

### Modules
[Folder structure]

### Services
[Service methods]

### Guards
[Auth guards]

### Events
[Event definitions]

---

## Security

### Threats
[List threats]

### Mitigation
[Mitigation strategies]

---

## Scaling

### 100 users
[Infrastructure specs]

### 10k users
[Infrastructure specs]

### 1M users
[Infrastructure specs]

---

## Failure Scenarios

### [Component] Down
- **Impact**: 
- **Mitigation**:

---

## Monitoring

### Logs
[Log examples]

### Metrics
[Metric definitions]

### Tracing
[Trace spans]

---

## Tradeoffs

### Alternative A: [Name]
**Pros**: 
**Cons**: 

### Alternative B: [Name]
**Pros**: 
**Cons**: 

### Why This One? [Chosen Solution]
**Pros**: 
**Cons**: 
**Decision**: 
```

---

## Step 3: Review Checklist

Before approving architecture.md, verify:

- [ ] Business problem is clear
- [ ] Requirements are specific and measurable
- [ ] Mermaid diagrams are syntactically correct
- [ ] Data flow shows all major interactions
- [ ] Database schema is normalized
- [ ] API endpoints follow REST conventions
- [ ] Frontend component hierarchy is logical
- [ ] Backend modules follow separation of concerns
- [ ] Security threats are comprehensive
- [ ] Mitigation strategies are concrete
- [ ] Scaling path is realistic
- [ ] Failure scenarios cover major risks
- [ ] Monitoring includes logs, metrics, and traces
- [ ] At least 2 alternatives are documented
- [ ] Tradeoffs clearly explain the decision

---

## Step 4: Implementation

```
Create implementation.md for [FEATURE_NAME] with:

## Folder Structure
[Complete directory tree]

## Packages
[Dependencies with versions]

## Code Snippets
[Key implementations - services, controllers, guards, hooks, components]

## Testing
[Unit test examples, integration test examples]

## Migration
[Database migration scripts]

Do NOT include architectural decisions - only implementation details.
```

---

## Step 5: Production

```
Create production.md for [FEATURE_NAME] with:

## AWS
[ECS, ElastiCache, DocumentDB, S3, IAM, Secrets Manager]

## Docker
[Dockerfile, docker-compose.yml]

## Nginx
[Configuration for this feature]

## CloudWatch
[Log Groups, Metrics, Alarms]

## Alerts
[Alert definitions with thresholds]

## Backups
[Backup strategy and retention]

## Cost
[Monthly cost breakdown table]

## Scaling
[Auto-scaling configuration]

Do NOT include code - only production infrastructure.
```

---

## Step 6: Generate Code (One Component at a Time)

```
Generate [COMPONENT_NAME] following:
- Architecture defined in docs/[feature]/architecture.md
- Implementation guide in docs/[feature]/implementation.md

Include:
- Full implementation
- JSDoc comments
- Error handling
- Unit tests

Do NOT generate multiple files at once.
```

**Example**:
```
Generate AuthService.ts following:
- Architecture defined in docs/authentication/architecture.md
- Implementation guide in docs/authentication/implementation.md

Include:
- Full implementation
- JSDoc comments
- Error handling
- Unit tests

Do NOT generate multiple files at once.
```

---

## Step 7: Generate Tests

```
Generate tests for [COMPONENT_NAME] covering:
- Happy path scenarios
- Error cases
- Edge cases
- Integration with dependencies

Use the testing framework specified in implementation.md
```

---

## Review Gates

After each step, explicitly say:

✅ **Approved - Proceed to next step**

or

🔄 **Revise - [specific feedback]**

Never let AI auto-advance without approval.

---

## Complete Example Flow

### Step 1
```
Create README.md for authentication system
```

*[Wait for AI output]*

### Step 2
```
Approved - Proceed to architecture
```

### Step 3
```
Create architecture.md for authentication following the template
```

*[Wait for AI output]*

### Step 4
```
In the Tradeoffs section, you chose JWT + Refresh Token over Session-Based Auth.
Can you add a third alternative: Pure JWT (no refresh token) and explain why 
we didn't choose it?
```

*[AI adds Alternative C]*

### Step 5
```
Approved - Proceed to implementation.md
```

*[Continue this pattern through all steps]*

### Final Step
```
Approved - Now generate AuthService.ts
```

*[Review code]*

```
Approved - Now generate AuthController.ts
```

*[Continue one file at a time]*

---

## Anti-Patterns to Avoid

❌ "Build authentication"
❌ "Create the entire backend"
❌ "Generate all the code"
❌ "Make it work"
❌ Approving without reading
❌ Skipping review steps
❌ Generating multiple components without review
❌ Not asking "why?" about tradeoffs

---

## When to Use This Workflow

✅ New features
✅ Major refactors
✅ Architecture changes
✅ Production systems
✅ Team projects

❌ Quick prototypes (use faster iteration)
❌ Throwaway code
❌ Learning exercises

---

## Time Investment

- Step 1-2 (README): 5 min
- Step 3-4 (Architecture): 30-60 min
- Step 5-6 (Implementation): 15 min
- Step 7-8 (Production): 15 min
- Step 9-11 (Code Gen): 2-4 hours

**Total: 3-5 hours of thinking before first line of code**

This prevents **weeks** of rework.

---

## Success Metrics

You're doing it right if:

- You can explain any decision without looking at code
- New team members understand the system from docs
- You catch design flaws before coding
- Refactors are rare
- Production incidents are documented as "Failure Scenarios"

---

## Final Rule

If you're tempted to skip steps because "it's obvious"...

That's exactly when you need documentation most.

Future you will thank you.
