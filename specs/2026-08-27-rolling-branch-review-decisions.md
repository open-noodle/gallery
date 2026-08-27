# Rolling branch review — decisions and fixes

**Date:** 2026-08-27. **Branch reviewed:** `rebase/upstream-rolling-v3.1.1` @ `ab50d5ab716`, level
with `upstream/main` `093f5c070ad`, forked from `origin/main` `a5626f3d9b9` (old base `8aa95c67470`).

This records what a full multi-agent review of the rolling rebase branch found, what we decided to
do about it, and why. The raw findings (58 defects, ~95 cannot-fail tests and coverage gaps) are a
working artifact kept outside the repo deliberately — a wishlist rots. What is durable, and what is
here, is the decisions and the traps worth remembering.

## How it was reviewed, and how much to trust it

Three waves, 18 agents plus one follow-up experiment: Wave 0 audited the option-M person re-key
(`person.id` → composite `(ownerId, personGroupId)`, upstream immich-30739); Waves 1–2 did a per-surface
replay-fidelity interdiff, a zero-conflict shape hunt, and a coverage pass over the rest of the fork.

**Findings are single-sourced.** The adversarial refutation wave was cancelled. One finding was later
challenged and put to a dedicated skeptic (see "pet faces" below) — that one is twice-sourced;
nothing else is. Where a finding below says CONFIRMED, evidence is quoted at `file:line`; treat
anything without that as weaker than it reads.

**Two facts about the evidence base that mislead if you don't know them:**

- **CI results for this branch must be queried by head SHA.** The tip is pushed as
  `refs/heads/rebase/upstream-batch-170`; `origin/rebase/upstream-rolling-v3.1.1` is a divergent
  `58a1ca590ec`, and querying by that name serves 2026-08-19 runs. The real 10/10 green set is on
  `80154b8eb93`.
- **Nobody can measure line coverage on this fork.** `pnpm test:cov` crashes —
  `server/package.json:159` pins `@vitest/coverage-v8: ^4.0.0` against `vitest: ^3.0.0` at `:177`,
  and the v8 provider imports `BaseCoverageProvider` from `vitest/node`, which vitest 3.2.7 does not
  export. Identical upstream, used by no CI job. Every coverage conclusion in this review rests on
  reading code, never on a report.

## Scope rule

**Rebase regressions and CI-gate fixes land on the branch. Pre-existing fork bugs become issues
against `main`.** The branch has to survive review as a rebase; mixing substantial new fork work into
it makes the cutover diff unreadable. The one exception taken deliberately is the AGPL attribution
fix, which is pre-existing but touches neither the branch nor its diff.

---

# Part 1 — The durable discoveries

These outlive this cycle and are the reason the review was worth running.

## Five gates do not gate what they appear to

Each looks green and proves nothing. Together they are why several defects below survived a 10/10 CI
run. **A gate that does not cover what it appears to is itself a finding** — that rule found four of
these five.

| Gate                                                                  | Why it is inert                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations:generate` schema drift (`.github/workflows/test.yml:797`) | Runs `pnpm --filter migrations:generate` — `--filter` selects **packages, not scripts**, and no package has that name (`server/package.json` is `"immich"`). pnpm errors "No projects matched the filters", `continue-on-error: true` swallows it, `verify-changed-files` sees no diff, job passes. This is the gate that was the _only_ thing to catch the face-review table definitions during the option-M landing. |
| Migration ORDER append-only (`migration-order.yml:25`)                | `BASE_SHA` comes from `github.event.before`, which exists only on **push**. On `workflow_dispatch` — the only mode a branch off `main` can use — it is empty, `actions/checkout` falls back to the triggering ref, and `verify-order --append-only-from` compares ORDER against a copy of itself. The workflow has also **never executed anywhere**.                                                                   |
| `upstream-preflight` job (`test.yml:58-64`)                           | Path filter watches 3 paths; the specs actually read **8** (`web/src`, `mobile/lib`, `sync-gallery-migrations.mjs`, both migration dirs, `CLAUDE.md`, two scripts). A PR reverting the branded-spinner files or deleting the `compatibilityAliases` entry runs with the job **skipped** — indistinguishable from passing.                                                                                              |
| `make ci-invariants-check`                                            | Run by **no workflow**; fires only when a human types it. Worse, `readInvariantSourceFiles` (`ci-invariants.ts:69-82`) returns `[]` for a path that no longer exists, so a relocated file makes its invariant **pass with zero files checked**.                                                                                                                                                                        |
| `pnpm … test <file>` (`test.yml:733`)                                 | Resolves through `vitest --run --passWithNoTests`. Rename or move the spec and the filter matches nothing, vitest exits 0, the step goes green.                                                                                                                                                                                                                                                                        |

## Three detectors worth keeping

- **`git ls-tree` set algebra: fork-deleted paths ∩ files present in HEAD.** Catches Shape I — the
  fork deletes a file, upstream later writes one at that path, the replay resolves toward upstream and
  no gate notices. Found `packages/scripts/package.json`, and in _deletion_ form the `cache_from`
  block: when the fork's rule **is** a deletion, upstream re-adding it produces zero conflict.
- **Grep for zero-producer test-ids before trusting a negative assertion.** A dozen "the removed UI is
  gone" assertions query test-ids that exist nowhere in the codebase, so they are true under every
  implementation.
- **After a re-key, grep JSONB columns whose element shape carries the renamed key.** A column rename
  does not touch a blob's interior, and every schema gate is blind to it. This is the mechanism behind
  the face-cleanup defect below.

## What was verified clean — do not re-audit

The option-M re-key itself is sound. Three independently built live databases (fresh install,
Immich→Gallery, existing-Gallery upgrade) produce **byte-identical schemas** with `migrations:generate`
reporting no drift on each, and 154 identical `migration_overrides` rows. The rename is clean across
**4,337 SQL regions** (692 person/face), alias-resolved against all 98 tables and corroborated by a
live `information_schema` sweep. The `shared_space_person` substring trap held — zero over-renames,
223 surviving `shared_space_person_face."personId"` references. `requireAccess` per-file counts show
**zero drops** against both `origin/main` and `upstream/main`. 687 `@GenerateSql` queries execute with
no `GROUP BY` failure under the new composite PK. Amputation and dormancy invariants hold 36/37, and
the mobile Drift relocation kept every shared-space foreign key.

---

# Part 2 — Decisions

Each entry: what is wrong, where, what we decided, and how you would know it worked.

## Face-cleanup console renders empty after upgrade — clear the scan, do not rewrite it

**Mechanism.** `face_repair_scan.persons` is a JSONB snapshot whose element shape is not a column, so
`1791000000000-RepointFaceReviewToPersonGroup` — which renames the three face-review **columns** —
never touched it. The option-M landing renamed the key _inside_ the blob from `personId` to
`personGroupId`, and every reader crosses DB→TS through `as unknown as RepairScanPerson[]`, so `tsc`
cannot see the mismatch. On an upgraded instance the id list binds `NULL`, flagged counts come back
empty, `.filter(p => p.flagged > 0)` (`face-repair.service.ts:692`) drops every row, and
`/admin/face-cleanup` renders its header and totals with **zero person rows**. No error, no log.

**This is live for users.** `face-repair-scan.repository.ts` first appears in tag **v5.4.0** (absent
in v5.3.1) and its `RepairScanPerson` declares `personId: string`, so every v5.4.0+ instance that ran
a scan holds a pre-M blob.

**Decision — delete the stale scans; do not rewrite the blob.** One fork migration:

```sql
DELETE FROM face_repair_scan WHERE jsonb_path_exists(persons, '$[*].personId');
```

`jsonb_path_exists(x, p)` is the function form of `x @? p` — "does any array element carry a
`personId` key?" — chosen over the operator because the fork has no jsonpath precedent in its
migrations and the function form avoids a literal `?`. Verified: `persons` is
`@Column({ type: 'jsonb', default: '[]' })` typed `RepairScanPerson[]`, so it is a top-level array
(`$[*]` is right) and non-nullable. PG floor is 14; jsonpath needs 12.

**Why clearing beats rewriting.** A rewrite fixes only the key we happened to notice and assumes the
rest of the persisted shape is unchanged between v5.4.0 and now. Clearing sidesteps every shape
question at once. Nothing of value is lost: `face_repair_decline` — the admin's persisted "leave it"
decisions — has **no `scanId` reference at all** (FKs are `asset_face`, `person_group`, `user`), and
neither does `face_person_verdict`; the only cascade is `face_repair_scan_flagged_face`
(`onDelete: 'CASCADE'`), which its own table comment calls "a point-in-time scan snapshot". And the
resulting state is not novel: `getLatestScanStatus` returns `null` with no scan
(`face-repair.service.ts:613-615`) — exactly what a fresh install shows. The predicate targets only
pre-M blobs, so the migration is precise and safe to re-run.

**Verification.** A medium spec that inserts a pre-M blob, proves `getLatestScanStatus().persons` is
empty **first**, then proves the migration clears the row. Plus a release-note line: an admin who had
run a scan will otherwise find the console reset with no explanation.

## `AssetShare` → `AssetUpdate` swap silently widened permissions — say "owner only" explicitly

**Mechanism.** Upstream `immich-28950` repurposed `Permission.AssetUpdate` as the owner-only gate for
adding assets to memories and tags — owner-only _in upstream's vocabulary_ — and shipped
`1787148183730-DeleteMismatchedMemoryAssets`, which deletes every `memory_asset` row where
`memory."ownerId" != asset."ownerId"`. **The fork defines `AssetUpdate` as owner ∪ space editor**
(`utils/access.ts:159-163`; `checkSpaceEditAccess` returns assets owned by _anyone_ in a space where
the caller is editor/owner, `access.repository.ts:492-530`). Adopting the constant inverted the
intent: the fork now permits exactly the rows upstream's migration purges. Zero conflicts — upstream
changed one word in one file, and the fork's definition of that word lives in a file that did not
change. Both files are correct in isolation.

Sites: `memory.service.ts:311` (create), `:355` (addAssets), `tag.service.ts:119`. `AlbumService` is
unaffected — upstream pinned `AssetShare` there and the branch matches.

**Consequence.** A space editor can pin another member's asset into their own private memory. After
they are removed from the space, `MemoryService.get` (`:299-303`) re-checks only `MemoryRead` and
returns `mapMemory(...)` with **no per-asset filter** — unlike `search` (`:256-262`), which filters by
`AssetView` — so the asset's metadata is still served. Media bytes stay gated. Reach is SDK-only
today: no web or mobile code calls those routes.

**Decision — express owner-only in the fork's own vocabulary at those three sites**, rather than
reverting to `AssetShare`. Reverting would also undo upstream's deliberate removal of partner access
on the same paths. The current state is a trap: a constant that means one thing upstream and another
here will keep silently changing behaviour every time upstream touches it.

**Verification.** A test where a space editor is refused on all three routes, and the owner allowed.

## `GET /asset-files/:id/download` returns 400 for every S3-stored file

**Mechanism.** Upstream `immich-25900` added an endpoint building an `ImmichFileResponse` straight
from `asset_file.path` (`asset-file.service.ts:36-46`). `sendFile` accepts only absolute paths —
`utils/file.ts:152-155` throws 400 when `resolve(path) !== path` — and the fork encodes S3 objects as
**relative keys** by construction (`storage-backend.provider.ts:9-13`;
`media.service.ts:82-96,103-111` writes the relative key into `asset_file.path`). Every other fork
file-serving surface routes through `BaseService.serveFromBackend` (7 sites). This one does not.

Latent: the only caller is the SDK's `downloadAssetFile`; no first-party client uses it, and
`asset-file.service.ts` has no spec at any layer. CI has no S3 backend, so nothing there can see it.

**Decision — route it through the backend** like every sibling:
`return this.serveFromBackend(file.path, mimeTypes.lookup(file.path), CacheControl.PrivateWithCache, fileName)`.

## Three user-visible regressions on fork-only surfaces

**"Open in app" banner is dead on every memory URL.** Upstream `immich-28675` moved the viewer from
`/memory?id=` to `/memories/<id>`; the fork adopted it (`route.ts:116-119`), but the **fork-only**
deep-link table at `utils/open-in-app.ts:3-14` still matches `^/memory/(UUID)$`. Upstream has never
seen that file, so zero conflicts. `pathToDeepLink` returns null for every real memory path and the
globally-mounted banner renders nothing on mobile web. Its spec passes 39/39 because it pins the
**retired** paths. Decision: add `^/memories/(UUID)$` and `^/memories$`, keeping the old entries
(the 307 shim still resolves). Note the mobile half is separately incomplete —
`deep_link.service.dart:97` handles only `path == "/memory"` and discards `?id=`.

**The Space success toast renders a raw ICU plural string.** `collection_picker.widget.dart:126` was
rewritten from the fork's `.t(...)` helper to easy_localization's `.tr(namedArgs:)`. They are not
equivalent for ICU: the helper ran `MessageFormat(translated).format(args)`; `.tr` does
`res.replaceAll(RegExp('{count}'), value)`, which never matches inside
`{count, plural, one {…} other {…}}` — so there is no plural selection _and no substitution_. Both
keys are ICU plurals (`i18n/en.json:54`, `:3069`). Picking a Space or space album as the target shows
literally `Added {count, plural, one {# asset} other {# assets}} to space`. All 115 ICU keys were
swept against every `.tr(` site in `mobile/lib` and `mobile/test`: **one hit, this one.** Decision:
route through the generated accessor, as `space_album_detail.page.dart` already does.

**Space bottom sheets render menu rows in the action row, and Share's long-press is dead.**
`space_bottom_sheet.widget.dart:58,59,61` and `space_album_bottom_sheet.widget.dart:75,76,77` wrap
AssetDebug/Share/Download in `ActionMenuItem` — a left-aligned vertical-menu row
(`menu_item.dart:88-98`) built for a kebab menu — while the other actions stay `ActionColumnButton`
tiles, all inside `BaseBottomSheet`'s horizontal `Row`. Every other bottom sheet uses
`ActionColumnButton` exclusively. Functionally, `ActionMenuItem` is the one `ActionWidget` subclass
that never wires `onSecondaryAction` (`action.widget.dart:69-70`), and `ShareAction` is the only
action defining one (`share.action.dart:35`, the share-quality prompt) — so an affordance that worked
on `origin/main` is gone. Decision: all six sites to `ActionColumnButton`, and extend
`space_bottom_sheet_share_link_test.dart:68`'s predicate style to cover Share and Download.

## Two things the replay resurrected

**`packages/scripts/package.json`.** The fork deleted the whole tree in `bc06e84a1f4` ("drop upstream immich-29331 release-version tooling"). Upstream's Renovate commit `aa6e4d9173f` touched that file this
cycle, the replay resolved the delete/modify conflict toward upstream, and the file came back
**alone** — declaring `"main": "pump-wrapper.ts"` and build/check/lint/test scripts with no source on
disk, plus a `pnpm-lock.yaml:393` importer pulling six dependencies `origin/main` does not have.
`fix-format.yml:30` reaches it via `pnpm --recursive` (label-gated, so small blast radius). The real
cost is forward: the workspace now claims upstream's release tooling exists, so **the next upstream
batch adding files there applies cleanly instead of conflicting**. Decision: `git rm` and regenerate
the lockfile; add a fork-deletion invariant so the next Renovate-shaped commit re-conflicts.

**`e2e/docker-compose.yml`'s `cache_from` block.** Fork PR #171 (`dec80cb19e9`) deleted it; upstream
re-created it this cycle (`47dccf72834`, `24532c4d821`) and the replay took upstream's version.
Because the fork's rule **is a deletion**, re-adding produced zero conflict. Both
`ghcr.io/immich-app/immich-server-build-cache` tags at `:18-21` probe as **HTTP 404**, so today the
cost is two failed registry calls per build — BuildKit warns and continues, which is why CI is green.
The hazard is the class fork rule #218 exists to prevent: if upstream ever publishes a cache whose tag
hash matches, the fork's e2e image silently imports upstream-built layers. Decision: re-delete lines
18-21. (HEAD also restored an adjacent `args:` block `origin/main` had dropped; that half is
upstream's own e2e build metadata and is harmless.)

## `mobile/analysis_options.yaml` — take upstream's, and record that we did

The replay adopted upstream's rewritten file byte-identical, re-enabling
`always_put_control_body_on_new_line` (`:68`, `:102`) which the fork had dropped in `29abec9b878`
("align analysis with rebased sync models" — a pragmatic removal to make rebased code pass, not a
style position). All current mobile code complies, so CI is green; the only cost is forward.

**Decision — keep upstream's file, and let THIS document be the record.** Matching upstream
byte-for-byte on a config file is the cheapest thing to maintain. Note the trap in recording it
anywhere else: a marker comment inside `mobile/analysis_options.yaml` would break the very
byte-identity that converging buys, and `docs/fork/ownership.yml` has no "deliberately converged"
concept to extend without inventing manifest structure the tooling does not read. So the file
carries no marker on purpose. **If you are diffing `analysis_options.yaml` against `origin/main` in
a future cycle and find those two lines: this is why, and it was intentional.** **This is the exception, not the rule**: for the fork's
deliberate _swaps_ — the branded-spinner set above all — byte-identical-to-upstream is the failure
mode, not the goal.

## The Flutter pin in the fork's own docs is wrong

`AGENTS.md:171` (symlinked as `CLAUDE.md`) says "use Flutter **3.44.9** — the pin lives in
`mobile/mise.toml` … corroborated by `mobile/pubspec.yaml`". The real pin at the tip is **3.47.1** in
both files, and the quoted TOML syntax is outdated (`mise.toml` now uses a
`[tools."aqua:flutter/flutter"]` table). 3.47.1 arrived from upstream already at the new base, while
a branch-only docs commit edited that line 3.44.8→3.44.9 independently — so the doc that _quotes_ the
pin drifted from the pin in the same cycle. The line explicitly invites trust and warns "it has gone
stale before", which makes it worse than silence. Decision: correct both occurrences and the syntax.

## AGPL attribution is destroyed on every docs deploy — fix on `main`

**Mechanism.** `branding/scripts/apply-branding.sh:917` runs a catch-all `s/Immich/${NAME}/g` over
`docs/docusaurus.config.js`. Reproduced by running the real `sed` with the real brand name on a
scratch copy:

```
copyright: `Gallery is a fork of Noodle Gallery, available … under the terms of the GNU AGPL v3 License.`
label: 'Noodle Gallery'       →  href: https://immich.app
label: 'Noodle Gallery Docs'  →  href: https://docs.immich.app
```

Source: `docusaurus.config.js:165`, `:169`, `:175`. `docs-deploy.yml:126` runs branding, so this ships
on every deploy: the credit the AGPL requires names the fork instead of the upstream project, and both
"Upstream" footer links are relabelled while still pointing at Immich.

The guard cannot catch it — `verify-branding.sh:52-56` fails **only if** `Immich` is still present, so
it passes _because_ the substitution happened. The check and the bug agree with each other.

**Decision — fix now on `main` as its own PR**, despite being pre-existing: it is a licence obligation
currently unmet on a public site, it is about ten lines, and it touches neither the rebase branch nor
its diff. Shield the three strings from the catch-all and change the check to a **positive**
assertion — after branding the copyright must still read "a fork of Immich" and the Upstream labels
must still be `Immich` / `Immich Docs`, mirroring the hardening already applied to the
AppDownloadModal check at `verify-branding.sh:246-259`.

## Pet faces destroyed by human face detection — skip, fixed on `feat/pet-recognition`

Recorded because the mechanism is worth knowing and because the decision was to **not** act here.

Pet faces are created with no `sourceType` (`pet-detection.service.ts:93-95`) so they take the column
default `SourceType.MachineLearning` (`asset-face.table.ts:76`). `handleDetectFaces` sweeps every ML
face on the asset (`person.service.ts:961`) and hard-deletes what the human detector does not match
(`person.repository.ts:1272-1274`); `getAllWithoutFaces` has no `type` filter, so the emptied pet
person is hard-deleted too (`:368-373`). Irreversible: pet re-detection is gated on `petsDetectedAt`,
and even a forced re-run recreates the person as `name: pet.label` — a pet named "Rex" returns as
"dog", birthDate and thumbnail lost.

This finding was **challenged and put to an adversarial verifier briefed to refute it**; every
refutation hypothesis failed. The trigger, however, was **overstated** in the original report: the
concurrent job fan-out at upload is order-dependent, because `handleDetectFaces` snapshots
`asset.faces` on entry. The deterministic path is any _subsequent_ detection run on an asset that
already has pet faces.

`feat/pet-recognition` already fixes it at `person.service.ts:937-940`, where the code comment names
the defect as **F4**, and additionally blocks a second path this review had missed (a human box
IoU-matching a pet face and overwriting it with a human embedding).

**Decision — skip.** No extraction, no separate issue; the fix lands with that branch. Accepted
consequence: the defect stays live on `main` until it merges.

---

# Part 3 — What became issues

Per the scope rule, these pre-existing fork bugs were filed against `main` rather than fixed here.
Each issue is self-contained; this list exists so the set is auditable, not to duplicate them.

- Space People page: duplicate-key grid wedge and a silent person skip (the `appendUniqueById` helper
  the #847 fix added is not used on that page), plus two more paginated lists appending without dedupe.
- An unknown `SyncEntityType` from a newer server aborts the whole mobile sync stream — a `!` on a
  decoder that deliberately returns null so old clients survive new enum values.
- A failing sync batch withholds its ack (correct) but unwinds the pass (not), so the poison batch is
  redelivered forever while the app reports success.
- `removeAutoTagAssignments` un-archives every asset holding a tag, keyed by tag value rather than
  owner — ignoring the category's action, other archiving categories, and manual archives.
- Storage rollback after `deleteSource: true` reports `{failed: 0}` while pointing every asset at a
  deleted path; `deleteSource` is not recorded in the migration log at all.
- Reverting to Immich orphans every S3-backed asset and drops `storage_migration_log`, the only ledger
  mapping keys back to disk — while the guide states assets are preserved.
- 63 files carry branded output committed to source, against `CLAUDE.md`'s rule; `Noodle Gallery` is
  the leak signal, plain `Gallery` is a false positive.
- 16 branding rewrite rules match nothing (two never worked); three brand source assets are missing,
  so 17 copy destinations silently no-op and survive only because branded PNGs are committed.
- S3 is gated on no PR — both S3 workflows are `schedule` + `workflow_dispatch` only — and
  `s3-storage.backend.integration.spec.ts` gates on an env var set nowhere in the repo, so it never
  runs anywhere.

**Not filed and not fixed:** roughly 95 cannot-fail tests and coverage gaps. They are real, but a
standing wishlist rots; pick them up alongside the code they cover.
