# Upstream Sync Report — action-model adoption + `use_build_context_synchronously`

Releases the batch-27 quarantine recorded in `2026-07-31-upstream-sync-batches-22-26.md`. Brings
`rebase/upstream-rolling-v3.1.1` **level with `upstream/main`**.

## Summary

- **Branch tip**: `73782daca4f`
- **Upstream base**: `56ce7176b1d` → **`483b375c26c`**; `git log HEAD..upstream/main` = **0**
- **Upstream commits pulled**: 9 (the 2 quarantined + the 7 held behind them)
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED — 10/10 CI green, final whole-arc review approved for merge

Executed as a spec → plan → subagent-driven arc:
`docs/superpowers/specs/2026-07-31-mobile-action-model-adoption-design.md`,
`docs/superpowers/plans/2026-07-31-mobile-action-model-adoption.md`.

## Why these two were quarantined

| Commit        | What it does                                                                   |
| ------------- | ------------------------------------------------------------------------------ |
| `405020eeeed` | enables `use_build_context_synchronously` and fixes 59 upstream files (#30367) |
| `fe5c8ed0fb8` | refactors the action layer into `ActionBuilder`/`ActionItem` (#29617)          |

Both touch fork-extended surfaces. They also sat at **positions 4–5 of 12**, so everything after
them — including the js-yaml v5 **security** bumps (#30440/#30441) and the fourth codegen-removal
commit (#30426) — was blocked until they were resolved.

## The lint: 34 fork sites, none of them live bugs

159 violations appear with the rule on, but **125 are in the 56 files upstream's own commit fixes**.
The fork sweep was 34 sites in 4 files. They were not missing guards — the fork guarded
`State.context` uses with `context.mounted` where the analyzer requires the State's own `mounted`:

> …guarded by an **unrelated** 'mounted' check. Guard a 'State.context' use with a 'mounted' check
> **on the State**…

Fixed per-site, not by bulk replace, because three cases need different answers: a `State` subclass
takes `mounted`; a `StatelessWidget` has no `mounted` and keeps `context.mounted`; and a use of a
_different_ `BuildContext` (a sheet or dialog builder's `ctx`) must be guarded on that context.
Commit `9f04fe8ec69` — 20 code sites / 36 diagnostics, including 2 fork-only sites in `login_form.dart`
that upstream's fix could not have covered.

**Four of the changes were additive** — a guard where none existed. Two of those sit on fork feature
**#643** ("view in timeline" from a memory). The final review cleared them empirically: a probe showed
`Navigator.maybePop` returns while the exit transition is still running, so `context.mounted` is still
`true` after it and the guards never fire. #643 is intact.

## The refactor: a gradual migration, and one constraint that mattered

`base_action_button.widget.dart` survives; upstream migrated only its own `favorite`/`unfavorite`.
The fork's two buttons were **not** forced to move. They were ported anyway, to avoid a second
migration when upstream eventually deletes the old base.

### Removal from a Space is not owner-scoped — and now it is pinned

`ActionNotifier.removeFromSpace` uses `_getRemoteIdsForSource`, **not** `_getOwnedRemoteIdsForSource`:
removing an asset from a Space is not deleting it, so an editor may remove another member's photo.

Upstream's template (`favorite.action.dart`) derives from `ownedAssetsActionProvider`. **Copying it
naively would have made removal owner-only and broken editors in a multi-owner space, with a green
suite.** The port derives from `assetsActionProvider(source).remote()` instead.

It is now defended at two layers, each verified by mutation:

| Layer      | Mutation applied                                         | Result                |
| ---------- | -------------------------------------------------------- | --------------------- |
| Visibility | `assetsActionProvider` → `ownedAssetsActionProvider`     | visibility test FAILS |
| Payload    | `_getRemoteIdsForSource` → `_getOwnedRemoteIdsForSource` | id-capture test FAILS |

The payload test wires the **real** `ActionNotifier` over a mocked service, so it pins the actual
id-selection path rather than restating the action's own code.

### A real bug the review caught

The ported action initially passed the raw i18n key `'scaffold_body_error_occurred'` to the toast
service — users would have seen the literal key on failure. The deleted widget had called
`.t(context:)`. Fixed to the sibling idiom `context.t.scaffold_body_error_occurred` and pinned by a
test asserting the rendered translated text.

## Commits

| Commit        | What                                                 |
| ------------- | ---------------------------------------------------- |
| `9f04fe8ec69` | 34-site `use_build_context_synchronously` sweep      |
| `7e3f1e5fe78` | compile fix after the action refactor landed         |
| `187720c49b7` | `RemoveFromSpaceAction` port (TDD)                   |
| `c6e7f348be0` | its review fixes — translated toast + visibility pin |
| `de99aada265` | `SimilarPhotosAction` port (TDD)                     |
| `5c17f2adbc9` | call-site migration; both old widgets deleted        |
| `9fa6943782d` | the 7 held upstream commits landed                   |
| `36a308c185e` | **lockfile regeneration** — see below                |
| `73782daca4f` | final-review test fixes                              |

## The CI failure worth recording

The first full dispatch failed **8 of 10 workflows with one root cause**:

```
[ERR_PNPM_OUTDATED_LOCKFILE] pnpm-lock.yaml is not up to date with <ROOT>/web/package.json
  - svelte (lockfile: 5.56.5, manifest: 5.56.8)
```

An upstream commit bumped the manifest; the rebase resolved `pnpm-lock.yaml` by taking one side
wholesale instead of regenerating.

**Every local gate passed throughout, which is the part worth remembering.** A local `pnpm install`
is not frozen — it silently re-resolved on each run, so the local suites were exercising a lockfile
state that was never committed. The working-tree churn this produced was repeatedly discarded as
"install noise"; the peer-annotation churn genuinely was noise, but the svelte resolution bump inside
it was not.

**The cheap check that reproduces CI in seconds is `pnpm install --frozen-lockfile`.** Run it after
any rebase that touches a dependency manifest, before trusting local green.

The regeneration also cleared latent staleness in `@opentelemetry/*` and `js-yaml` that would have
failed next. Three traps were checked: workspace links stayed at 9 with 0 `file:` injections (the
`injectWorkspacePackages` trap that breaks cold builds), and `@faker-js/faker` did not move (seeded
Playwright UUIDs).

## Verification

**Local**: server build + tsc + lint + 5262 tests; web tsc + svelte-check (571 files, 0 errors) +
4003 tests + eslint 0 errors; mobile `dart analyze --fatal-infos` clean, `dart format` idempotent,
`flutter test` 3006/1; OpenAPI spec not stale. Run twice independently, matching.

**Audits**: fork-owned file survival, extension symbols, Gallery migration count 49, migration
manifest coverage, timestamp collisions, generated-artifact review, CI invariants, `@immich/ui`
patch, Drift schema — all OK.

**Remote**: 10/10 green on `36a308c185e`; `Test` and `Static Code Analysis` re-run green on
`73782daca4f`. `gallery-revert-to-immich-validation` confirmed reaching
`Post-phase drift (0 item(s))` → `validation PASSED` — the sufficient check, not just the coverage grep.

## Follow-ups

1. **Fork feature #643 has no automated coverage** and sits one `mounted`-semantics change away from
   silently losing its scroll-to-date. Highest-value regression test on this branch.
2. `'Remove from space'` and its success message are untranslated. Pre-existing — identical in the
   deleted widget — but `presentation/actions/` is otherwise uniformly `context.t.*`.
3. Two user-visible deltas with no automated coverage: the space bottom sheet's toast moved from
   fluttertoast to Material `SnackBar`, and that button's width went 100 → 90 (now matching siblings).
   Worth one look on a device.
4. The non-idempotent e2e upload retry, carried from earlier arcs, is still open.
