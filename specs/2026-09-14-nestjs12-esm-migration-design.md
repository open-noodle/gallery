# NestJS 12 + ESM migration — integration design (2026-09-14)

How Gallery absorbs upstream Immich's `feat: NestJS 12 and ESM` (immich-31237) and its paired
`feat: server imports linting` (immich-31537) through the rolling upstream rebase.

**Status:** designed and approved 2026-09-14. Implementation pending.

## Why this needed a design

Upstream tagged **v3.2.1** on `release/v3.2`, not on `main`. That is the normal shape now and it does
not change the rebase source: `upstream/main` is a strict content superset of the tag. Of the 56
commits on `release/v3.2` that are not on `main`, 46 are patch-identical to a `main` commit, 5 are
release-branch-only `chore: version` bumps, and the remaining 5 are on `main` under **different PR
numbers** — they differ only in context, because `main` has already landed ESM and the release branch
has not:

| On `release/v3.2` | On `upstream/main` | Subject |
| --- | --- | --- |
| immich-31375 | immich-31355 | maplibre-gl v6 (security) |
| immich-31446 | immich-31424 | vacuum after migrations, concurrent reindex |
| immich-31463 | immich-31461 | sync client disconnect |
| immich-31554 | immich-31551 | metadata extraction of faces |
| immich-31555 | immich-31456 | people merge improvements |

So the standing rule holds — **do not retarget the rebase at `release/*`**. Pulling `upstream/main`
to `ca4637adc79` reaches v3.2.1 parity and four weeks beyond it.

The reason this cycle is not routine is the third of its 32 pending commits.

## What is actually incoming

`2a626220415` — `feat: NestJS 12 and ESM (immich-31237)`, **626 files, +4558/−4817**. It is not an
import-suffix sweep; it is a stack of coupled majors:

- `"type": "module"`, `module`/`moduleResolution` → `nodenext`, `isolatedModules: true`
- NestJS 11 → 12 (eleven `@nestjs/*` packages: eight runtime, plus `cli`, `schematics`, `testing`)
- **Vitest 3 → 4**
- **Kysely 0.28.17 → ^0.29.5**
- `lodash` → `lodash-es`
- build becomes `nest build && tsc-alias`

Seventeen commits later, `221ddd31c4a` — `feat: server imports linting (immich-31537)`, 319 files —
adds `eslint-plugin-import-x` and makes the new import style a CI gate.

### Measured blast radius

A stage-0 merge spike (`git merge --no-commit --no-ff upstream/main` from `origin/main`, rerere
disabled) produced the real inventory rather than estimates:

| Measure | Count |
| --- | --- |
| Conflicted files, one pass, all 32 commits | **156** (124 server, 18 mobile, 5 e2e, 4 web) |
| …of those, carrying in-tree conflict regions | 150 (the other 6 are modify/delete and add/add) |
| Conflict regions | **219** |
| …fully mechanical (import blocks only) | **155 regions across 111 files** |
| …genuinely semantic | **64 regions across 39 files** |
| Fork-modified upstream server files the ESM commit also touches | 203 |
| Fork-only files under `server/src` | 293 |
| Fork commits that modify import lines in ESM-touched files | **147** |

The semantic work is concentrated: `person.service.ts` (8 regions), its two spec files (6),
`utils/config.ts` (3), `packages/sdk/src/fetch-client.ts` (3), `asset.service.ts` (2),
`utils/file.ts` (2), then a tail of single-region files.

None of the 18 mobile conflicts come from ESM — that commit touches only `server/`, `e2e/`,
`packages/` and the lockfile. They are dominated by **immich-31099 (static `Store`), which accounts
for 11 of the 18** and lands squarely on the fork's mobile people surface: `people.service.dart`,
`people_collection.page.dart`, `people_details.widget.dart`, `people.provider.dart`,
`people_picker.dart` and both person-edit modals. The remainder are immich-30345 (cloud ids, 3),
immich-31457 (DataController, 2), and one each from immich-31541, immich-31428, immich-31277 and
immich-31441.

The tension the design resolves: a **merge** reaches this end state in one pass, but the rolling flow
needs a **rebase**, which replays 1493 fork commits — 147 of which would conflict individually on
import lines.

## Section 1 — Scope and sequencing

Target `ca4637adc79`; all 32 commits.

**Fork-sync first.** The rolling branch sits at the cutover commit `94223af206b` while `main` has
moved to `07390535860`. Run `upstream-sync-fork-main` *before* the ESM batch, while both sides are
still CJS. Every fork PR merged to `main` after ESM lands on rolling is authored in CJS import style
and will need adaptation on arrival, so front-loading buys one clean sync.

**Batch shape** — override the default plan so the ESM commit is alone:

| Batch | Commits | Rationale |
| --- | --- | --- |
| A | 1–2 (`CropAspectRatio` enum, github-actions) | trivial; proves the machinery on a fresh rolling branch |
| B | **3 alone** (immich-31237, ESM) | isolated so every conflict is attributable to it |
| C | 4–20 (through immich-31537, imports linting) | pairs the lint gate with the style it enforces |
| D | 21–32 (incl. people-merge, cloud ids) | normal-sized tail |

Isolating B matters because a gate chain hides its own tail: an early throw skips the post-apply
checks, so a batch mixing ESM with seventeen other commits makes a first failure unattributable.

## Section 2 — The mechanical import resolver

155 of the 219 conflict regions are import blocks. A resolver handles exactly those and refuses
everything else.

It **parses import statements; it never regexes conflict markers** — regex over markers deletes
content. For a region where both sides are import-only it takes the union of `(module, imported name)`
pairs, normalizes each module specifier to upstream's ESM form (`.js` suffix, `type` qualifier where
upstream uses one), and emits a single block. `eslint --fix` then applies `import-x/order`, and
prettier formats.

Two properties make it trustworthy:

1. **Proven both ways before first use.** It must reproduce known-good resolutions from the spike
   tree, *and* must refuse a synthetic region where a specifier would be dropped. A resolver proven
   only green is the Shape-K trap in miniature.
2. **Per-file post-condition, asserted not spot-checked.** Every specifier present on either side is
   present in the result, and `tsc` resolves every specifier.

Humans resolve the 64 semantic regions.

## Section 3 — Fork-side ESM adaptation

This section covers the changes no gate in the pipeline can see.

### The migration provider (highest severity)

Upstream's ESM commit changed its migration loader **twice**:

```diff
       provider: new FileMigrationProvider({
         fs: { readdir },
         path: { join },
-        // eslint-disable-next-line unicorn/prefer-module
-        migrationFolder: join(__dirname, '..', 'schema/migrations'),
+        import: (filePath) => import(filePath),
+        migrationFolder: join(import.meta.dirname, '..', 'schema/migrations'),
       }),
```

`__dirname` does not exist under `"type": "module"`, and Kysely's `FileMigrationProvider` needs the
explicit `import:` hook to load migration modules as ESM.

The fork **replaced that entire call site** with `CompositeMigrationProvider`
(`server/src/schema/composite-migration-provider.ts`, fork-only, which upstream never touches) and
therefore inherits **neither** change. Its call site in `database.repository.ts` still uses
`__dirname` twice, behind `// eslint-disable-next-line unicorn/prefer-module` comments that suppress
the one rule that would have flagged it.

Consequence: **no conflict, no type error, lint green — and the server cannot load migrations at
boot.** It takes out the dual-directory migration architecture that the whole `migrations-gallery`
design rests on. Both fixes must be applied by hand: the `import:` hook inside
`CompositeMigrationProvider`'s `FileMigrationProvider` construction, and `import.meta.dirname` at the
call site.

**Neither fix can be staged ahead of batch B.** The `import` prop is new in Kysely 0.29 — verified
against the installed 0.28.17 typings, whose `FileMigrationProviderProps` declares only `fs`, `path`
and `migrationFolder`. It does not type-check until the bump lands, which is precisely why upstream
ships the Kysely bump inside the ESM commit.

### The rest of the fork-side set

The same shape repeats wherever the fork extended upstream's migration-path handling to cover
`migrations-gallery`, because each extension duplicated a `__dirname` that upstream is now converting:

- `cli.service.ts:26` — the fork widened upstream's single-folder read into
  `[join(__dirname, '../schema/migrations'), join(__dirname, '../schema/migrations-gallery')]`, so it
  carries **two** `__dirname` uses where upstream's converted line has one
- `config.repository.ts:175` (helmet path) — adopt upstream's `import.meta.dirname` form, preserving
  the fork delta in that file
- `server/src/schema/revert-to-immich.spec.ts` (fork-only) — `__dirname` → `import.meta.dirname`
- `server/src/schema/sync-gallery-migrations.spec.ts` (fork-only) — the one fork-only file using
  `module.exports`; must move to ESM export form

The bulk conversion:

- **293 fork-only server files** — codemod `.js` suffixes and `type` qualifiers. Verified tractable:
  zero relative imports, zero `lodash`, zero `require(`. The only CJS globals among them are the two
  files named directly above
- **102 fork-only e2e files** — the ESM commit applies the identical `.js`-suffix treatment to `e2e/`
  (63 files), so fork-only e2e specs need the same codemod. This is the surface `cd e2e && pnpm check`
  gates
- **Build pipeline** — build becomes `nest build && tsc-alias`, then the fork's
  `postbuild: node bin/sync-gallery-migrations.mjs`. Assert that the hook still fires after
  `tsc-alias`, that gallery migrations copied into `dist/schema/migrations` are alias-rewritten, and
  that **both** entries in `compatibilityAliases` are still emitted
- **`pnpm-workspace.yaml`** — union resolution: keep the fork's `injectWorkspacePackages: true` and
  `dedupePeerDependents: false`, add upstream's `unrs-resolver: false`. The lockfile invariant
  `grep -c 'version: file:' pnpm-lock.yaml` must stay **0**

## Section 4 — People-merge, inert adoption

`7b51c50a96c` — `feat: people merge improvements (immich-31456)` adds `POST /people/merge` →
`mergePeople(auth, { ids })` and deprecates the old per-id route as `mergePersonLegacy`. Its
documented behaviour is *"also automatically merges people for other users in the cluster group"*,
and its implementation buckets `peopleMap[personGroupId]` then iterates `targetPeople[ownerId]` — it
assumes one `personGroupId` maps to many person rows across owners.

Gallery adopted cluster groups as **inert** (Option M, decided 2026-08-21): a unique index
`person_personGroupId_key` enforces 1:1, and `ClusterGroupController` is deliberately not mounted.
Upstream's multi-owner arm is therefore unreachable here by construction. It also collides with the
fork's own cross-owner path, `mergeScopedPeople` + `crossOwnerMergeAuthorizer`, which requires an
explicit `confirmCrossOwner` where upstream's merges silently.

**Decision (2026-09-14): adopt inert, consistent with Option M.**

- Take upstream's `mergePeople`, `mergePersonLegacy` and the new route
- Keep `mergeScopedPeople` + `crossOwnerMergeAuthorizer` as the fork's cross-owner path
- **Prove** the multi-owner arm unreachable rather than assuming it, with cases written **inside
  upstream's own `describe`** so a later rebase resolving toward upstream cannot silently drop them
- Add a `ci-invariants-check` entry — same pattern as `search-v3-not-dispatched` — asserting the 1:1
  index exists and `ClusterGroupController` stays unmounted
- Regenerate OpenAPI; web and mobile keep the legacy route unless migrated deliberately

## Section 5 — Validation and gates

Local, cheapest-first: `pnpm build` → `pnpm check` → `check:typescript` / `check:svelte` → both unit
suites → `tools/upstream-preflight` vitest → mobile `analyze` / `format` / `test` → `make sql`
(repositories change, so it is required this cycle) → `make open-api`. Plus `.github` prettier and
`cd e2e && pnpm check`, each of which is its own gate.

Three dependency majors ride along. The unit suites cover **Vitest 4**. **Kysely 0.29** is exercised
only against a real database, so **medium tests are mandatory this cycle**, not optional. **NestJS 12**
shows up at bootstrap.

Because the migration-provider break is boot-time only, a boot test is the sole thing that catches it:
`docker.yml`, the Docker-boot half of `gallery-revert-to-immich-validation`, and an **RC on the
personal instance** before this cycle is called done. Remote dispatch staggered ~30s to stay under the
container registry rate limit.

## Out of scope

- Landing on `main`. That is governed by the standing rule and is not part of this design.
- Migrating web or mobile clients onto the new `POST /people/merge` route.
- Reversing the cluster-groups decision.
- Propagating ESM style to `web/`, `mobile/` or `machine-learning/` — immich-31237 touches only
  `server/`, `e2e/`, `packages/` and the lockfile, so those three are unaffected. (`e2e/` **is** in
  scope; see Section 3.)

## Artifacts

- Spike worktree `.worktrees/spike-esm` (branch `spike/esm-31237`) holds the in-progress merge whose
  resolved tree serves as an oracle for the end state. Throwaway; delete once the cycle lands.
