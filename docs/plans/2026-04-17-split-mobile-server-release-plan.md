# Split Mobile and Server Release Cycles — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the single release workflow into a mobile phase that submits to Play / TestFlight and a separate server phase the maintainer triggers manually after stores approve, so server users only see the new version once mobile is already live.

**Architecture:** Two manual workflows (`gallery-release-mobile.yml` new, `gallery-release.yml` modified) communicate via a draft GitHub Release that pins version (tag name), commit SHA (`target_commitish`), and APK (asset). Phase 2 builds the server at the draft's pinned SHA — never `HEAD` of main — and promotes the draft. Composite filter `tag matches v*.*.* AND has at least one .apk asset` is used identically by phase 1's dupe guard and phase 2's discovery.

**Tech Stack:** GitHub Actions (workflow YAML, embedded bash), `gh` CLI, fastlane, existing reusable `gallery-build-mobile.yml`.

**Design doc:** `docs/plans/2026-04-17-split-mobile-server-release-design.md` — read first if you have not seen it.

**Working directory:** `.worktrees/split-release-cycle` (already created on `feat/split-release-cycle`).

---

## Pre-flight verification (gates implementation)

The design assumes specific `gh` CLI behavior. If these assumptions fail, the SHA-pinning guarantee breaks and the design needs rework before implementation. Do these BEFORE touching any workflow file.

### Task 0: Verify `gh` draft → tag-creation → publish preserves the SHA

**Why:** The design relies on `gh release create --draft --target <sha>` storing `target_commitish`, then a separate `git tag <vX.Y.Z> <sha>` + push, then `gh release edit --draft=false` binding the published release to that tag. If `gh` ignores `target_commitish` once a tag exists at a different commit, or if `--draft=false` re-resolves the SHA in a way we don't expect, the design's pinning property is broken.

**Where to test:** A throwaway repo, OR the gallery repo with a deliberately invalid version like `v0.0.0-test` that nothing else cares about.

**Step 1: Pick a throwaway repo and a SHA**

Use any repo you control. Capture two SHAs:

```bash
cd /tmp && git clone https://github.com/YOUR_USER/throwaway.git && cd throwaway
SHA_A=$(git rev-parse HEAD)
echo "SHA_A=$SHA_A"
```

**Step 2: Create a draft release pinned to SHA_A**

```bash
gh release create v0.0.0-pinning-test --draft --target "$SHA_A" --title "pinning test" --notes "ignore"
gh release view v0.0.0-pinning-test --json tagName,targetCommitish,isDraft
```

Expected output: `targetCommitish: <SHA_A>`, `isDraft: true`, `tagName: v0.0.0-pinning-test`.

**Step 3: Advance HEAD on the default branch**

```bash
echo "noise" >> README.md && git add README.md && git commit -m "noise" && git push
SHA_B=$(git rev-parse HEAD)
echo "SHA_B=$SHA_B (must differ from SHA_A=$SHA_A)"
```

**Step 4: Create the git tag at SHA_A (NOT SHA_B)**

```bash
git tag v0.0.0-pinning-test "$SHA_A"
git push origin v0.0.0-pinning-test
```

**Step 5: Promote the draft and verify the published release points at SHA_A**

```bash
gh release edit v0.0.0-pinning-test --draft=false --latest
gh release view v0.0.0-pinning-test --json tagName,targetCommitish,isDraft,isLatest
git ls-remote origin "refs/tags/v0.0.0-pinning-test"
```

Expected: `isDraft: false`, `isLatest: true`. The `git ls-remote` output's SHA must be `SHA_A`. The `targetCommitish` should still read `SHA_A` (or the tag name, which resolves to SHA_A — both acceptable). The `--latest` flag during the draft → published transition must set `isLatest: true` cleanly; if gh rejects the flag or silently skips it during the transition, the design needs to move `--latest` into a follow-up `gh release edit` call instead.

**Step 6: Cleanup**

```bash
gh release delete v0.0.0-pinning-test --cleanup-tag --yes
```

**Step 7: Decision**

- If the published release's tag points to `SHA_A` AND `isLatest: true` → design assumptions hold, proceed.
- If the published release's tag points to `SHA_B` (or any non-`SHA_A` commit) → STOP. The design needs rework. Update the design doc with the actual `gh` behavior and revisit handoff mechanism (e.g., switch to a `pending-release` annotated tag).
- If `--latest` didn't take effect during the draft → published transition → note it; the plan's `gh release edit --draft=false --latest` will need to be split into two calls (`--draft=false`, then a separate `--latest`). Minor plan edit, not a design break.

**Step 8: Record the result**

Append a one-line note to the design doc's "Open verification" section:

```bash
cd /home/pierre/dev/gallery/.worktrees/split-release-cycle
# Edit docs/plans/2026-04-17-split-mobile-server-release-design.md, change:
#   - [ ] Confirm gh release create --draft --target <sha> ...
# to:
#   - [x] Confirmed YYYY-MM-DD: gh preserves SHA pinning when tag is created at target_commitish before --draft=false.
git add docs/plans/2026-04-17-split-mobile-server-release-design.md
git commit -m "docs(plans): record gh draft→publish SHA-pinning verification"
```

---

## Implementation

The implementation is one logical PR. Tasks are sequential — each builds on the previous.

### Task 1: Make versionCode retry-safe

**Why:** Today `version_code = $(git -C .. rev-list --count HEAD)` is deterministic per SHA. If phase 1 submits to Play / TestFlight and is then re-run at the same SHA (because draft creation failed, or the maintainer manually re-triggered after a transient error), Google and Apple reject the duplicate versionCode / CFBundleVersion. Add `GITHUB_RUN_ATTEMPT - 1` so first attempt is unchanged, retries get distinct codes.

**Files:**

- Modify: `.github/workflows/gallery-build-mobile.yml` — `Compute build metadata` step (around lines 146–158)

**Step 1: Read the current step**

Open `.github/workflows/gallery-build-mobile.yml` and locate the `Compute build metadata` step.

**Step 2: Replace the version_code line**

Change:

```yaml
version_code=$(git -C .. rev-list --count HEAD)
```

to:

```yaml
# Monotonic per SHA, plus an attempt offset so re-runs at the same SHA
# don't collide with Play Store / TestFlight already-uploaded versionCodes.
# First attempt: unchanged from previous behavior. Retry: +1, +2, ...
base_count=$(git -C .. rev-list --count HEAD)
version_code=$((base_count + GITHUB_RUN_ATTEMPT - 1))
```

Add `GITHUB_RUN_ATTEMPT` to the step's `env:` block (it's an automatic GitHub-provided variable but bash can't see it without the env mapping — actually it IS exported by the runner, no env needed). Verify by inspecting the existing step — if other auto-vars like `GITHUB_RUN_ID` are referenced via env, follow the same pattern; otherwise leave env alone.

**Step 3: Verify YAML is still valid**

```bash
cd /home/pierre/dev/gallery/.worktrees/split-release-cycle
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/gallery-build-mobile.yml'))"
```

Expected: no output (success).

**Step 4: Commit**

```bash
git add .github/workflows/gallery-build-mobile.yml
git commit -m "fix(mobile): make versionCode retry-safe via GITHUB_RUN_ATTEMPT offset"
```

---

### Task 2: Create `gallery-release-mobile.yml` (phase 1)

**Why:** Phase 1 — manual trigger, computes version, builds + submits mobile to Play internal / TestFlight, creates a draft GitHub Release pinning version + SHA + APK.

**Files:**

- Create: `.github/workflows/gallery-release-mobile.yml`
- Reference (do not modify yet): `.github/workflows/gallery-release.yml` — the version-compute logic to lift verbatim is the `version` job, lines 17–143.

**Step 1: Read the source version-compute logic**

```bash
cd /home/pierre/dev/gallery/.worktrees/split-release-cycle
sed -n '17,143p' .github/workflows/gallery-release.yml
```

You will lift the entire `version` job (with its `compute version` step) verbatim into the new file.

**Step 2: Create the file**

Create `.github/workflows/gallery-release-mobile.yml` with this content:

```yaml
name: Release Gallery — Mobile (phase 1)

# Phase 1 of the split release cycle. Builds + submits mobile to Play internal
# track and TestFlight, creates a draft GitHub Release that pins the version
# (tag name), commit SHA (target_commitish), and APK (asset). The maintainer
# then manually promotes the Play internal build to production and submits
# the App Store for review. Once both are live, trigger gallery-release.yml
# to build the server and promote the draft. See
# docs/plans/2026-04-17-split-mobile-server-release-design.md.

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version tag (e.g. v3.0.5) — overrides auto-version'
        required: false
        type: string

concurrency:
  group: gallery-release-mobile
  cancel-in-progress: false

permissions: {}

jobs:
  guard:
    name: Guard against existing draft
    runs-on: ubuntu-latest
    # contents: write is REQUIRED so the token can see draft releases.
    # GitHub returns drafts only to tokens with write permission; contents:
    # read would silently return no drafts and bypass the dupe check.
    permissions:
      contents: write
    steps:
      - name: Require main branch
        env:
          REF: ${{ github.ref_name }}
        run: |
          if [[ "$REF" != "main" ]]; then
            echo "::error::Releases must be triggered from main (got: $REF)"
            exit 1
          fi

      - name: Fail if a release draft with an APK asset is pending
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
        run: |
          set -euo pipefail
          # Composite filter: drafts whose tag matches v*.*.* AND have at least
          # one .apk asset. This is the same predicate phase 2 uses for
          # discovery — what passes the guard is what phase 2 will find.
          pending=$(gh release list --repo "$REPO" --limit 1000 \
            --json tagName,isDraft \
            --jq '[.[] | select(.isDraft == true and (.tagName | test("^v[0-9]+\\.[0-9]+\\.[0-9]+$")))] | .[].tagName')
          matches=""
          for tag in $pending; do
            count=$(gh release view "$tag" --repo "$REPO" --json assets \
              --jq '[.assets[] | select(.name | endswith(".apk"))] | length')
            if [[ "$count" -gt 0 ]]; then
              matches="$matches $tag"
            fi
          done
          matches=$(echo "$matches" | xargs || true)
          if [[ -n "$matches" ]]; then
            echo "::error::Pending mobile release draft(s) found: $matches"
            echo "::error::Discard or publish before starting a new mobile release."
            echo "::error::To discard: gh release delete <tag> --cleanup-tag --yes"
            exit 1
          fi
          echo "No pending draft. Proceeding."

  version:
    name: Compute Version
    needs: guard
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      version: ${{ steps.version.outputs.version }}
      # github.sha is locked at workflow-dispatch time and visible from every
      # job. Emitting it as an output is purely for downstream-job convenience.
      sha: ${{ github.sha }}
    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          persist-credentials: false
          fetch-depth: 0
          fetch-tags: true

      - name: Compute next version
        id: version
        env:
          GH_TOKEN: ${{ github.token }}
          INPUT_VERSION: ${{ inputs.version }}
        run: |
          set -euo pipefail

          # Manual override always wins.
          if [[ -n "$INPUT_VERSION" ]]; then
            echo "version=$INPUT_VERSION" >> "$GITHUB_OUTPUT"
            echo "Version: $INPUT_VERSION — manual override"
            exit 0
          fi

          prev_tag=$(git tag --list 'v*.*.*' --sort=-version:refname | head -n1)
          if [[ -z "$prev_tag" ]]; then
            echo "::error::No existing version tags found. Run a manual release first."
            exit 1
          fi

          rank_of() {
            case "$1" in
              major) echo 3 ;;
              minor) echo 2 ;;
              patch) echo 1 ;;
              *) echo 0 ;;
            esac
          }

          bump=""
          has_non_skip_commit=false
          skipped_count=0
          total_count=0

          while IFS=$'\t' read -r sha subject; do
            [[ -z "$sha" ]] && continue
            total_count=$((total_count + 1))

            pr_num=$(echo "$subject" | grep -oP '#\K[0-9]+' | tail -1 || true)
            labels=""
            if [[ -n "$pr_num" ]]; then
              labels=$(gh pr view "$pr_num" --json labels --jq '.labels[].name' 2>/dev/null || true)
            fi

            if echo "$labels" | grep -q '^changelog:skip$'; then
              skipped_count=$((skipped_count + 1))
              echo "  · ${sha:0:7} ${subject}  [skip]"
              continue
            fi

            has_non_skip_commit=true
            commit_bump="patch"

            if echo "$labels" | grep -q '^changelog:feat$'; then
              commit_bump="minor"
            fi

            if echo "$subject" | grep -qP '^[a-z]+(\([^)]+\))?!:'; then
              commit_bump="major"
            elif echo "$subject" | grep -qP '^feat(\([^)]+\))?:'; then
              [[ "$commit_bump" == "patch" ]] && commit_bump="minor"
            fi

            if [[ -z "$bump" ]] || (( $(rank_of "$commit_bump") > $(rank_of "$bump") )); then
              bump="$commit_bump"
            fi
            echo "  · ${sha:0:7} ${subject}  [${commit_bump}]"
          done < <(git log --format='%H%x09%s' "${prev_tag}..HEAD")

          echo "Scanned $total_count commits since $prev_tag ($skipped_count skipped)."

          if [[ "$has_non_skip_commit" == "false" ]]; then
            echo "::error::No releasable commits since $prev_tag — nothing to release."
            exit 1
          fi

          bump="${bump:-patch}"
          major=$(echo "$prev_tag" | sed 's/^v//' | cut -d. -f1)
          minor=$(echo "$prev_tag" | sed 's/^v//' | cut -d. -f2)
          patch=$(echo "$prev_tag" | sed 's/^v//' | cut -d. -f3)

          case "$bump" in
            major) version="v$((major + 1)).0.0" ;;
            minor) version="v${major}.$((minor + 1)).0" ;;
            patch) version="v${major}.${minor}.$((patch + 1))" ;;
          esac

          echo "version=$version" >> "$GITHUB_OUTPUT"
          echo "Version: $version — ${bump} bump from $prev_tag"

  build-mobile:
    name: Build Mobile
    needs: version
    permissions:
      contents: read
    uses: ./.github/workflows/gallery-build-mobile.yml
    with:
      environment: production
      version: ${{ needs.version.outputs.version }}
    secrets: inherit

  draft-release:
    name: Create Draft GitHub Release
    needs: [version, build-mobile]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          persist-credentials: false
          fetch-depth: 0
          fetch-tags: true

      - name: Download APK artifact
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          name: gallery-apk
          path: ${{ runner.temp }}/apk

      - name: Create draft release
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          VERSION: ${{ needs.version.outputs.version }}
          SHA: ${{ needs.version.outputs.sha }}
        run: |
          set -euo pipefail

          upstream_version=$(jq -r '.upstream.version' branding/config.json)
          prev_tag=$(git tag --list 'v*.*.*' --sort=-version:refname | head -n1)

          notes="Based on [Immich v${upstream_version}](https://github.com/immich-app/immich/releases/tag/v${upstream_version})"

          if [[ -n "$prev_tag" ]]; then
            all_commits=$(git log --pretty=format:'%s' "${prev_tag}..${SHA}" 2>/dev/null)

            gallery_commits=$(echo "$all_commits" | while IFS= read -r line; do
              [[ -z "$line" ]] && continue
              pr_num=$(echo "$line" | grep -oP '\(#\K[0-9]+(?=\))' | head -1)
              if [[ -z "$pr_num" || "$pr_num" -lt 1000 ]]; then
                echo "- $line"
              fi
            done)

            upstream_commits=$(echo "$all_commits" | while IFS= read -r line; do
              [[ -z "$line" ]] && continue
              pr_num=$(echo "$line" | grep -oP '\(#\K[0-9]+(?=\))' | head -1)
              if [[ -n "$pr_num" && "$pr_num" -ge 1000 ]]; then
                echo "- $line"
              fi
            done)

            if [[ -n "$upstream_commits" ]]; then
              printf -v notes '%s\n\n<details>\n<summary>Upstream commits</summary>\n\n%s\n\n</details>' "$notes" "$upstream_commits"
            elif [[ -n "$gallery_commits" ]]; then
              printf -v notes '%s\n\n## Changes\n\n%s' "$notes" "$gallery_commits"
            fi
          fi

          gh release create "$VERSION" "$RUNNER_TEMP/apk/gallery-${VERSION}.apk" \
            --repo "$REPO" \
            --draft \
            --target "$SHA" \
            --title "$VERSION" \
            --notes "$notes"

          echo "Draft created: $VERSION pinned at $SHA"
          echo "Mobile submitted to Play internal + TestFlight."
          echo "Next: promote Play → production, submit App Store, then run gallery-release.yml."
```

**Step 3: Verify YAML is valid**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/gallery-release-mobile.yml'))"
```

Expected: no output.

**Step 4: Verify the lifted version-compute logic matches the source**

Open both files side-by-side and visually compare:

- Source: `.github/workflows/gallery-release.yml` lines 36–143 (the body of the `Compute next version` step in the `version` job).
- New: `.github/workflows/gallery-release-mobile.yml` — body of the `Compute next version` step.

Expected differences (intentional):

- New file's `version` job outputs only `version` and `sha` — NOT `skip`, NOT `major` (phase 2 doesn't need them).
- New file's "no commits to release" path is `::error:: … exit 1` instead of `skip=true`. Manual-only trigger means silently skipping is worse than failing loudly.

Anything else that differs is a transcription error — fix it.

**Step 5: Commit**

```bash
git add .github/workflows/gallery-release-mobile.yml
git commit -m "feat(release): add phase-1 mobile release workflow"
```

---

### Task 3: Refactor `gallery-release.yml` to phase 2

**Why:** Phase 2 reads the draft, builds the server at the pinned SHA, promotes the draft, and publishes the version endpoint.

**Files:**

- Modify: `.github/workflows/gallery-release.yml`

**Step 1: Replace the `version` job with a `discover` job**

The current `version` job (lines 17–143) is removed entirely. Replace with:

```yaml
jobs:
  discover:
    name: Discover Pending Release Draft
    runs-on: ubuntu-latest
    # contents: write is REQUIRED so the token can see draft releases.
    # GitHub returns drafts only to tokens with write permission.
    permissions:
      contents: write
    outputs:
      version: ${{ steps.discover.outputs.version }}
      sha: ${{ steps.discover.outputs.sha }}
      major: ${{ steps.discover.outputs.major }}
    steps:
      - name: Require main branch
        env:
          REF: ${{ github.ref_name }}
        run: |
          if [[ "$REF" != "main" ]]; then
            echo "::error::Releases must be triggered from main (got: $REF)"
            exit 1
          fi

      - name: Find draft created by phase 1
        id: discover
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
        run: |
          set -euo pipefail
          # Composite filter: drafts whose tag matches v*.*.* AND have at least
          # one .apk asset. Same predicate phase 1's guard uses.
          candidates=$(gh release list --repo "$REPO" --limit 1000 \
            --json tagName,isDraft \
            --jq '[.[] | select(.isDraft == true and (.tagName | test("^v[0-9]+\\.[0-9]+\\.[0-9]+$")))] | .[].tagName')
          matches=""
          for tag in $candidates; do
            count=$(gh release view "$tag" --repo "$REPO" --json assets \
              --jq '[.assets[] | select(.name | endswith(".apk"))] | length')
            if [[ "$count" -gt 0 ]]; then
              matches="$matches $tag"
            fi
          done
          matches=$(echo "$matches" | xargs || true)

          if [[ -z "$matches" ]]; then
            echo "::error::No pending mobile release draft found."
            echo "::error::Run gallery-release-mobile.yml first."
            exit 1
          fi

          read -r tag rest <<< "$matches"
          if [[ -n "$rest" ]]; then
            echo "::error::Multiple pending drafts found: $matches"
            echo "::error::Resolve before promoting."
            exit 1
          fi

          sha=$(gh release view "$tag" --repo "$REPO" --json targetCommitish --jq .targetCommitish)
          major=$(echo "$tag" | sed 's/^v//' | cut -d. -f1)

          echo "version=$tag" >> "$GITHUB_OUTPUT"
          echo "sha=$sha" >> "$GITHUB_OUTPUT"
          echo "major=v${major}" >> "$GITHUB_OUTPUT"
          echo "Discovered: $tag at $sha"
```

**Step 2: Update concurrency group**

At the top of the file change:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: false
```

to:

```yaml
concurrency:
  group: gallery-release-server
  cancel-in-progress: false
```

**Step 3: Remove `workflow_dispatch.inputs.version` and the `if: needs.version.outputs.skip != 'true'` guards**

Delete the `inputs.version` input. Delete every `if: needs.version.outputs.skip != 'true'` line — phase 2 always runs when triggered (discover fails fast if no draft).

**Step 4: Switch every `needs: version` to `needs: discover` and rename outputs**

`needs.version.outputs.version` → `needs.discover.outputs.version`. `needs.version.outputs.major` → `needs.discover.outputs.major`. Apply throughout.

**Step 5: Pin all checkouts in `build-server`, `build-ml`, and `tag` to the discovered SHA**

In each checkout step that previously used the default `github.sha`, add:

```yaml
- name: Checkout
  uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
  with:
    persist-credentials: false
    ref: ${{ needs.discover.outputs.sha }}
```

For the `tag` job specifically:

```yaml
- name: Checkout
  uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
  with:
    persist-credentials: true
    fetch-depth: 0
    fetch-tags: true
    ref: ${{ needs.discover.outputs.sha }}
```

**Step 6: Remove the `build-mobile` job**

Delete the entire `build-mobile` job (lines ~380–390 of the original file). Remove `build-mobile` from the `tag` job's `needs:` list. The `tag` job's `needs:` should be `[discover, merge-server, merge-ml]`.

**Step 7: Replace the tag job's release-creation block**

The original `Create tags` step stays, but adjust to use the discovered SHA explicitly:

```yaml
- name: Create tags
  env:
    VERSION: ${{ needs.discover.outputs.version }}
    SHA: ${{ needs.discover.outputs.sha }}
  run: |
    major=$(echo "$VERSION" | sed 's/^v//' | cut -d. -f1)
    git tag "$VERSION" "$SHA"
    git tag -f "v${major}" "$SHA"
    git tag -f "release" "$SHA"
    git push origin "$VERSION" "v${major}" "release" --force
```

**Step 8: Replace the `Download APK artifact` + `Create GitHub Release` steps with promote-draft**

Delete the `Download APK artifact` step (the APK is already on the draft). Replace `Create GitHub Release` with:

```yaml
- name: Promote draft release
  env:
    GH_TOKEN: ${{ github.token }}
    REPO: ${{ github.repository }}
    VERSION: ${{ needs.discover.outputs.version }}
  run: |
    set -euo pipefail
    gh release edit "$VERSION" --repo "$REPO" --draft=false --latest
    echo "Released $VERSION"
```

**Step 9: Update `publish-version-endpoint` job**

Change `needs: [version, tag]` → `needs: [discover, tag]`. Change `needs.version.outputs.version` → `needs.discover.outputs.version`. Everything else stays.

**Step 10: Verify YAML is valid**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/gallery-release.yml'))"
```

**Step 11: Commit**

```bash
git add .github/workflows/gallery-release.yml
git commit -m "refactor(release): phase 2 — discover draft, build at pinned SHA, promote"
```

---

### Task 4: Add header warning to gallery-build-mobile.yml

**Note:** An earlier version of this plan also re-enabled the Play Store fastlane block in the same task. That was reverted — Play Store automation stays disabled until Google finishes reviewing the app. Re-enabling fastlane is a follow-up commit (uncomment the block and update the docs' "upload is disabled" wording). This task now only adds the header warning comment.

**Why:** The reusable `gallery-build-mobile.yml` can be manually dispatched with a `version` input, bypassing the phase-1 handoff. Document the footgun in a header comment so maintainers don't accidentally skip the draft-release step.

**Files:**

- Modify: `.github/workflows/gallery-build-mobile.yml`

**Step 1: Add the header warning comment**

After line 1 (`name: Gallery Build Mobile`), add:

```yaml
# For production releases, trigger via gallery-release-mobile.yml.
# Manual workflow_dispatch with a non-empty version input here will
# upload to TestFlight (and Play Store once that fastlane block is
# re-enabled) WITHOUT creating a release draft, which breaks the
# phase-1 → phase-2 handoff. Use only for ad-hoc smoke builds (leave
# version empty).
```

**Step 2: Verify YAML is valid**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/gallery-build-mobile.yml'))"
```

**Step 3: Commit**

```bash
git add .github/workflows/gallery-build-mobile.yml
git commit -m "docs(mobile): header warning against manual dispatch with version input"
```

---

### Task 5: Remove `build-mobile` from `tag` job's `needs:` (sanity sweep)

**Why:** Already done in Task 3 step 6, but verify nothing in `gallery-release.yml` still references `build-mobile`, the old `version` job, or `download-artifact` for the APK.

**Step 1: Grep for stragglers**

```bash
grep -n -E "build-mobile|needs\.version|download-artifact.*apk" .github/workflows/gallery-release.yml
```

Expected: zero matches. If any match exists, remove it.

**Step 2: If anything was removed, commit**

```bash
git add .github/workflows/gallery-release.yml
git commit -m "chore(release): remove stragglers from phase 2"
```

If nothing was removed, skip the commit.

---

### Task 6: Validate against existing CI guards

**Why:** Zizmor (security) runs in CI and will catch template-injection patterns, dangerous triggers, etc. Run a self-check on the new files locally if possible.

**Step 1: Check all `gh` commands use env vars, not template expansion**

Every `gh` command in the new workflows reads inputs from `env:` mapped variables (`$GH_TOKEN`, `$REPO`, `$VERSION`, `$SHA`) — never from `${{ github.token }}` interpolated directly into the script body. Confirm by grepping:

```bash
grep -nE '\$\{\{ ' .github/workflows/gallery-release-mobile.yml .github/workflows/gallery-release.yml | grep -v '^\s*#' | grep -vE '(uses:|with:|env:|if:|outputs:|needs\.|inputs\.|matrix\.|runner\.|steps\.)' || echo "OK — no template injection in run blocks"
```

If matches appear inside `run: |` blocks, those are template-injection candidates — refactor to read from `env:`.

**Step 2: Confirm `permissions: {}` is present at top level on the new file**

```bash
grep -A1 '^permissions:' .github/workflows/gallery-release-mobile.yml
```

Expected: `permissions: {}` line present.

**Step 3: No commit needed** — this task is verification only.

---

### Task 7: Update README `Publishing` section to document the two-phase flow

**Why:** The README's `Docker Images → Publishing` section currently describes the single-workflow release. Update it to reflect phase 1 → manual mobile-approval wait → phase 2.

**Files:**

- Modify: `README.md` — "Publishing" subsection under "Docker Images" (locate via `grep -n "### Publishing" README.md`)

**Step 1: Replace the `Publishing` subsection**

Find the existing block starting with `### Publishing` and ending before the next `##` or `###` heading. Replace its body (keep the `### Publishing` heading) with:

````markdown
Gallery uses a **two-phase release flow** so mobile app builds are already live on Play Store and App Store before server users see a new version.

**Phase 1 — Release Mobile** (`.github/workflows/gallery-release-mobile.yml`)

1. Maintainer triggers the workflow from the Actions tab. Version is computed automatically from commits since the last tag (same rules as below), or passed explicitly via input.
2. The mobile app is built and signed. Android AAB uploads to Play Store **internal** track; iOS IPA uploads to TestFlight.
3. A **draft** GitHub Release is created pinning the version (tag name), commit SHA (`target_commitish`), and APK (asset). The draft is invisible to end users.
4. The maintainer manually promotes the Play internal build to **production** in Play Console and submits the App Store for review. Once both stores show the new version live to end users, proceed to phase 2. Typically ~24h.

**Phase 2 — Release Gallery** (`.github/workflows/gallery-release.yml`)

1. Maintainer triggers the workflow from the Actions tab. No inputs.
2. The workflow discovers the pending draft from phase 1, reads the pinned version + SHA, and checks out at that exact SHA — so the server image matches the commit the mobile app was built from.
3. `gallery-server` and `gallery-ml` images build (amd64 + arm64 matrix) and push to GHCR tagged with the version, the major version (`v4`), and `release`.
4. Git tags are created: `vX.Y.Z` at the pinned SHA, and the floating `vN` + `release` tags move forward.
5. The draft release is promoted to published (`--latest`). The APK attached in phase 1 becomes the public sideload download.
6. `version.json` is uploaded to the S3 version endpoint — self-hosted instances polling this endpoint now show "new version available".

**Version selection** (phase 1)

- `changelog:skip` PR label → commit is excluded from the bump computation
- `feat:` commit or `changelog:feat` PR label → **minor** bump (e.g. `v4.2.6` → `v4.3.0`)
- `BREAKING CHANGE` in commit body or `!` in commit prefix (e.g. `feat!:`) → **major** bump
- Everything else (`fix:`, `docs:`, `chore:`, etc.) → **patch** bump

If every commit since the last tag is `changelog:skip`, phase 1 errors — there is nothing to release.

**Design properties**

- Phase 2 builds from the draft's pinned SHA, not from `main`'s HEAD. Commits landing on main between the two phases are excluded from this release and ship in the next cycle.
- Manual edits to the draft's release notes during the waiting period are preserved — phase 2 promotes without regenerating notes.
- Both workflows fail fast if triggered from any branch other than `main`.

**Recovering from mobile rejection**

If a store rejects the mobile build, discard the draft and rerun phase 1 after fixing:

```bash
gh release delete vX.Y.Z --cleanup-tag --yes
```

See `docs/plans/2026-04-17-split-mobile-server-release-design.md` for the full design.
````

**Step 2: Verify markdown is valid**

```bash
cd /home/pierre/dev/gallery/.worktrees/split-release-cycle
npx prettier --write README.md 2>&1 | tail -3
```

Expected: `README.md XXms` (no errors).

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): document two-phase release flow"
```

---

### Task 8: Open PR with the design doc + workflow changes bundled

**Why:** The design doc landed in commit `2aee2d4bc` on this branch already. The workflow changes follow. Open one PR for the whole bundle.

**Step 1: Push the branch**

```bash
git push -u origin feat/split-release-cycle
```

**Step 2: Create PR**

```bash
gh pr create --title "feat(release): split mobile and server release cycles" --body "$(cat <<'EOF'
## Summary

Splits the single release workflow into two phases so mobile leads server promotion by ~24h, ensuring server users only see a new version once mobile is already live on Play / App Store.

- **Phase 1** (`gallery-release-mobile.yml`, new): builds + submits mobile, creates a draft GitHub Release pinning version + SHA + APK
- **Maintainer manual step**: promote Play internal → production, submit App Store, wait for both to go live
- **Phase 2** (`gallery-release.yml`, modified): discovers the draft, builds server / ML at the pinned SHA, promotes the draft, publishes version endpoint

Design doc: `docs/plans/2026-04-17-split-mobile-server-release-design.md`.

Also bundled: `gallery-build-mobile.yml` re-enables Play Store internal-track upload (currently commented while the app was in initial Google review), adds a `GITHUB_RUN_ATTEMPT` offset to versionCode so phase 1 retries don't collide with already-uploaded versionCodes, and the README `Publishing` section is updated to document the two-phase flow.

## Test plan

- [ ] Pre-flight `gh` SHA-pinning verification recorded in design doc (Task 0)
- [ ] CI passes (zizmor, lint)
- [ ] Code review from maintainer
- [ ] **First post-merge release is the real end-to-end test.** Trigger phase 1, inspect draft on GitHub UI before promoting Play to production. If anything looks wrong, `gh release delete` and revert.
EOF
)"
```

---

## Post-merge: first real release procedure

The first release after this PR merges is the end-to-end verification. Follow this procedure carefully:

1. **Trigger phase 1** — Actions tab → "Release Gallery — Mobile (phase 1)" → Run workflow, leave version blank.
2. **Inspect the draft** — Releases page on GitHub. Confirm:
   - Tag name matches expected version
   - "Target" shows the SHA from main HEAD at trigger time
   - APK asset attached, named `gallery-vX.Y.Z.apk`
   - Release is marked **draft**
3. **Inspect Play Console + TestFlight** — confirm AAB / IPA uploaded with the expected versionCode / CFBundleVersion.
4. **Promote Play internal → production** in Play Console. Submit App Store for review.
5. **Wait** until both stores show the new version live to end-users.
6. **Trigger phase 2** — Actions tab → "Release Gallery" → Run workflow, no inputs.
7. **Verify** — docker images pushed at `vX.Y.Z` and `:release`, draft promoted to published `--latest`, version endpoint reflects new version.

If anything fails between steps 1 and 6: `gh release delete vX.Y.Z --cleanup-tag --yes` to clear the draft and re-run phase 1.

If phase 2 fails after docker push but before version endpoint publish: docker images exist but users don't see the new version yet (version endpoint unchanged). Safe to re-run phase 2 after fixing.

If phase 2 fails after version endpoint publish: users will start polling and see the new version. Docker images already exist. The release is functionally complete; only the GitHub Release / git tags may be inconsistent. Investigate and patch manually.
