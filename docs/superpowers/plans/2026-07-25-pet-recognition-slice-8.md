# Slice 8 — OpenAPI, e2e, full verification

- **Spec:** [`../specs/2026-07-25-pet-recognition-phase2-implementation-slices.md`](../specs/2026-07-25-pet-recognition-phase2-implementation-slices.md) § Slice 8
- **Depends on:** Slices 1–7
- **Scope:** generated clients, e2e coverage, and the repo-wide gates.

## Objective

Generated clients match the new DTO, the feature has API-level coverage, and every CI gate is green
before the PR.

## 1. Regenerate API clients

Slice 3 already regenerated the TypeScript SDK (web needed it to typecheck). This slice completes the
job with the Dart client:

```bash
cd server && pnpm build && pnpm sync:open-api
cd .. && make open-api          # TypeScript SDK + Dart client (Dart generation requires Java)
```

If Java is unavailable, regenerate TypeScript only (`make open-api-typescript`) and **say so
explicitly in the PR body** — do not commit a partial regen silently, and do not hand-edit generated
files.

Verify the working tree is clean afterwards apart from intended generated changes:
`git status --short` should show only `open-api/`, `packages/sdk/`, `mobile/openapi/` churn.

## 2. e2e coverage

Extend `e2e/src/specs/server/api/pet-detection.e2e-spec.ts` (or add
`pet-recognition.e2e-spec.ts` alongside it, following its structure):

| #   | Test                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1 | `GET /system-config` returns `machineLearning.petRecognition` with the documented defaults (`enabled: false`, `modelName: 'pet-recognition-base'`, `maxDistance: 0.55`, `minFaces: 1`) |
| 8.2 | updating `petRecognition.enabled` round-trips (PUT then GET)                                                                                                                           |
| 8.3 | `maxDistance` outside `[0.1, 2]` is rejected with 400                                                                                                                                  |
| 8.4 | `minFaces` below 1 is rejected with 400                                                                                                                                                |
| 8.5 | `GET /jobs` includes the `petRecognition` queue                                                                                                                                        |
| 8.6 | the `petRecognition` queue accepts pause/resume/empty commands                                                                                                                         |

Note the existing file asserts the **whole** `petDetection` config object with `toEqual`, so adding a
sibling block does not break it — but check for any exhaustive assertion over `machineLearning` as a
whole and update it if present.

## 3. Full verification gate

Run all of these; every one must be green before the PR:

```bash
# server
cd server && pnpm test -- --run
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/pet-search.repository.spec.ts test/medium/specs/services/pet-recognition.service.spec.ts

# web
cd web && pnpm test -- --run
cd web && pnpm check:typescript && pnpm check:svelte

# ml
cd machine-learning && uv run pytest -q && uv run ruff check immich_ml && uv run mypy --strict immich_ml

# repo-wide lint + format (separate CI gates!)
make lint-server lint-web
make format-server format-web && git diff --exit-code

# docs (CI Docs Build is strict about prettier, including docs/superpowers/**)
npx prettier --check "docs/**/*.md"
```

`make format-*` followed by `git diff --exit-code` is the reliable way to prove prettier is
satisfied: if formatting changed anything, the diff is non-empty and the gate fails.

## 4. PR

```bash
git push
gh pr create --repo open-noodle/gallery --base main --head feat/pet-recognition \
  --title "feat: individual pet recognition (Phase 2)" --body-file <(...)
```

Use the `Deeds67` GitHub account for the push/PR (repo policy). The PR body must cover:

- what ships (3 published models + server pipeline + admin UI), with the measured EERs
- the **default-off** behaviour and why upgrading users are unaffected
- the reprocess semantics when an admin enables recognition or switches model
- what is deliberately out of scope (mobile, deep shared-space projection, Phase-1.5 quality levers)
- anything that could not be verified locally (e.g. Dart regen if Java was missing)

Then babysit CI until green.

## Note on CI triggering

Pushes to `feat/*` branches do **not** trigger the test workflow — only `pull_request` and `main` do.
Opening the PR is what starts CI. If a targeted run is needed before that:
`gh workflow run test.yml --ref feat/pet-recognition`.

## Commit

`chore(pet-recognition): regenerate API clients and add e2e coverage`
