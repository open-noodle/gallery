# Mobile Filter Parity — Slice 7: Retire dead upstream filter UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Spec:** `docs/superpowers/specs/2026-07-07-mobile-filter-parity-design.md` (Slice 7 row; "Architecture → E. Cleanup").

**Goal:** Delete the orphaned pre-fork upstream filter UI and its providers, now that the fork's `filter_sheet/` + `photos_filter/` surfaces (Slices 1–6) fully replace them — but ONLY files with zero live references.

**Architecture:** Deletion-only. The candidate dead cluster (identified during exploration): `mobile/lib/widgets/search/search_filter/` (people/location/camera/media/star pickers) + `mobile/lib/providers/search/people.provider.dart`, `search_filter.provider.dart`, `search_page_state.provider.dart`, and their tests. **Verify zero live references before deleting each** — if anything outside the cluster still imports a file/symbol, KEEP it and report.

**Tech Stack:** Flutter 3.44.1. No new code; deletions + a green test/analyze gate.

## Global Constraints

- Package `package:immich_mobile/...`; Flutter 3.44.1 via `mise exec --`; CI `dart analyze --fatal-infos` over lib AND test.
- **Never delete a file with a live reference** from outside the dead cluster. The dead cluster may import ITSELF (that's fine); the test is references from _other_ live code.
- Do NOT touch any Slice 1–6 code or the fork `filter_sheet/`/`photos_filter/` surfaces.
- Worktree branch `worktree-mobile-filter-parity`. No trailers.

## Baseline

Slices 1–6 complete and pushed; full suite green, analyze clean.

## Tasks

### Task 1: Establish the true dead set (verify references)

**Files:** none modified (investigation).

- [ ] **Step 1: Enumerate candidates.**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/mobile-filter-parity/mobile
ls lib/widgets/search/search_filter/ 2>/dev/null
ls lib/providers/search/ 2>/dev/null
find test -path '*widgets/search/search_filter*' -o -path '*providers/search*' 2>/dev/null
```

- [ ] **Step 2: For EACH candidate lib file, grep for live references** (imports of that file, and uses of its public symbols) from ANYWHERE in `lib/` and `test/` OUTSIDE the dead cluster. For a candidate `lib/widgets/search/search_filter/X.dart`, check its `package:immich_mobile/widgets/search/search_filter/X.dart` import string and its exported class/provider names:

```bash
# example per candidate — repeat for each file + each exported symbol
grep -rn "widgets/search/search_filter/people_picker" lib test | grep -v "lib/widgets/search/search_filter/"
grep -rn "providers/search/search_filter.provider" lib test | grep -v "lib/widgets/search/search_filter/" | grep -v "lib/providers/search/"
grep -rn "getSearchSuggestionsProvider\|searchPageStateProvider\|<other exported symbols>" lib test | grep -v "<the dead cluster dirs>"
```

Build the **confirmed-dead list** = candidates whose only references are from within the dead cluster itself. Record any candidate with an EXTERNAL live reference in the report as "KEPT (still referenced by <file:line>)" and exclude it from deletion. Pay special attention to `providers/search/search_filter.provider.dart` (`getSearchSuggestionsProvider`) and `search_page_state.provider.dart` — a live global-search surface may still use them; if so, keep them.

- [ ] **Step 3: Commit nothing** (investigation only); carry the confirmed-dead list into Task 2.

### Task 2: Delete the confirmed-dead files + their tests

**Files:** delete the confirmed-dead lib files (Task 1) + their test files.

- [ ] **Step 1: Delete** each confirmed-dead lib file and its corresponding test (`git rm`). Include `test/widgets/search/search_filter/*` ONLY for the widgets actually deleted (e.g. if `display_option_picker.dart` is KEPT because it's still referenced, do NOT delete `display_option_picker_test.dart`).

```bash
git rm <confirmed-dead lib files> <their test files>
```

- [ ] **Step 2: Confirm nothing dangles.** Grep again for any now-broken import of a deleted path across `lib/` + `test/`:

```bash
grep -rn "widgets/search/search_filter/\|providers/search/people.provider\|providers/search/search_filter.provider\|providers/search/search_page_state" lib test || echo "no dangling references"
```

Expected: `no dangling references` (or only references among files also being deleted).

- [ ] **Step 3: Analyze — the strongest dead-code proof.**

```bash
mise exec -- dart analyze lib test
```

Expected: `No issues found!` A dangling import or missing symbol would surface here as an error. If analyze reports a broken reference, that file was NOT dead — `git checkout` it, move it to the KEPT list, and re-run.

- [ ] **Step 4: Full test gate.**

```bash
mise exec -- flutter test
```

Expected: **All tests passed!** (the whole suite — a deletion can break a distant test that imported a deleted symbol). If a test fails only because it tested deleted dead code, delete that test too (it covered removed code); if it fails because it used a symbol that turned out to be live, restore the file.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(mobile-filter): remove dead upstream filter UI + providers (slice 7)"
```

---

## Self-Review (completed by plan author)

- **Spec coverage (Slice 7):** delete unreferenced `widgets/search/search_filter/` + its providers — gated on a per-file live-reference check (Task 1) so nothing live is removed. Analyze + full `flutter test` are the safety net (Task 2 Steps 3–4).
- **Placeholder scan:** the candidate list is explicit; the "confirmed-dead" set is computed by grep, not assumed.
- **Risk control:** any candidate with an external reference is KEPT and reported; `dart analyze lib test` + full `flutter test` must be green, which fails loudly on any dangling reference.
- **Out of scope:** no changes to Slices 1–6 or the fork filter surfaces.
