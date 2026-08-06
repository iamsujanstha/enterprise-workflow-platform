---
inclusion: auto
---

# Architecture-First Workflow

When a user asks to build a feature, ALWAYS follow this exact sequence. Never skip steps. Never auto-advance.

## Step Sequence

1. Create `README.md` → wait for human approval
2. Create `architecture.md` (full template) → wait for human approval
3. Review Mermaid diagrams → wait for human approval
4. Review Tradeoffs section → wait for human approval
5. Create `implementation.md` → wait for human approval
6. Create `production.md` → wait for human approval
7. ONLY THEN generate code — one component at a time

## Approval Gate

After each step output, end your response with:

> Reviewed and ready to proceed? Reply **"proceed"** to continue to the next step, or provide feedback to revise.

NEVER advance to the next step without an explicit approval from the human.

## Architecture Template (Required Sections)

Every `architecture.md` MUST include these sections in order:

1. Business Problem
2. Requirements (Functional + Non-Functional)
3. High Level Architecture (Mermaid `graph`)
4. Data Flow (Mermaid `sequenceDiagram`)
5. Database (Collections + Indexes)
6. API Design (Endpoints table + DTOs)
7. Frontend (Component hierarchy + State + Cache)
8. Backend (Modules + Services + Guards + Events)
9. Security (Threats + Mitigation)
10. Scaling (100 / 10k / 1M users)
11. Failure Scenarios (at least 3)
12. Monitoring (Logs + Metrics + Tracing)
13. Tradeoffs (Alternative A + B + Why This One)

If any section is missing, complete it before presenting to the user.

## Code Generation Rules

When generating code:
- Generate ONE component per response
- Reference the approved `architecture.md` explicitly
- Include JSDoc comments
- Include error handling
- Include unit tests in the same response
- End with: "Review this component before generating the next one."

## What Counts as Approval

- "proceed", "approved", "looks good", "continue", "yes" → proceed to next step
- Any feedback, question, or concern → revise current step, do NOT advance

## File Structure

Docs live at: `docs/[feature-name]/`
- `README.md`
- `architecture.md`
- `implementation.md`
- `production.md`

Diagrams live at: `diagrams/[feature-name]/`
- `Context.mmd`
- `Container.mmd`
- `Sequence.mmd`
- `Deployment.mmd`
