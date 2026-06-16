<!--
Domain: <domain>
Status: ⚪ Not started | 🟡 In progress | 🟢 Shipped | 🔴 Blocked   (🟡 also covers Partial)
Priority: Low | Medium | High
Created: YYYY-MM-DD
Revalidated: YYYY-MM-DD
Dependencies: <relative links to plans that must land first, or —>
Reference: ./00-<domain>.md
-->

# <DOMAIN-NN> — <Plan title>

_Status: ⚪ Not started · Priority: Medium · Created: YYYY-MM-DD_

<!-- Status legend: ⚪ Not started · 🟡 In progress / Partial · 🟢 Shipped · 🔴 Blocked.
     When status changes, update it in THREE places: this header, ./00-<domain>.md, and ../index.md. -->

## Goal

One paragraph. What changes, and why, in product terms. No implementation detail here.

## Reconnaissance

Grounds the whole plan. Filled during Gate 1 — never empty, never SDK-only.

### Files read

- `path/file.ts` — why it matters / what it currently does.

### Searches performed

- `rg "TypeName|EventName"` — result summary.

### Runtime path

```
entrypoint → dispatcher/orchestrator → module/service → contract/types → store/event → observable effect
```

### Existing patterns to reuse

- `path/file.ts:line` — the pattern this plan mirrors.

### Gaps

- Missing contract / behavior / validation / UI state / tests.
- `Not found: <thing> — searched <terms> in <paths>.`

## Decisions locked in

Every decision settled by the notes, the code, or a question answered before writing. Anything not
here is undecided — and an undecided fork hit during implementation means STOP and ask, then amend.

| # | Decision | Rationale / source |
|---|----------|--------------------|
| 1 | <decision> | <user answer / code evidence / `(defaulted: …)`> |

## Proposed architecture

- **Data flow** — …
- **Event flow** — …
- **State flow** — …
- **Layer responsibilities** — xxx: …
- **Source-of-truth files** — `src/...` (the module that owns the shared types/contracts).

## Phases

> If this plan was split, this section is a phase map linking child plans instead (see the parent `00-<domain>.md`).

### Phase 1 — <objective>

**Objective:** …
**Expected result:** …
**Validation:** …

#### Task: <clear task name>

- **Layer:** xxx  _(one task per layer if it spans layers)_
- **Files:**
  - `CREATE: src/.../file.ts`
  - `UPDATE: src/.../file.ts:120-145`
  - `DELETE: …` _(omit lines that don't apply)_
- **Reason:** why this task exists.
- **Integration points:** how it wires to events / routes / stores / runtime.
- **Data contracts:**
  ```ts
  import type { SomeRealType } from '...';
  ```
- **Code:**
  ```ts
  // real example using real names — not pseudocode
  ```
- **Validation:** expected behavior + how to check (test / manual / logs).

## Risks & tradeoffs

- <only the relevant risks>

## Resume state

Checkpoint so a fresh session can continue cold.

- **Done so far:** <phases/tasks completed, with commit/file evidence>
- **Next action:** <the single next concrete step>
- **Open questions:** <should be none; if any, the plan is not ready>
- **Watch out for:** <gotchas discovered mid-implementation>

## Final verification checklist

- [ ] All phases' validation steps pass.
- [ ] Type-check clean (this repo: `npm run check`).
- [ ] Relevant tests pass (this repo: `npm test`).
- [ ] No contract drift — shared shapes come from the source-of-truth types module.
- [ ] Status circle synced in three places: this plan's header, `00-<domain>.md`, and `index.md`.
