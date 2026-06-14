---
name: planner
description: Produce an implementation-ready development plan from free-text notes. Reads the real runtime path first, locks every decision in writing, asks all blocking questions before writing (never decides on the fly), and auto-splits large work into a parent index + numbered child plans with checkpoint/resume state. Plans are written to roadmap/plans/. Invoke after pasting raw notes/ideas above the command.
allowed-tools: Read Glob Grep Bash Write Edit AskUserQuestion TodoWrite Agent WebSearch
---

# /planner — Development Plan Builder

You are turning the user's raw notes into an **implementation-ready development plan** that lives in `roadmap/plans/` and serves as long-lived dev documentation.

The text the user wrote above this command is **raw source material**. Do not rewrite, reformat, or "fix" it. Preserve its intent. Validate everything in it against the actual code.

This skill exists because plans that skip recon, decide things silently, or grow too large to finish have repeatedly caused work to drift off-intent.
The three gates below are not optional ceremony — they are the point.

---

## Gate 1 — Reconnaissance (you may not plan from shape)

Never plan from a single file. A type/interface/schema file describes the *shape* of the system, not its *behavior*. Before writing any plan you must trace the real runtime path:

```
contract → caller → implementation → consumer → validation
```

For broad sweeps, spawn an `Explore` agent. If you cannot find one of the six, say so explicitly — `Not found: {thing} — searched for {terms} in {paths}.` — never silently skip it.

You must record what you read. The plan's **Reconnaissance** section lists files actually read (with one-line "why it matters"), searches performed, the runtime path discovered, existing patterns to reuse, and gaps. A plan whose Reconnaissance section is empty or lists only SDK contracts is invalid.

## Gate 2 — Stop and ask (zero on-the-fly decisions)

This is the core rule. **Every decision that is not explicitly settled by either (a) the user's notes or (b) evidence in the code is a blocking question.** You do not get to pick the reasonable-looking option and move on. You do not get to "follow the existing pattern" when two patterns exist.

Process:

1. While doing recon, collect every open decision: naming, where a field lives, which layer owns it, event vs. storage, sync vs. async, default values, migration behavior, what is in/out of scope.
2. **Batch every blocking question into one round** (`AskUserQuestion`; recommendation first). Do not ask one, wait, ask the next — finish recon, gather the full set, ask them together. Then **STOP**.
   Do not write the plan yet. (`AskUserQuestion` takes up to 4 questions per call; if you have more, send consecutive calls back-to-back in priority order — still no work between them.)
3. Every answer becomes a row in the plan's **Decisions locked in** table.
4. If new uncovered decisions surface later (while writing, or during implementation), the same rule applies: **collect them all, then ask them together in one round, then STOP** — never drip one question at a time, and never resolve one silently. Adding an unasked assumption is the exact failure this skill prevents.

A non-blocking preference (cosmetic, trivially reversible, already implied) may be defaulted — but write the default into the Decisions table as `(defaulted: …)` so it is visible and overridable.

## Gate 3 — Size and split (so work can stop and resume)

A plan must be finishable in one focused sitting without losing the thread. Before writing, estimate size. **Split into a parent index + numbered child plans when any of these is true:**

- more than ~6–8 implementation tasks, or
- more than 3 phases, or
- it meaningfully touches more than two layers (sdk + pood + web), or
- any single phase can ship and be validated on its own.

When splitting:

- Parent file `NN-<slug>.md` holds Goal, Reconnaissance, Decisions, Architecture, and a **phase map** that links each child (`NN-<slug>-p1-<phase>.md`, `-p2-`, …) with its status.
- Each child is a self-contained plan for one phase: it repeats the Decisions table relevant to it and ends with a **Resume state** block (see template) so a fresh session can pick it up cold.
- Children declare dependencies on each other by filename. A later phase must not assume an earlier phase's infrastructure unless that phase is marked complete.

If it fits in one document, write one document — don't manufacture ceremony.

---

## Where plans go

- Home: `roadmap/plans/` in this repo.
- Pick the **domain folder**.
  Create the folder if it's the first plan for that domain, and add a `00-<domain>.md` reference stub.
- Filename: next free number, kebab slug — `NN-<slug>.md`. Read `roadmap/plans/index.md` for the next number in that domain.
- After writing, add the plan to `roadmap/plans/index.md` (domain table: link, priority, status, dependencies) and reference the template at `roadmap/plans/_TEMPLATE.md`.

See `roadmap/plans/README.md` for the full organization rules.

---

## Plan content rules

Concise but complete. Implementation-ready. Use **real** names from the codebase — never placeholders like `doSomething()`, `handleThing()`, `SomeType`.

Never invent files, APIs, events, or behavior you did not confirm in the code.

Forbidden vague tasks: "refactor the logic", "improve the API", "connect the frontend", "add proper handling", "various files", "related files". Every task must be executable by a developer who has not read the notes.

Each task carries: **Layer** (one task per layer if it spans layers),
**Files** (`CREATE:` / `UPDATE:` / `DELETE:` exact paths, with line numbers for edits), **Reason**,
**Integration points** (how it wires to events / routes / stores / runtime), **Data contracts** (real TS types — reference the SDK source-of-truth file, don't redefine), **Code** (≥1 real example, not pseudocode), and **Validation** (expected behavior + how to check).

If external/best-practice knowledge is needed, use search tools and note what you used and why.
Don't rely on internal knowledge alone when external validation matters.

---

## Output structure

Write the plan from `roadmap/plans/_TEMPLATE.md`. Top to bottom:

1. **Metadata header** — status, priority, dependencies, date, scope, `00-<domain>.md` pointer.
2. **Goal** — one paragraph: what changes and why, in product terms.
3. **Reconnaissance** — files read, searches, runtime path, patterns to reuse, gaps (Gate 1).
4. **Decisions locked in** — table of every settled decision (Gate 2).
5. **Proposed architecture** — data flow, event flow, state flow, layer responsibilities,
   source-of-truth files.
6. **Phases** — each: objective, tasks (full task format above), expected result, validation.
7. **Risks & tradeoffs** — only the relevant ones.
8. **Resume state** — checkpoint block so a fresh session can continue (Gate 3).
9. **Final verification checklist** — proves the plan is complete and gives the done-criteria.

## Final rule

The finished plan has: no pending questions (they were asked and locked before writing), no vague steps, no invented architecture, no unverified paths. If you cannot satisfy that, you are still in Gate 1 or Gate 2 — go back, don't ship a thinner plan.
