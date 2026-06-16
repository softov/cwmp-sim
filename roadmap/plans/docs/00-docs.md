# docs — domain reference

Project documentation: a `docs/` tree for integrators (testing their ACS), contributors (hacking on
the simulator), and reference (TR-069 conformance / per-RPC behavior).

**Status:** ⚪ Not started · 🟡 In progress · 🟢 Shipped · 🔴 Blocked
_Check the box and set 🟢 when a plan ships. Keep these in sync with `../index.md`._

## Plans

- [ ] ⚪ **01** — [Docs & per-RPC reference](./01-docs-and-rpc-reference.md) · Priority: Medium
  - `docs/` structure (architecture, data-model, fleet, logging, configuration, contributing) + one file
    per RPC under `docs/rpc/` + the conformance matrix (PENDING Idea #19). Slim the README to a quick-start.

## Direction

Markdown-first, GitHub-rendered, **out of the npm tarball** (like `roadmap/`). README stays the
quick-start and links into `docs/`. Per-RPC docs are seeded from the existing `cwmp-methods.ts` JSDoc
(which already carries TR-069 section refs). The `docs/rpc/index.md` conformance matrix closes
PENDING Idea #19.
