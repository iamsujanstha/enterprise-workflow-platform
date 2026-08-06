# AI Engineering Rules

## Philosophy

Architecture First

Never write implementation before documentation.

---

## Critical Rule

**NEVER** ask AI to "Build authentication" or "Create feature X"

This is where most people waste AI.

---

## The Right Way

### Step 1: Create README
**Prompt**: "Create README.md for [feature] explaining what it does and why it exists"

**Wait for output**

### Step 2: Review README
**Human reviews**
- Does this solve the right problem?
- Is the scope clear?
- Are we building the right thing?

**Only proceed after approval**

---

### Step 3: Create Architecture
**Prompt**: "Create architecture.md following the template"

**AI outputs**:
- Business Problem
- Requirements (Functional + Non-Functional)
- High Level Architecture (Mermaid)
- Data Flow (Mermaid)
- Database Schema
- API Design
- Frontend Components
- Backend Modules
- Security
- Scaling
- Failure Scenarios
- Monitoring
- Tradeoffs

**Wait for output**

### Step 4: Review Architecture
**Human reviews**:
- Is the architecture sound?
- Are the tradeoffs acceptable?
- Do the Mermaid diagrams make sense?
- Is the database schema normalized?
- Are security threats addressed?
- Can this scale to our needs?

**Only proceed after approval**

---

### Step 5: Review Mermaid Diagrams
**Human action**:
- Render diagrams in Mermaid viewer
- Check for logical errors
- Verify all components are connected
- Ensure data flows are correct

**Fix any issues before proceeding**

---

### Step 6: Review Tradeoffs
**Human validates**:
- Do we agree with Alternative A vs B?
- Are there other alternatives we should consider?
- Is the "Why This One?" reasoning solid?

**Only proceed after agreement**

---

### Step 7: Create Implementation Guide
**Prompt**: "Create implementation.md with folder structure, packages, code snippets"

**Wait for output**

### Step 8: Review Implementation
**Human reviews**:
- Is the folder structure logical?
- Are the right packages chosen?
- Do code snippets follow best practices?
- Are tests included?

**Only proceed after approval**

---

### Step 9: Create Production Guide
**Prompt**: "Create production.md with AWS, Docker, monitoring, cost"

**Wait for output**

### Step 10: Review Production
**Human reviews**:
- Is the infrastructure cost-effective?
- Are backups configured?
- Are alerts comprehensive?
- Is the deployment strategy sound?

**Only proceed after approval**

---

### Step 11: ONLY NOW Generate Code
**Prompt**: "Generate code for [specific component] following the approved architecture.md and implementation.md"

**Generate one component at a time**:
- AuthService
- AuthController  
- JWTService
- Tests

**Review each component before next**

---

## Order Summary

README
↓
Review & Approve
↓
Architecture
↓
Review & Approve
↓
Mermaid
↓
Review & Approve
↓
Tradeoffs
↓
Review & Approve
↓
Implementation
↓
Review & Approve
↓
Production
↓
Review & Approve
↓
**ONLY THEN**
↓
Generate Code
(one component at a time)

---

## Never Skip Steps

Each step builds on the previous.

If you skip architecture review, you'll build the wrong thing efficiently.

If you skip tradeoffs review, you'll realize 6 months later there was a better way.

If you skip implementation review, you'll use the wrong packages.

---

## Always Explain

WHY

before

HOW

---

## Key Principles

1. **Think First, Code Last**
   - 90% thinking, 10% coding
   - Most bugs come from wrong architecture, not wrong syntax

2. **Documents Are Contracts**
   - Once approved, architecture.md is law
   - Implementation must match architecture
   - No surprises during coding

3. **Review Gates**
   - Each step has explicit human approval
   - AI waits for "proceed" or "approved"
   - No auto-advancing to next step

4. **One Component at a Time**
   - Don't generate entire codebase
   - AuthService first, review, then AuthController
   - Catch mistakes early

5. **Tradeoffs Are Sacred**
   - Every decision has alternatives
   - Document why we chose A over B
   - Future you will thank you

---

## Example Bad Prompt

❌ "Build authentication with JWT and OAuth2"

**What happens**:
- AI generates 3000 lines of code
- You have no architecture doc
- No idea why certain choices were made
- Hard to maintain
- Hard to explain to team

---

## Example Good Workflow

✅ **Step 1**
> "Create README.md for authentication feature explaining JWT + OAuth2"

*[AI outputs README]*

✅ **Step 2**
> Human: "Looks good, proceed"

✅ **Step 3**
> "Create architecture.md for authentication following the template"

*[AI outputs architecture with Mermaid, tradeoffs, etc.]*

✅ **Step 4**
> Human: "I see you chose Redis for sessions. What if we used PostgreSQL instead?"

*[Discuss tradeoffs]*

> Human: "Agreed, Redis is better. Proceed"

✅ **Step 5**
> "Create implementation.md"

*[AI outputs implementation]*

✅ **Step 6**
> Human: "Approved, proceed"

✅ **Step 7**
> "Create production.md"

*[AI outputs production]*

✅ **Step 8**
> Human: "Cost looks high, can we optimize ElastiCache tier?"

*[Revise]*

> Human: "Approved"

✅ **Step 9**
> "Now generate AuthService.ts following the architecture"

*[AI generates one file]*

✅ **Step 10**
> Human reviews code, tests
> "Good, now generate AuthController.ts"

*[Continue one file at a time]*

---

## This Saves Time

Yes, this seems slower.

But you save **weeks** by not:
- Rebuilding wrong architecture
- Refactoring bad decisions
- Explaining undocumented choices
- Debugging mysterious bugs from skipped steps

**Document first = Fast later**

---

## For Teams

Share these docs:
- README.md → Product/Business
- architecture.md → Tech Lead/Architects  
- implementation.md → Engineers
- production.md → DevOps/SRE

Everyone reviews their part.

Everyone approves before code.

---

## Rule of Thumb

If you can't explain WHY without looking at code...

You skipped documentation.

Go back.
