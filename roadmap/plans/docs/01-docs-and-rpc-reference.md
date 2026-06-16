<!--
Domain: docs
Status: ⚪ Not started
Priority: Medium
Created: 2026-06-15
Revalidated: 2026-06-15
Dependencies: — (documents shipped behavior; no code dependency)
Reference: ./00-docs.md
-->

# DOCS-01 — Docs & per-RPC reference

_Status: ⚪ Not started · Priority: Medium · Created: 2026-06-15_

<!-- Status legend: ⚪ Not started · 🟡 In progress / Partial · 🟢 Shipped · 🔴 Blocked.
     When status changes, update it in THREE places: this header, ./00-docs.md, and ../index.md. -->

## Goal

Stand up a `docs/` tree that serves three audiences — **integrators** (people testing their ACS with
cwmp-sim), **contributors** (people hacking on it), and **reference** (TR-069 conformance / per-RPC
behavior) — with **one file per RPC** under `docs/rpc/` and a conformance matrix that closes PENDING
Idea #19. Slim the 497-line README down to a quick-start that links into `docs/`. Markdown-first,
GitHub-rendered, kept out of the npm tarball.

## Reconnaissance

### Files read / searched

- `src/cwmp-methods.ts` — **20 RPC handlers**: `Inform`, `InformResponse`, `GetParameterValues`, `GetParameterNames`, `SetParameterValues`, `AddObject`, `DeleteObject`, `TransferCompleteResponse`, `Download`, `Upload`, `Reboot`, `FactoryReset`, `GetRPCMethods`, `SetParameterAttributes`, `GetParameterAttributes`, `ScheduleInform`, `GetQueuedTransfers`, `GetAllQueuedTransfers`, `ScheduleDownload`, `CancelTransfer`. Each already has JSDoc with a `TR-069 Amendment 5, Section …` ref (`rg -c` → 20) + a description and the fault codes (`FAULTCODE_*` constants) — the **seed source** for per-RPC docs.
- `README.md` — 497 lines: intro, What-Is/Is-Not, supported RPC list, session/diagnostics/transfer mermaid diagrams, requirements, install/usage, **Logging**, **Templated identities**, configuration tables (env + CLI), project structure. Much of this is reference that belongs in `docs/` so the README can be a quick-start.
- `PENDING.md` — Idea #19 ("Conformance checklist — document which TR-069 Amd 5 RPCs/behaviors are spec-conformant"). The `docs/rpc/index.md` matrix is its home.
- `package.json` — `files: ["dist", "README.md", "LICENSE"]` → `docs/` is **not** published (GitHub-facing, like `roadmap/`). No change needed.
- Existing planning docs (`roadmap/plans/`) — the contributor "how we plan" workflow links here.

### Existing patterns to reuse

- The JSDoc section refs + fault constants in `cwmp-methods.ts` → seed each RPC file's header + faults table.
- README mermaid diagrams (session flow, diagnostics, transfers) → move/expand into `docs/architecture.md` and per-RPC examples.
- The shipped behavior is already documented in `roadmap/plans/*` (logging, fleet, templating) → source for `docs/*` narrative.

### Gaps

- No `docs/` tree.
- README mixes quick-start with deep reference (too long to skim).
- No conformance matrix; no per-RPC reference.

## Decisions locked in

| # | Decision | Rationale / source |
|---|----------|--------------------|
| 1 | **One file per RPC** under `docs/rpc/` (~20) + `docs/rpc/index.md` index/matrix. | User answer (RPC docs). |
| 2 | Plan only now — no build this pass. | User answer (Scaffold → plan). |
| 3 | Per-RPC files are **seeded from `cwmp-methods.ts` JSDoc** (section ref + description + faults). | `(defaulted: the seed source exists; avoids hand-copying)`. |
| 4 | `docs/` is **Markdown-first, GitHub-rendered, out of the npm tarball** (no `files` change). | `(defaulted: matches roadmap/ handling)`. |
| 5 | README is **slimmed to a quick-start** (install, one run example, links into `docs/`); deep config/reference moves to `docs/configuration.md`. | `(defaulted: README is 497 lines; avoid duplication)`. |
| 6 | Conformance matrix columns: **RPC · Supported · Conformant · Notes**, in `docs/rpc/index.md` (closes PENDING #19). | `(defaulted: minimal useful matrix)`. |
| 7 | Tooling: plain `.md` now; a static site (VitePress/Docusaurus over `docs/`) is a future option, no restructure needed. | `(defaulted: smallest viable)`. |

## Proposed architecture

```
docs/
├─ index.md            # landing / TOC
├─ architecture.md     # 4-class model: CWMPDevice (self-running) + CwmpParams + CWMPConn (CR routing)
│                       #   + CWMPSimulator (fleet); session loop; event bus
├─ data-model.md       # parameter tree, TR-098/181, leaf shape {_value,_type,_writable}, templates
├─ configuration.md    # full env-var + CLI-flag reference (the deep version of the README tables)
├─ fleet.md            # multi-device: --count, CR routing /{hash}, getConnectionHash, --boot-delay
├─ logging.md          # levels, BYO logger, --log-level trace envelopes
├─ contributing.md     # dev setup, npm scripts, tests, "how to add an RPC", roadmap/plans workflow
└─ rpc/
   ├─ index.md         # RPC reference index + CONFORMANCE MATRIX (#19)
   └─ <RPC>.md × 20    # one per handler (seeded from JSDoc)
```

**Audience map:** integrators → `configuration`/`fleet`/`logging`/`rpc`; contributors →
`architecture`/`contributing`/`data-model` + per-RPC source links; reference → `rpc/index.md` matrix.

### Per-RPC file template

```markdown
# SetParameterValues
> TR-069 Amendment 5 · §A.3.2.1 · ACS → CPE

## Purpose
One-paragraph summary.

## Request (handled fields)
| Element | Notes |
|---|---|
| ParameterList[].Name / .Value | … |

## Response
`SetParameterValuesResponse` with `Status` 0 — or a CWMP fault.

## Faults
| Code | When |
|---|---|
| 9008 | a parameter could not be written (read-only / unknown) |

## Simulator behavior & limitations
- Writes applied individually; first failure → 9008 fault (not atomic — PENDING Idea #7).

## Example
```xml
<cwmp:SetParameterValues>…</cwmp:SetParameterValues>
```

## Source
[`src/cwmp-methods.ts` → `SetParameterValues`](../../src/cwmp-methods.ts)
```

## Phases

### Phase 1 — Structure + core docs + README slim

**Objective:** the `docs/` skeleton and the narrative docs exist; README becomes a quick-start.
**Validation:** links resolve on GitHub; README skimmable.

#### Task: Scaffold docs/ + landing + narrative docs
- **Files:** `CREATE: docs/index.md`, `docs/architecture.md`, `docs/data-model.md`, `docs/configuration.md`, `docs/fleet.md`, `docs/logging.md`, `docs/contributing.md`.
- **Reason:** the contributor + integrator surfaces; source the content from `roadmap/plans/*` (already written) and the README's reference sections.
- **Validation:** every doc links from `docs/index.md`; mermaid renders.

#### Task: Slim the README
- **Files:** `UPDATE: README.md` — keep intro/badges, What-Is/Is-Not, a single quick-start (install + `npx`/one run), and a "Documentation" section linking into `docs/`. Move the deep config tables + Templated-identities + Logging detail into `docs/configuration.md`/`docs/logging.md` (leave a short pointer).
- **Validation:** README is materially shorter and points to `docs/`.

### Phase 2 — Per-RPC reference + conformance matrix

**Objective:** one doc per RPC + the matrix (#19). **Validation:** all 20 RPCs covered; matrix complete.

#### Task: RPC index + conformance matrix
- **Files:** `CREATE: docs/rpc/index.md` — links to all per-RPC files + a table `RPC · Supported · Conformant · Notes` covering the 20 handlers (mark the known gaps: atomic SPV #7, ScheduleInform/ScheduleDownload/CancelTransfer limitations).
- **Validation:** matrix row count = 20; PENDING #19 can be checked off.

#### Task: Per-RPC files (seeded from JSDoc)
- **Files:** `CREATE: docs/rpc/<RPC>.md` ×20 using the template, seeded from each handler's JSDoc (section ref + description) and its fault codes. Fully write the high-traffic ones (`Inform`, `GetParameterValues`, `SetParameterValues`, `AddObject`, `DeleteObject`, `Download`, `Upload`); leave the rest as seeded stubs with the template filled where the code is clear.
- **Validation:** each file has the section ref, a faults table, a behavior note, and a source link.

#### Task: Close PENDING #19
- **Files:** `UPDATE: PENDING.md` — check Idea #19, pointing at `docs/rpc/index.md`.

## Risks & tradeoffs

- **Docs drift** from code — mitigate by seeding from JSDoc and linking each RPC file to its source; a future task could lint that every `SUPPORTED_METHODS` entry has a doc.
- **README churn** — slimming may move content integrators bookmarked; leave clear pointers.
- **Scope creep** into a static site — explicitly deferred (Decision 7).

## Resume state

- **Done so far:** Plan written; decisions locked. No docs yet.
- **Next action:** Phase 1 — scaffold `docs/` + `docs/index.md` + `architecture.md` (source from `roadmap/plans/architecture` + `fleet`).
- **Open questions:** None.
- **Watch out for:** `docs/` must stay out of `package.json` `files` (it already is). Seed per-RPC files from JSDoc to keep them accurate; don't invent behavior — link to `cwmp-methods.ts`.

## Final verification checklist

- [ ] `docs/` tree exists; `docs/index.md` links every page; mermaid renders on GitHub.
- [ ] One file per RPC (20) under `docs/rpc/`, each with section ref + faults + behavior + source link.
- [ ] `docs/rpc/index.md` conformance matrix covers all 20 RPCs (PENDING #19 checked).
- [ ] README slimmed to quick-start + a Documentation section linking into `docs/`.
- [ ] `docs/` not in the npm tarball (`npm run release:dry` unchanged).
- [ ] Status synced: this header, `00-docs.md`, `index.md`.
