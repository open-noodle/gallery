# Release APK Upload Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Attach a signed universal Android APK as an asset on every GitHub Release produced by `gallery-release.yml`.

**Architecture:** Add an APK build to `build-sign-android` (reusable mobile workflow), gated on `inputs.version != ''`, uploaded as a workflow artifact. In `gallery-release.yml`'s `tag` job, download the artifact and pass it as a positional arg to the existing `gh release create` call. Same signing keystore as the AAB, no gradle changes, no smoke-build impact.

**Tech Stack:** GitHub Actions (reusable workflows, artifacts v7, download-artifact v8), Flutter build tooling, `gh` CLI, bash.

**Design doc:** `docs/plans/2026-04-13-release-apk-upload-design.md` — read this first if anything below is unclear.

---

## Task 1: Add APK build step to the reusable mobile workflow

**Files:**

- Modify: `.github/workflows/gallery-build-mobile.yml` — insert two new steps in `build-sign-android` between "Publish Android App Bundle artifact" and "Setup Ruby".

**Step 1: Locate the insertion point**

Open `.github/workflows/gallery-build-mobile.yml`. The two new steps go between "Publish Android App Bundle artifact" and "Setup Ruby" in the `build-sign-android` job. Don't trust line numbers — the file drifts. Use grep to confirm the neighbors exist:

```bash
grep -n "Publish Android App Bundle artifact\|Setup Ruby" .github/workflows/gallery-build-mobile.yml
```

Expected: two matches, with "Setup Ruby" appearing after "Publish Android App Bundle artifact" and before "Build and sign iOS". Insert the new steps between them.

**Step 2: Add the APK build step**

Insert immediately after "Publish Android App Bundle artifact":

```yaml
- name: Build signed Android APK
  if: inputs.version != ''
  working-directory: ./mobile
  env:
    ALIAS: ${{ secrets.ALIAS }}
    ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
    ANDROID_STORE_PASSWORD: ${{ secrets.ANDROID_STORE_PASSWORD }}
    VERSION_NAME: ${{ steps.build-meta.outputs.version_name }}
    VERSION_CODE: ${{ steps.build-meta.outputs.version_code }}
    VERSION: ${{ inputs.version }}
  run: |
    flutter build apk --release \
      --build-name="$VERSION_NAME" \
      --build-number="$VERSION_CODE"
    mv build/app/outputs/flutter-apk/app-release.apk \
       "build/app/outputs/flutter-apk/gallery-${VERSION}.apk"
```

**Why `VERSION` in env and not an expression in the `mv` command:** the existing AAB build step injects `VERSION_NAME` / `VERSION_CODE` via env (not expression interpolation); match that style for consistency and to keep `${{ }}` off the shell line.

**Step 3: Add the APK artifact upload step**

Insert immediately after the APK build step:

```yaml
- name: Publish Android APK artifact
  if: inputs.version != ''
  uses: actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f # v7.0.0
  with:
    name: gallery-apk
    path: mobile/build/app/outputs/flutter-apk/gallery-${{ inputs.version }}.apk
    if-no-files-found: error
```

Use the exact same pinned SHA (`bbbca2ddaa5d8feaa63e36b76fdaad77386f024f # v7.0.0`) that the existing "Publish Android App Bundle artifact" step uses — don't pick a newer tag, CI pins for a reason.

**Step 4: Validate YAML syntax locally**

Run:

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/gallery-build-mobile.yml'))"
```

Expected: no output, exit code 0. If it errors, check indentation — YAML is whitespace-sensitive. The two new steps must be indented to match the sibling steps (8 spaces for `- name:`).

**Step 5: Sanity-check the step order**

Confirm the final `build-sign-android` step order is:

1. Build signed Android App Bundle
2. Publish Android App Bundle artifact
3. **Build signed Android APK** (new)
4. **Publish Android APK artifact** (new)
5. Setup Ruby
6. Write Play Store service account key
7. Upload to Play Store internal track
8. Remove Play Store service account key
9. Save Gradle Cache

Verify this by grep:

```bash
grep -n "^      - name:" .github/workflows/gallery-build-mobile.yml | head -20
```

**Step 6: Commit**

```bash
git add .github/workflows/gallery-build-mobile.yml
git commit -m "feat(ci): build signed APK alongside AAB on release builds"
```

---

## Task 2: Download APK artifact in the release tag job

**Files:**

- Modify: `.github/workflows/gallery-release.yml` — add one step in the `tag` job before "Create GitHub Release".

**Step 1: Locate the insertion point**

Open `.github/workflows/gallery-release.yml`. The new download step goes in the `tag` job, between "Create tags" and "Create GitHub Release". Don't trust line numbers — use grep:

```bash
grep -n "name: Create tags\|name: Create GitHub Release" .github/workflows/gallery-release.yml
```

Expected: two matches, "Create tags" before "Create GitHub Release". Insert between them.

**Step 2: Add the download step**

Insert between "Create tags" and "Create GitHub Release":

```yaml
- name: Download APK artifact
  uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
  with:
    name: gallery-apk
    path: ${{ runner.temp }}/apk
```

The pinned SHA (`3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1`) matches the other `download-artifact` usages in the same file (e.g., the `merge-server` / `merge-ml` jobs). Keep it consistent.

**Step 3: Validate YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/gallery-release.yml'))"
```

Expected: no output, exit code 0.

**Step 4: Commit**

```bash
git add .github/workflows/gallery-release.yml
git commit -m "ci: download APK artifact in release tag job"
```

---

## Task 3: Attach APK to the GitHub Release

**Files:**

- Modify: `.github/workflows/gallery-release.yml` — modify the `gh release create` invocation inside the "Create GitHub Release" step of the `tag` job.

**Step 1: Find the existing `gh release create` line**

In `.github/workflows/gallery-release.yml`, inside the `tag` job's "Create GitHub Release" step, find the existing call:

```bash
grep -n 'gh release create' .github/workflows/gallery-release.yml
```

Expected: one match — `gh release create "$VERSION" --title "$VERSION" --latest -n "$notes"`. If there's more than one, you're editing the wrong workflow.

**Step 2: Add the APK as a positional arg**

Replace with:

```bash
gh release create "$VERSION" "$RUNNER_TEMP/apk/gallery-${VERSION}.apk" \
  --title "$VERSION" --latest -n "$notes"
```

Why `$RUNNER_TEMP` and not `${{ runner.temp }}`:

- `$RUNNER_TEMP` is injected by the runner as a bash env var in every `run:` step.
- The rest of this heredoc uses bash env vars (`$VERSION`, `$prev_tag`, etc.), not GitHub expression interpolation — matching that style keeps the script readable.
- Both resolve to the same path.

The positional arg must come **before** the `--title` flag per `gh release create`'s CLI contract (files are positional after the tag).

**Step 3: Validate YAML still parses**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/gallery-release.yml'))"
```

Expected: no output, exit code 0.

**Step 4: Dry-run the bash logic locally (optional sanity check)**

In a scratch directory:

```bash
VERSION="v4.48.5"
RUNNER_TEMP="/tmp"
mkdir -p "$RUNNER_TEMP/apk"
touch "$RUNNER_TEMP/apk/gallery-${VERSION}.apk"
echo gh release create "$VERSION" "$RUNNER_TEMP/apk/gallery-${VERSION}.apk" --title "$VERSION" --latest
```

Expected output:

```
gh release create v4.48.5 /tmp/apk/gallery-v4.48.5.apk --title v4.48.5 --latest
```

Confirms path resolution works. Clean up: `rm -f /tmp/apk/gallery-v4.48.5.apk`.

**Step 5: Commit**

```bash
git add .github/workflows/gallery-release.yml
git commit -m "feat(ci): attach Android APK to GitHub Release"
```

---

## Task 4: Verify zizmor / static workflow linting passes

**Files:**

- None modified. Read-only check.

**Step 1: Verify static lint expectations mentally, skip local run**

Gallery runs zizmor in CI via `org-zizmor.yml` — do NOT install it locally. The CI run on PR is the source of truth. This task is a reading-only sanity pass to catch obvious issues before push.

Check the new steps against existing patterns in the same file:

```bash
grep -n "inputs.version\|secrets\.\|steps.build-meta" .github/workflows/gallery-build-mobile.yml | head -30
```

Expected: the new APK build step uses `${{ inputs.version }}` in `env:` and `with:`, `${{ secrets.* }}` in `env:`, and `${{ steps.build-meta.outputs.* }}` in `env:` — all identical patterns to the existing AAB step above it. Zizmor flags template-injection in `run:` blocks, not `env:`/`with:` blocks, so these are safe.

**Step 2: Look for unintended template-injection warnings**

The new APK build step injects `${{ inputs.version }}` into the `path:` of upload-artifact and `${{ secrets.* }}` / `${{ steps.build-meta.outputs.* }}` into `env:`. These are identical patterns to the existing AAB steps, which zizmor already accepts. The `run:` block reads values via `$VERSION` / `$VERSION_NAME` / `$VERSION_CODE` from env — safe.

If zizmor flags anything new, stop and report — don't add a suppression without understanding.

**Step 3: No commit** (nothing changed).

---

## Task 5: Push branch and open PR

**Files:**

- None modified in this task.

**Step 1: Push the branch**

```bash
git push -u origin feat/release-apk-upload
```

**Step 2: Open the PR**

Use `gh pr create` with a body that explains what and why, linking the design doc:

```bash
gh pr create --title "feat(ci): attach signed Android APK to GitHub Releases" --body "$(cat <<'EOF'
## Summary

- Build a signed universal Android APK alongside the existing AAB on release runs of the mobile workflow.
- Attach `gallery-<version>.apk` as an asset on the GitHub Release created by `gallery-release.yml`.

Users who sideload (direct download, F-Droid-style) can now grab the APK from the Releases page. Same signing keystore as the Play Store AAB, so users can move between sideload and Play Store in place.

Design: `docs/plans/2026-04-13-release-apk-upload-design.md`

## Test plan

- [ ] Manually trigger `Release Gallery` workflow (or wait for the next release cut).
- [ ] Confirm the new GitHub Release has `gallery-v<version>.apk` attached.
- [ ] Install the APK on a physical Android device; verify it launches and connects to a Gallery server.
- [ ] Run `apksigner verify --print-certs gallery-v*.apk` and confirm the certificate fingerprint matches the Play Store version.
- [ ] Confirm smoke mobile builds (PRs touching `mobile/**`) still pass with no new steps running.
EOF
)"
```

**Step 3: Watch CI**

Mobile builds on PR won't exercise the APK path (it's gated on `inputs.version != ''`), but the YAML / zizmor / lint checks must all be green before merge.

```bash
gh pr checks --watch
```

---

## Out of scope (explicit YAGNI list)

Do NOT add any of these — they were explicitly rejected in the design phase:

- `SHA256SUMS` file or signed manifest
- Split-per-ABI APKs
- IPA attachment
- Release-notes text change advertising the APK
- Any gradle changes
- Any change to smoke-build behavior

If you find yourself wanting to add any of these, stop and re-read `docs/plans/2026-04-13-release-apk-upload-design.md` — the rationale for rejecting each is documented there.

---

## Validation summary

After all tasks are complete, the following must be true:

1. `git log --oneline feat/release-apk-upload` shows: design doc commit, plan doc commit, and 3 feature commits (APK build, artifact download, release attachment) — 5 commits total on top of `main`.
2. `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/gallery-build-mobile.yml'))"` parses cleanly.
3. `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/gallery-release.yml'))"` parses cleanly.
4. `grep -c "gallery-apk" .github/workflows/gallery-build-mobile.yml` returns `2` (one in upload `name:`, one in `path:`).
5. `grep -c "gallery-apk" .github/workflows/gallery-release.yml` returns `1` (download `name:`).
6. **AAB regression guard:** `grep -c "app-release-aab" .github/workflows/gallery-build-mobile.yml` returns `1` — the existing AAB artifact upload must still be present.
7. **AAB build regression guard:** `grep -c "flutter build appbundle" .github/workflows/gallery-build-mobile.yml` returns `1` — the existing AAB build step must still be present.
8. `grep "RUNNER_TEMP/apk/gallery" .github/workflows/gallery-release.yml` returns exactly one line (the `gh release create` positional arg).
9. PR is open, all CI checks green.

End-to-end verification (requires an actual release cut — post-merge):

1. Trigger `Release Gallery` workflow manually with a bump.
2. APK appears as an asset on the resulting GitHub Release at the expected filename.
3. `apksigner verify --print-certs` fingerprint matches Play Store.
4. APK installs and runs on a physical device.
