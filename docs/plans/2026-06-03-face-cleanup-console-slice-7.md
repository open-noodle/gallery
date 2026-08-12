# Face Cleanup Console — Slice 7 (e2e + docs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use
> checkbox (`- [ ]`) syntax.

**Goal:** User-facing docs for the Face Cleanup Console (incl. the deliberate `unAttributable` no-op) and a
Playwright admin smoke test for the page.

**Architecture:** A Docusaurus admin doc page + a Playwright e2e spec. The full flagged-person flow needs ML
embeddings (the e2e stack runs ML-disabled), so the e2e is a **smoke** (page reachable, scan trigger, empty
state); the full UI behavior is already covered by the Slice-5/6 component tests + the Slice-3/4 medium tests.

**Tech Stack:** Docusaurus (Markdown), Playwright (`e2e/src/specs/web/`).

**Spec:** [`2026-06-03-face-cleanup-console-design.md`](2026-06-03-face-cleanup-console-design.md) §Testing/Slice 7 + §Open questions.

---

## Task 1: Docs page

**Files:** Create `docs/docs/administration/face-cleanup.md` (+ a sidebar entry if the admin section uses an
explicit sidebar/`_category_.json` ordering — check `docs/docs/administration/`).

- [ ] **Step 1: Write the doc**

Content (adapt headings to the repo's doc voice — look at a sibling like `jobs-workers.md`):

- **What it is:** after the misattribution event, some people's face clusters were polluted with another
  person's photos. The console finds these and lets an admin re-home the impostor faces to their true owner;
  the person keeps its real faces, name, and thumbnail. It is **not** a person-merge and never empties a cluster.
- **When to use it:** the automatic repair fixes clusters that are <50% contaminated; the console handles the
  rest (the "over-cap" clusters), with human confirmation.
- **How to use it:** Administration → Face cleanup → **Re-scan** (runs with the recognition queue idle) →
  review the table. Confident rows are pre-selected; **Review** the amber "review-first" rows (named, large, or
  routing into another flagged cluster) — open one to see the faces leaving vs the suspected owner, deselect any
  that are actually this person, then approve. Bulk-approve the confident long tail from the list.
- **Operating order:** clean the **owners first** (smallest flagged % first) so `bad-target` rows resolve.
- **Unattributable faces:** faces with no confident external owner are **left as-is on purpose** — moving them
  nowhere helps no one; they remain assigned and are surfaced in the totals.
- **Safety:** scans and applies refuse while facial recognition is running; applying re-queues recognition,
  which routes the impostor faces onto their true owner's existing faces.

- [ ] **Step 2: Format**

Run: `cd docs && npx prettier --write docs/administration/face-cleanup.md && npx prettier --check docs/administration/face-cleanup.md`.

- [ ] **Step 3: Commit**

```bash
git add docs/docs/administration/face-cleanup.md docs/docs/administration/_category_.json
git commit -m "docs: document the Face Cleanup admin console"
```

---

## Task 2: Playwright admin smoke

**Files:** Create `e2e/src/specs/web/face-cleanup.e2e-spec.ts`

Mirror an existing admin/web Playwright spec (e.g. `e2e/src/specs/web/photos-search.e2e-spec.ts` or another that
logs in as admin) for the harness/login helpers — copy its imports + `utils`/`asAdmin` setup exactly.

- [ ] **Step 1: Write the smoke test**

- Log in as admin; navigate to `/admin/face-cleanup`.
- Assert the page renders (heading "Face cleanup") and shows the **no-scan empty state** ("Run a scan to begin").
- Click **Re-scan**; wait for the scan to complete on the fresh (faceless) e2e DB; assert the **empty completed
  state** ("nothing to clean up") appears — NOT an error.

> If triggering a scan in the e2e stack is flaky or slow (job + recognition-idle gating), reduce the test to:
> page renders + the no-scan empty state + the Re-scan button is present/enabled. Do NOT assert on flagged
> persons (none exist without ML). Note what you covered.

- [ ] **Step 2: Run it**

Run it against the e2e stack the way the repo runs web e2e (check `e2e/package.json` scripts; likely
`make e2e-web-dev` against a running `make dev`, or the CI `pnpm test:web`). If you cannot bring up the full
stack locally, ensure the spec is well-formed (tsc/lint clean) and rely on CI **End-to-End Tests (Web)** — note
that you could not run it locally.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/specs/web/face-cleanup.e2e-spec.ts
git commit -m "test(e2e): face-cleanup admin page smoke"
```

---

## Self-Review

- **Spec coverage (Slice 7):** docs page incl. `unAttributable` no-op + operating order (T1) ✓; Playwright admin
  smoke (T2) ✓; the full flagged-flow e2e is **deliberately deferred** (ML-disabled e2e can't produce flagged
  persons) and that gap is covered by Slice-5/6 component tests + Slice-3/4 medium tests — documented, not silently dropped.
- **Placeholders:** none — doc content is spelled out; the e2e has an explicit reduced-scope fallback.
- **Feature complete after this slice** — ready for CI babysit + PR.
