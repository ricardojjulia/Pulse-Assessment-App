---
name: change-council
description: Mandatory internal council for every project change. Use before any feature, fix, update, dependency change, documentation change, configuration change, or refactor. Routes work through research, architecture, implementation, validation, and human review gates.
---

# Change Council

Every change to this repository must pass through the council. The council is an internal workflow, not a second implementation team: it creates a short decision record, delegates focused work, and keeps the human in control of scope and approval.

## Council Seats

- **Researcher**: maps the affected code and existing patterns. Read-only.
- **Architect**: defines scope, constraints, risks, and the smallest viable implementation. Read-only.
- **Implementer**: makes the approved change and adds focused tests. The only seat allowed to edit product files.
- **Validator**: checks the diff against the decision and project rules. Read-only; never fixes its own findings.
- **Reviewer**: performs the final release-readiness check. Read-only; the human owns the final approval.

Use existing Dynatrace domain skills whenever the change touches DQL, Strato, AppEngine, SDKs, or platform services. Load the relevant skill before the architect or implementer acts.

## Required Sequence

1. **Intake**: state the requested change, motivation, affected area, and explicit non-goals.
2. **Research**: inspect the relevant files, dependencies, current tests, and nearby patterns. Do not edit.
3. **Architecture gate**: record the proposed files, data/control flow, risks, validation command, and rollback or recovery path. Ask the human to approve, request changes, or reject.
4. **Implementation**: make the smallest coherent change. Keep edits within the approved scope. Add or update tests where the behavior can be tested.
5. **Validation**: run the narrowest useful check first, then the project build/lint/test commands. Compare the result with the approved architecture.
6. **Review gate**: report critical, important, and minor findings with file paths and line references. Ask the human to approve, request a repair loop, or reject.
7. **Delivery**: only after approval, commit and push when requested. Summarize the decision, implementation, validation, and residual risk.

## Approval Rules

- `approved`: proceed to the next stage.
- `changes requested`: revise only the affected council artifact, then return to the same gate.
- `rejected`: stop without editing product code and preserve the reason.
- Critical validation findings require a repair loop through the implementer, followed by validation again.

## Non-Negotiable Boundaries

- Never skip research or an approval gate because the change looks small.
- Never let the implementer widen the approved scope silently.
- Never let the validator or reviewer edit files.
- Never claim a build, test, query, or deployment passed without running it.
- Never expose secrets, unrestricted tenant data, or raw sensitive records to external AI.
- For DQL, use the DQL knowledge base before writing or changing a query.
- For Strato components, use the Strato knowledge base and inspect installed type definitions before changing UI code.

## Council Record

For non-trivial changes, capture the decision in `.github/council/<change-id>.md` using this shape:

```markdown
# Change Council: <title>

## Request
## Research Findings
## Approved Scope
## Non-Goals
## Validation Plan
## Decision
## Review Findings
## Delivery
```

Small changes still follow the sequence in the conversation; the record may be summarized in the final response when a repository artifact would add more noise than value.
