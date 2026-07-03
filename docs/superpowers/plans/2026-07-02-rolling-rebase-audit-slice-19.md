# Slice 19 — LOW[19]/[24] + LOW[18]: delete stale SDK build + (attempt) re-wire orphaned Dart patch

**Spec:** `docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md` §"Slice 19"
**Findings:** `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` LOW#18 / LOW#19 / LOW#24
**Branch / worktree:** `rebase/upstream-rolling-20260509-active`

---

## Step A — ground truth

### A1. `build-old-root` (LOW#19/#24)

`open-api/typescript-sdk/build-old-root/` exists and contains exactly:

```
fetch-client.d.ts  fetch-client.js  fetch-errors.d.ts  fetch-errors.js  index.d.ts  index.js
```

`grep -rn "build-old-root" --include='*.ts' --include='*.js' --include='*.json' --include='*.sh' . | grep -v 'build-old-root/' | grep -v node_modules`
→ **no output**. A broader `grep -rln "build-old-root" . --exclude-dir=node_modules --exclude-dir=.git`
only turns up the audit's own docs (`docs/plans/2026-07-02-rolling-rebase-audit-findings.md`,
`docs/superpowers/plans/2026-07-02-rolling-rebase-audit-slice-12.md`,
`docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md`). Slice 12 already
removed the `apply-branding.sh` `patch_versions` reference to this directory (per this
spec's own note: "this slice only deletes the directory"). Confirmed safe to delete.

### A2. Dart patch (LOW#18)

Patch file exists: `open-api/templates/mobile/serialization/native/native_class_nullable_items_in_arrays.patch`.

`main`'s `open-api/bin/generate-open-api.sh` applies it right after downloading the
upstream openapi-generator template and applying the fork's _other_, larger
`native_class.mustache.patch`:

```sh
cd ./templates/mobile/serialization/native
wget -O native_class.mustache https://raw.githubusercontent.com/OpenAPITools/openapi-generator/$OPENAPI_GENERATOR_VERSION/modules/openapi-generator/src/main/resources/dart2/serialization/native/native_class.mustache
patch --no-backup-if-mismatch -u native_class.mustache <native_class.mustache.patch
patch --no-backup-if-mismatch -u native_class.mustache <native_class_nullable_items_in_arrays.patch
```

i.e. two patches are layered onto the same freshly-downloaded template file, in sequence,
before the `openapi-generator-cli generate -g dart` step. The current (rolling)
`open-api/bin/generate-dart-sdk.sh` does the `wget` + applies `native_class.mustache.patch`
but has no second `patch` line for `native_class_nullable_items_in_arrays.patch` — it was
dropped when upstream rewrote this script (`96d521e149 feat(mobile): add three-state field
serialization (#27231)`). The naive fix is inserting the missing `patch` line right after
the existing one, at the same point in the flow (after `native_class.mustache.patch`,
before `cd ../../` / the `wget api.mustache` step).

### A3. Does the patch still apply? — **NO, it does not apply cleanly**

Dry run against the current tree's `native_class.mustache` (the same file `main`'s script
freshly wgets + patches with `native_class.mustache.patch` before this one; the committed
copy in the tree already reflects that post-`native_class.mustache.patch` state, so it's
the right base to dry-run against):

```
$ patch -p1 --dry-run < open-api/templates/mobile/serialization/native/native_class_nullable_items_in_arrays.patch
patching file 'open-api/templates/mobile/serialization/native/native_class.mustache'
2 out of 3 hunks failed while patching 'open-api/templates/mobile/serialization/native/native_class.mustache'
```

Root cause: `native_class.mustache.patch` — the fork's _other_ template patch, added by
upstream's own `96d521e149` "three-state field serialization (#27231)" work and its
follow-ups — independently rewrote the exact same `isArray` / nullable-items region of the
template to add `vendorExtensions.x-is-optional` branching (the `Optional<T>` wrapper
pattern), and even absorbed a partial, divergent version of the nullable-items cast fix
into ONE of the two branches it introduced. Concretely:

- **Hunk 1** (class field declaration: `List<T>` → `List<T?>` for nullable items) fails
  outright — the line it targets
  (`{{{datatypeWithEnum}}}{{#isNullable}}?...` unconditionally) no longer exists; the
  current template splits field declarations into `{{#required}}` /
  `{{^required}}{{#vendorExtensions.x-is-optional}}` branches with no array-specific
  handling at all in either.
- **Hunk 2** (fromJson `Iterable` cast) applies **only with fuzz**, and even then only
  patches the `{{^vendorExtensions.x-is-optional}}` copy of that logic. The template now
  has a sibling `{{#vendorExtensions.x-is-optional}}` branch (the `Optional.present(...)`
  wrapped variant) with the _exact same unfixed_ `.cast<{{{items.datatype}}}>()` — hunk 2
  does not touch it, so applying the patch as-is would leave the bug half-fixed.
- **Hunk 3** (numeric `.parse()` null-handling) also fails outright against the current
  content.

Confirmed with a scratch copy: `cp` the tracked template to `/tmp`, run `patch -p1
native_class_test.mustache < .../native_class_nullable_items_in_arrays.patch` (no
`--dry-run`, so rejects are written) → `2 out of 3 hunks failed`, `.rej` file shows hunks 1
and 3 rejected verbatim; inspecting the surviving hunk 2's output shows the
`{{#vendorExtensions.x-is-optional}}` branch immediately above the patched line is
untouched and still non-nullable.

**Real-world confirmation this is a live bug, not just a template curiosity:**
`open-api/patch/time_bucket_asset_response_dto.dart.patch` — a _post-generate_ patch
already in the current script — hand-fixes exactly one field of
`TimeBucketAssetResponseDto` (`stack: List<List<String>>? → List<List<String>?>?`) because
the template-level fix is missing. But the OpenAPI spec marks _eight more_ array
properties on that same DTO as having nullable items (`city`, `country`, `duration`,
`latitude`, `livePhotoVideoId`, `longitude`, `projectionType`, `thumbhash` — checked via
the spec's `items.nullable` flags), and the committed generated file
(`mobile/openapi/lib/model/time_bucket_asset_response_dto.dart`) currently declares them
with non-nullable item types, e.g. `List<int> duration;` despite the doc-comment reading
"null for static images". Only `stack` got a manual one-off fix; the rest are silently
wrong today, independent of this slice.

### Decision

Per this slice's explicit stop condition ("If the patch clearly will NOT apply to the
current v3 templates (path/context mismatch), STOP and report rather than adding a broken
patch step"): **do not** add the `patch ... <native_class_nullable_items_in_arrays.patch`
line to `generate-dart-sdk.sh`. `generate-dart-sdk.sh` has `set -euo pipefail`, so a bare
re-insertion of `main`'s line would make `patch` exit non-zero (2/3 hunks reject with no
fuzz) and **abort the entire Dart SDK generation script** on every run — strictly worse
than the current silent-orphan state. A correct fix requires re-authoring the patch's
hunks against the current template (covering both the `vendorExtensions.x-is-optional` and
non-optional branches, and the field-declaration line, which no longer exists in the form
the old patch expects) — out of scope for a mechanical "re-wire" and risky to hand-roll
without running the full Java `openapi-generator-cli` codegen to verify output, which this
slice's method explicitly allows deferring ("if you cannot run the full Java Dart codegen
... say so, and rely on the dry-run + path-match evidence").

This slice therefore implements **only** the LOW#19/#24 deletion. LOW#18 is left as a
documented, evidenced follow-up (not force-fixed).

---

## Step B — RED guard

New file: `tools/upstream-preflight/src/repo-hygiene.spec.ts`, following the
`branding-targets.spec.ts` pattern (repo-root-relative `fs` reads, no build/import
needed).

- Asserts `open-api/typescript-sdk/build-old-root/` does not exist
  (`fs.existsSync(...)` → `false`).

No assertion is added for "`generate-dart-sdk.sh` references the patch" (part (b) of the
originally sketched guard) — see the Decision above; adding a guard that demands a
change we've determined would break the build is not something this slice ships.

**Command:** `cd tools/upstream-preflight && npx vitest run src/repo-hygiene.spec.ts`
**Expected RED:** the directory still exists.

---

## Step C — GREEN

1. `rm -rf open-api/typescript-sdk/build-old-root/` (plain filesystem delete — the
   orchestrator stages the deletion, per mode instructions).
2. Re-run the guard → green.

---

## Edge cases covered

- Deleting `build-old-root/` breaks no import (grep proof above covers `.ts`/`.js`/
  `.json`/`.sh`; the only remaining references are this audit's own docs).
- The Dart patch's applicability was checked with an actual dry-run (not just eyeballing
  paths) against the tree's current template state — it fails, so it is **not** wired in.
  `generate-dart-sdk.sh` is left completely untouched.

## GREEN commands

```
cd tools/upstream-preflight && npx vitest run src/repo-hygiene.spec.ts
```

(File-scoped only per parallel-mode rules — no whole-project `pnpm check`/`pnpm test`.)

## Commit

`chore(open-api): drop stale build-old-root (LOW #19/#24); LOW #18 left unfixed — see report`

(Left uncommitted per orchestrator instructions — this line records the intended message
for the orchestrator's commit. LOW#18 is NOT included in the diff — no Dart-generation
script change was made.)
