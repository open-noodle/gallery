# Phase A Slice A7 — Visual Cleanup Hardening and L3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote visual cleanup to "Solid now", add live L3 routing/plan coverage, ship an RC to the personal instance, and re-seed `baseline.l3.json`.

**Architecture:** A6 proves the deterministic quality-filtered plan path locally. A7 updates the capability matrix and validates the same path against the personal Gallery instance through propose-only L3 scenarios; the RC-personal flow pins the feature branch image without touching ML.

**Tech Stack:** Markdown capability matrix + generated strict-workflow block; agent-runner L3 eval; GitHub Actions `gallery-rc-build`; infra-gitops/ArgoCD personal deployment.

---

## Task 1: Promote Matrix Capability Text

**Files:**

- Modify: `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`
- Modify: `server/src/services/agent-capability-matrix.spec.ts`
- Generate: `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`

- [ ] **Step 1: Write RED spec expectation.** In `server/src/services/agent-capability-matrix.spec.ts`, change the visual cleanup expectation from `Constrained now` to `Solid now`, and assert the row mentions quality scoring / sharpness or brightness. Add an expectation that "Best photos" still says objective quality scoring is distinct from suggested highlights.
      Run: `/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run agent-capability-matrix.spec`
      Expected: RED because the matrix still says `Constrained now`.

- [ ] **Step 2: Update hand-authored matrix rows.** In the Flow Ownership Matrix, make `Visual cleanup` `Hybrid` with a workflow boundary around quality-filtered `searchAssets` -> reviewable `asset.trash`. In High-Value Constrained Capabilities, move `Visual cleanup` to `Solid now` because A6 added objective quality filters; keep screenshot/document visual-only cleanup constrained. Update "Best photos" wording to note objective best-photo ranking now has quality scores available but highlight curation remains bounded and reviewable.

- [ ] **Step 3: Regenerate workflow block.**
      Run: `/opt/homebrew/bin/mise exec -- pnpm -C server build && /opt/homebrew/bin/mise exec -- pnpm -C server sync:agent-capabilities`
      Expected: generated workflow block stays in sync with `visual_cleanup`.

- [ ] **Step 4: Run GREEN matrix spec.**
      Run: `/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run agent-capability-matrix.spec`
      Expected: PASS.

- [ ] **Step 5: Commit.**
      `git add docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md server/src/services/agent-capability-matrix.spec.ts && git commit -m "docs(agent): promote visual cleanup in capability matrix (roadmap A7)"`

## Task 2: Add L3 Scenarios and Baseline

**Files:**

- Modify: `agent-runner/eval/scenarios/l3-readonly.mjs`
- Generate: `agent-runner/eval/baseline.l3.json`

- [ ] **Step 1: Write RED L3 scenario expectation locally.** Add:
  - `l3.recall.visualcleanup.blurry`: prompt `trash my blurry photos`, expect `{ kind: 'visual_cleanup' }`.
  - `l3.recall.visualcleanup.dark`: prompt `delete dark photos from my recent uploads`, expect `{ kind: 'visual_cleanup' }`.
  - `l3.plan.visualcleanup.blurry`: prompt `trash my blurry photos from last month`, expect `{ kind: 'visual_cleanup', planProposed: SEEDED ? true : undefined }`, threshold `0.5`.
    Run: `/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner eval -- --layer L3 --filter l3.recall.visualcleanup`
    Expected before the RC is deployed: the local branch runner may pass locally, but this is not sufficient for A7 until personal is pinned and the live L3 run is accepted.

- [ ] **Step 2: Run L3 formatting/syntax check.**
      Run: `/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test -- src/strict-workflows/manifest.test.mjs`
      Expected: PASS; scenario file imports cleanly during eval.

- [ ] **Step 3: Commit scenarios before RC build.**
      `git add agent-runner/eval/scenarios/l3-readonly.mjs && git commit -m "test(agent): add visual cleanup L3 scenarios (roadmap A7)"`

## Task 3: RC-Personal Deployment

**Files:**

- External repo: `/Users/pierre/dev/infra-gitops/apps/personal/server.yaml`

- [ ] **Step 1: Push feature branch.**
      Run: `git push origin explore/pi-agent-brainstorm`
      Expected: branch is available to `open-noodle/gallery` remote for the RC workflow.

- [ ] **Step 2: Build RC image.**
      Pick a new tag such as `explore-pi-agent-brainstorm-a7-rc1`.
      Run:
      `gh --repo open-noodle/gallery workflow run gallery-rc-build.yml --ref explore/pi-agent-brainstorm -f rc_tag=explore-pi-agent-brainstorm-a7-rc1`
      `gh --repo open-noodle/gallery run list --workflow=gallery-rc-build.yml --limit 1`
      `gh --repo open-noodle/gallery run watch <run-id>`
      Expected: workflow succeeds and publishes `ghcr.io/open-noodle/gallery-server:explore-pi-agent-brainstorm-a7-rc1`.

- [ ] **Step 3: Pin personal server image.**
      Run in `/Users/pierre/dev/infra-gitops`:
      `git pull --rebase`
      `sed -i -E "s|(image:\\s*ghcr\\.io/open-noodle/gallery-server:)[^[:space:]]+|\\1explore-pi-agent-brainstorm-a7-rc1|" apps/personal/server.yaml`
      `git add apps/personal/server.yaml && git commit -m "rc(personal): pin server to explore-pi-agent-brainstorm-a7-rc1" && git push`
      Expected: only `apps/personal/server.yaml` changes; ML remains on `:release`.

- [ ] **Step 4: Sync ArgoCD and verify rollout.**
      Run:
      `KUBECONFIG=~/.kube/noodle-k3s.yaml kubectl -n argocd patch app personal --type merge -p '{"operation":{"sync":{"revision":"HEAD"}}}'`
      `KUBECONFIG=~/.kube/noodle-k3s.yaml kubectl -n personal rollout status deploy/gallery-server --timeout=300s`
      `KUBECONFIG=~/.kube/noodle-k3s.yaml kubectl -n personal get pod -l app=gallery-server -o jsonpath='{.items[0].spec.containers[0].image}'`
      `curl -fsSI https://pierre.opennoodle.de/api/server/ping`
      Expected: running image uses the RC tag and ping returns success.

## Task 4: Live L3 Run and Final Verification

**Files:**

- Generate: `agent-runner/eval/baseline.l3.json`

- [ ] **Step 1: Run live L3 diff against personal.**
      Run: `/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner eval -- --layer L3 --diff`
      Expected: no unexpected failures; visual cleanup recall routes to `visual_cleanup`. Plan assertion is routing-only on personal unless `EVAL_L3_SEEDED=1`.

- [ ] **Step 2: Accept L3 baseline.**
      Run: `/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner eval -- --layer L3 --accept`
      Expected: `agent-runner/eval/baseline.l3.json` includes the new visual cleanup scenarios.

- [ ] **Step 3: Run final local gates.**
      Run:
      `/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test`
      `/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run agent-capability-matrix.spec`
      `/opt/homebrew/bin/mise exec -- make lint-server && /opt/homebrew/bin/mise exec -- make check-server && /opt/homebrew/bin/mise exec -- make check-web`
      Expected: PASS.

- [ ] **Step 4: Commit L3 baseline.**
      `git add agent-runner/eval/baseline.l3.json && git commit -m "test(agent): accept visual cleanup L3 baseline (roadmap A7)"`

- [ ] **Step 5: Push and babysit CI.**
      Run: `git push origin explore/pi-agent-brainstorm`
      Then use the `babysit` skill until PR checks are green.

## Safety Notes

- L3 is propose-only/read-only: the eval uses plan-only approval and audits that no plan reaches applied.
- Personal RC pins only `gallery-server`; do not edit or rebuild `gallery-ml`.
- If the same RC tag was already used, bump the suffix to `-rc2` before dispatching.
