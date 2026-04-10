# Logo Replacement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the user-visible Gallery lockup logos and mark with new "Noodle Gallery Camera" artwork, then regenerate all web favicons from the 1:1 mark source. Two backdated commits, no `apply-branding.sh` invocation.

**Architecture:** Direct file operations. Commit 1 swaps 7 SVG destinations from 5 source SVGs. Commit 2 generates 13 favicon destinations from a single 1:1 mark SVG via `rsvg-convert` + ImageMagick. Both commits also update `branding/assets/` source files for future-proofing, but `apply-branding.sh` is **not** invoked because it doesn't write to the user-visible `gallery-logo-*` paths and would `sed -i` ~50 unrelated files.

**Tech Stack:** `cp`, `rsvg-convert` (librsvg), `magick` (ImageMagick), `git`.

**Reference design:** `docs/plans/2026-04-06-logo-replacement-design.md` (committed at `02a4ee0fe`).

**Source artwork:**

- 4:3 lockups: `/home/pierre/Downloads/noodle_gallery_camera_lockups_no_glare_4x3/`
- 1:1 mark: `/home/pierre/Downloads/noodle_gallery_camera_only_1x1/`

**Working directory:** `/home/pierre/dev/gallery/.worktrees/logo-replacement` on branch `feature/logo-replacement`.

---

## Conventions

- All shell commands assume `cwd = /home/pierre/dev/gallery/.worktrees/logo-replacement`.
- All `git commit` invocations use a backdated timestamp computed at commit time:
  ```bash
  DATE="2026-04-06 $(date +'%H:%M:%S %z')"
  GIT_AUTHOR_DATE="$DATE" GIT_COMMITTER_DATE="$DATE" git commit ...
  ```
- Do **NOT** push, do **NOT** open a PR.
- Do **NOT** invoke `branding/scripts/apply-branding.sh`.
- After every commit, run `git log -1 --format='%h %ad %s' --date=iso` to confirm the timestamp landed.
- If any `git status` step shows unexpected files, **stop and ask** before committing.

---

## Task 1: Update branding/assets/ source files

The previous session staged 9 files in `branding/assets/`. Replace the 4:3 mark with the 1:1 variant, add a dark mark, and tick the README checklist.

**Files:**

- Replace: `branding/assets/logo-mark.svg` (currently 4:3 light camera-only → switch to 1:1 light)
- Create: `branding/assets/logo-mark-dark.svg` (1:1 dark, new)
- Modify: `branding/assets/README.md` (tick checklist rows)

**Step 1.1: Replace `logo-mark.svg` with the 1:1 light variant**

```bash
cp /home/pierre/Downloads/noodle_gallery_camera_only_1x1/noodle_gallery_camera_only_light_1x1.svg \
   branding/assets/logo-mark.svg
```

**Step 1.2: Verify the replacement**

```bash
sha256sum branding/assets/logo-mark.svg \
          /home/pierre/Downloads/noodle_gallery_camera_only_1x1/noodle_gallery_camera_only_light_1x1.svg
```

Expected: identical hashes.

**Step 1.3: Add the dark mark**

```bash
cp /home/pierre/Downloads/noodle_gallery_camera_only_1x1/noodle_gallery_camera_only_dark_1x1.svg \
   branding/assets/logo-mark-dark.svg
```

**Step 1.4: Confirm both staged files are 1024×1024**

```bash
for f in branding/assets/logo-mark.svg branding/assets/logo-mark-dark.svg; do
  printf "%-40s " "$f"
  head -1 "$f" | grep -oE 'viewBox="[^"]*"'
done
```

Expected: both show `viewBox="0 0 1024 1024"`.

**Step 1.5: Tick the lockup + logo-mark rows in `branding/assets/README.md`**

Use Edit to change `- [ ]` to `- [x]` for these rows:

- `logo-inline-light.svg + .png`
- `logo-inline-dark.svg + .png`
- `logo-stacked-light.svg + .png`
- `logo-stacked-dark.svg + .png`
- `logo-mark.svg`

Leave the square assets (`app-icon.png`, `app-icon-adaptive-fg.png`, `notification-icon.png`, `splash.png`) **unchecked** — those are favicon-adjacent and only partially handled by commit 2.

**Step 1.6: Verify README diff**

```bash
git diff branding/assets/README.md
```

Expected: only `[ ]` → `[x]` changes on the 5 listed rows.

---

## Task 2: Write user-visible lockup destinations

**Files:**

- Modify: `web/static/gallery-logo-inline-light.svg`
- Modify: `web/static/gallery-logo-inline-dark.svg`
- Modify: `web/static/gallery-logo-stacked.svg` (note: existing name has no `-light` suffix)
- Modify: `web/static/gallery-logo-stacked-dark.svg`
- Modify: `web/static/gallery-logo-mark.svg`
- Modify: `docs/static/img/gallery-logo-inline-light.svg`
- Modify: `docs/static/img/gallery-logo-inline-dark.svg`

**Step 2.1: Define source-shorthand for the rest of the task**

```bash
LOCK=/home/pierre/Downloads/noodle_gallery_camera_lockups_no_glare_4x3
MARK=/home/pierre/Downloads/noodle_gallery_camera_only_1x1
```

**Step 2.2: Write inline-light to web and docs**

```bash
cp "$LOCK/noodle_gallery_camera_inline_light_4x3.svg" web/static/gallery-logo-inline-light.svg
cp "$LOCK/noodle_gallery_camera_inline_light_4x3.svg" docs/static/img/gallery-logo-inline-light.svg
```

**Step 2.3: Write inline-dark to web and docs**

```bash
cp "$LOCK/noodle_gallery_camera_inline_dark_4x3.svg" web/static/gallery-logo-inline-dark.svg
cp "$LOCK/noodle_gallery_camera_inline_dark_4x3.svg" docs/static/img/gallery-logo-inline-dark.svg
```

**Step 2.4: Write stacked light + dark to web (no docs target for stacked)**

```bash
cp "$LOCK/noodle_gallery_camera_stacked_light_4x3.svg" web/static/gallery-logo-stacked.svg
cp "$LOCK/noodle_gallery_camera_stacked_dark_4x3.svg" web/static/gallery-logo-stacked-dark.svg
```

**Step 2.5: Write the mark to web**

```bash
cp "$MARK/noodle_gallery_camera_only_light_1x1.svg" web/static/gallery-logo-mark.svg
```

**Step 2.6: Verify all 7 destinations match their sources**

```bash
for pair in \
  "web/static/gallery-logo-inline-light.svg|$LOCK/noodle_gallery_camera_inline_light_4x3.svg" \
  "web/static/gallery-logo-inline-dark.svg|$LOCK/noodle_gallery_camera_inline_dark_4x3.svg" \
  "web/static/gallery-logo-stacked.svg|$LOCK/noodle_gallery_camera_stacked_light_4x3.svg" \
  "web/static/gallery-logo-stacked-dark.svg|$LOCK/noodle_gallery_camera_stacked_dark_4x3.svg" \
  "web/static/gallery-logo-mark.svg|$MARK/noodle_gallery_camera_only_light_1x1.svg" \
  "docs/static/img/gallery-logo-inline-light.svg|$LOCK/noodle_gallery_camera_inline_light_4x3.svg" \
  "docs/static/img/gallery-logo-inline-dark.svg|$LOCK/noodle_gallery_camera_inline_dark_4x3.svg"
do
  dest="${pair%|*}"; src="${pair#*|}"
  if cmp -s "$dest" "$src"; then echo "ok: $dest"; else echo "MISMATCH: $dest"; fi
done
```

Expected: 7 lines, all `ok:`.

**Step 2.7: Spot-check rendered SVG**

```bash
head -1 web/static/gallery-logo-inline-light.svg | head -c 200
```

Expected: starts with `<svg ... viewBox="0 0 1200 900" ... aria-label="Noodle Gallery inline lockup light, 4:3, ...`

---

## Task 3: Commit 1 — lockups + mark + branding/assets staging

**Step 3.1: Inspect git status**

```bash
git status --short
```

Expected (order may vary):

```
 M branding/assets/README.md
?? branding/assets/logo-inline-dark.png
?? branding/assets/logo-inline-dark.svg
?? branding/assets/logo-inline-light.png
?? branding/assets/logo-inline-light.svg
?? branding/assets/logo-mark-dark.svg
?? branding/assets/logo-mark.svg              <-- previously untracked, still untracked
?? branding/assets/logo-stacked-dark.png
?? branding/assets/logo-stacked-dark.svg
?? branding/assets/logo-stacked-light.png
?? branding/assets/logo-stacked-light.svg
 M docs/static/img/gallery-logo-inline-dark.svg
 M docs/static/img/gallery-logo-inline-light.svg
 M web/static/gallery-logo-inline-dark.svg
 M web/static/gallery-logo-inline-light.svg
 M web/static/gallery-logo-mark.svg
 M web/static/gallery-logo-stacked-dark.svg
 M web/static/gallery-logo-stacked.svg
```

If anything else appears (e.g., random other files modified), **stop and investigate.**

**Step 3.2: Stage all the files**

```bash
git add branding/assets/README.md \
        branding/assets/logo-inline-dark.png \
        branding/assets/logo-inline-dark.svg \
        branding/assets/logo-inline-light.png \
        branding/assets/logo-inline-light.svg \
        branding/assets/logo-mark-dark.svg \
        branding/assets/logo-mark.svg \
        branding/assets/logo-stacked-dark.png \
        branding/assets/logo-stacked-dark.svg \
        branding/assets/logo-stacked-light.png \
        branding/assets/logo-stacked-light.svg \
        web/static/gallery-logo-inline-dark.svg \
        web/static/gallery-logo-inline-light.svg \
        web/static/gallery-logo-mark.svg \
        web/static/gallery-logo-stacked-dark.svg \
        web/static/gallery-logo-stacked.svg \
        docs/static/img/gallery-logo-inline-dark.svg \
        docs/static/img/gallery-logo-inline-light.svg
```

**Step 3.3: Verify staged file count**

```bash
git diff --cached --name-only | wc -l
```

Expected: `18`.

**Step 3.4: Create the backdated commit**

```bash
DATE="2026-04-06 $(date +'%H:%M:%S %z')"
GIT_AUTHOR_DATE="$DATE" GIT_COMMITTER_DATE="$DATE" git commit -m "$(cat <<'EOF'
chore(branding): replace gallery lockup logos and mark with new camera artwork

Swap the user-visible Gallery lockup SVGs in web/static/ and docs/static/img/
for the new "Noodle Gallery Camera" 4:3 vector artwork. Replace gallery-logo-mark
with the 1:1 camera-only variant. Stage the same source files in branding/assets/
for future apply-branding.sh integration (currently not wired into the
gallery-logo-* path).

Existing gallery-logo files were 1024×1024 SVGs embedding a base64 PNG
(~200 KB each); new files are proper vectors (~55 KB each).

In scope:
- web/static/gallery-logo-{inline-light,inline-dark,stacked,stacked-dark,mark}.svg
- docs/static/img/gallery-logo-inline-{light,dark}.svg
- branding/assets/{logo-inline-*,logo-stacked-*,logo-mark*}.{svg,png}
- branding/assets/README.md (checklist)

Out of scope (deferred):
- Mobile (immich-logo.png, immich-logo.svg, immich-logo.json Lottie animation)
- Splash screens, Android adaptive, iOS resources
- Orphaned upstream-style immich-logo-* files in design/, docs/, mobile/
- apply-branding.sh refactor to feed gallery-logo-* paths

Aspect ratio shift: existing files are 1024×1024 with internal whitespace;
new files are 1200×900 with content filling the canvas. Logo.svelte uses
fixed-height CSS so the rendered logo will appear wider. Visual smoke test
post-merge recommended.
EOF
)"
```

**Step 3.5: Verify the commit landed with the backdated timestamp**

```bash
git log -1 --format='%h %ad %s' --date=iso
```

Expected: `<hash> 2026-04-06 HH:MM:SS +ZZZZ chore(branding): replace gallery lockup logos and mark with new camera artwork`

If the date is **not** 2026-04-06, **stop** and check `GIT_*_DATE` env vars before retrying.

**Step 3.6: Verify working tree is clean**

```bash
git status --short
```

Expected: empty output.

---

## Task 4: Generate favicon master raster

**Files:**

- Create: `/tmp/logo-mark-master.png` (1024×1024, working file, not committed)

**Step 4.1: Rasterize the 1:1 SVG to a 1024×1024 PNG**

```bash
rsvg-convert -w 1024 -h 1024 \
  /home/pierre/Downloads/noodle_gallery_camera_only_1x1/noodle_gallery_camera_only_light_1x1.svg \
  -o /tmp/logo-mark-master.png
```

**Step 4.2: Verify dimensions**

```bash
file /tmp/logo-mark-master.png
```

Expected: `/tmp/logo-mark-master.png: PNG image data, 1024 x 1024, 8-bit/color RGBA, non-interlaced`
(RGB instead of RGBA is also acceptable — the source SVG has a hardcoded white rect.)

---

## Task 5: Generate sized PNG favicons

**Files:**

- Create (working): `/tmp/icon-{16,32,48,96,144,180,192,256,512}.png`

**Step 5.1: Generate every required size**

```bash
for size in 16 32 48 96 144 180 192 256 512; do
  magick /tmp/logo-mark-master.png -resize "${size}x${size}" -strip "/tmp/icon-${size}.png"
done
```

`-strip` removes EXIF/profile metadata so file sizes are minimal and reproducible.

**Step 5.2: Verify all sizes**

```bash
for size in 16 32 48 96 144 180 192 256 512; do
  printf "%-25s " "/tmp/icon-${size}.png"
  file "/tmp/icon-${size}.png" | sed 's/.*PNG image data, //; s/, .*//'
done
```

Expected: each line ends in `${size} x ${size}`.

---

## Task 6: Generate ICO favicon

**Files:**

- Create (working): `/tmp/favicon.ico`

**Step 6.1: Build a multi-frame ICO containing 16/32/48 variants**

```bash
magick \
  \( /tmp/logo-mark-master.png -resize 16x16 \) \
  \( /tmp/logo-mark-master.png -resize 32x32 \) \
  \( /tmp/logo-mark-master.png -resize 48x48 \) \
  /tmp/favicon.ico
```

**Step 6.2: Verify the ICO has multiple frames**

```bash
file /tmp/favicon.ico
identify /tmp/favicon.ico
```

Expected:

- `file` reports `MS Windows icon resource - 3 icons, ...` (or similar)
- `identify` lists three lines, one per frame, sized 16, 32, 48.

---

## Task 7: Stage favicon master files in `branding/assets/`

**Files:**

- Create: `branding/assets/app-icon.png` (1024×1024 master)
- Create: `branding/assets/favicon.png` (256×256, matches existing destination size)
- Create: `branding/assets/favicon.ico` (multi-frame)

**Step 7.1: Copy app-icon (1024 master)**

```bash
cp /tmp/logo-mark-master.png branding/assets/app-icon.png
```

**Step 7.2: Copy favicon.png (256)**

```bash
cp /tmp/icon-256.png branding/assets/favicon.png
```

**Step 7.3: Copy favicon.ico**

```bash
cp /tmp/favicon.ico branding/assets/favicon.ico
```

**Step 7.4: Verify staged file dimensions**

```bash
file branding/assets/app-icon.png branding/assets/favicon.png branding/assets/favicon.ico
```

Expected:

- `app-icon.png: PNG image data, 1024 x 1024, ...`
- `favicon.png: PNG image data, 256 x 256, ...`
- `favicon.ico: MS Windows icon resource - 3 icons, ...`

---

## Task 8: Write favicon destinations

**Files (web/static/):**

- Modify: `favicon.ico`, `favicon.png`, `favicon-{16,32,48,96,144,256}.png`,
  `apple-icon-180.png`, `manifest-icon-192.maskable.png`, `manifest-icon-512.maskable.png`

**Files (docs/static/img/):**

- Modify: `favicon.ico`, `favicon.png`

**Step 8.1: Write web/static/ favicons**

```bash
cp /tmp/favicon.ico    web/static/favicon.ico
cp /tmp/icon-256.png   web/static/favicon.png
cp /tmp/icon-16.png    web/static/favicon-16.png
cp /tmp/icon-32.png    web/static/favicon-32.png
cp /tmp/icon-48.png    web/static/favicon-48.png
cp /tmp/icon-96.png    web/static/favicon-96.png
cp /tmp/icon-144.png   web/static/favicon-144.png
cp /tmp/icon-256.png   web/static/favicon-256.png
cp /tmp/icon-180.png   web/static/apple-icon-180.png
cp /tmp/icon-192.png   web/static/manifest-icon-192.maskable.png
cp /tmp/icon-512.png   web/static/manifest-icon-512.maskable.png
```

**Step 8.2: Write docs/static/img/ favicons**

```bash
cp /tmp/favicon.ico  docs/static/img/favicon.ico
cp /tmp/icon-256.png docs/static/img/favicon.png
```

**Step 8.3: Verify destination dimensions match expected sizes**

```bash
declare -A expected=(
  [web/static/favicon.png]=256
  [web/static/favicon-16.png]=16
  [web/static/favicon-32.png]=32
  [web/static/favicon-48.png]=48
  [web/static/favicon-96.png]=96
  [web/static/favicon-144.png]=144
  [web/static/favicon-256.png]=256
  [web/static/apple-icon-180.png]=180
  [web/static/manifest-icon-192.maskable.png]=192
  [web/static/manifest-icon-512.maskable.png]=512
  [docs/static/img/favicon.png]=256
)
for f in "${!expected[@]}"; do
  size=${expected[$f]}
  actual=$(file "$f" | sed 's/.*PNG image data, //; s/, .*//')
  if [[ "$actual" == "$size x $size" ]]; then
    echo "ok: $f ($actual)"
  else
    echo "MISMATCH: $f expected ${size}x${size} got $actual"
  fi
done
```

Expected: 11 lines, all `ok:`.

**Step 8.4: Verify ICO destinations are multi-frame**

```bash
file web/static/favicon.ico docs/static/img/favicon.ico
```

Expected: both report `MS Windows icon resource - 3 icons, ...`.

**Step 8.5: Inspect git status**

```bash
git status --short
```

Expected:

```
?? branding/assets/app-icon.png
?? branding/assets/favicon.ico
?? branding/assets/favicon.png
 M docs/static/img/favicon.ico
 M docs/static/img/favicon.png
 M web/static/apple-icon-180.png
 M web/static/favicon-144.png
 M web/static/favicon-16.png
 M web/static/favicon-256.png
 M web/static/favicon-32.png
 M web/static/favicon-48.png
 M web/static/favicon-96.png
 M web/static/favicon.ico
 M web/static/favicon.png
 M web/static/manifest-icon-192.maskable.png
 M web/static/manifest-icon-512.maskable.png
```

If anything else appears, **stop and investigate.**

---

## Task 9: Commit 2 — favicons

**Step 9.1: Stage all favicon files**

```bash
git add branding/assets/app-icon.png \
        branding/assets/favicon.ico \
        branding/assets/favicon.png \
        web/static/favicon.ico \
        web/static/favicon.png \
        web/static/favicon-16.png \
        web/static/favicon-32.png \
        web/static/favicon-48.png \
        web/static/favicon-96.png \
        web/static/favicon-144.png \
        web/static/favicon-256.png \
        web/static/apple-icon-180.png \
        web/static/manifest-icon-192.maskable.png \
        web/static/manifest-icon-512.maskable.png \
        docs/static/img/favicon.ico \
        docs/static/img/favicon.png
```

**Step 9.2: Verify staged file count**

```bash
git diff --cached --name-only | wc -l
```

Expected: `16`.

**Step 9.3: Create the backdated commit**

```bash
DATE="2026-04-06 $(date +'%H:%M:%S %z')"
GIT_AUTHOR_DATE="$DATE" GIT_COMMITTER_DATE="$DATE" git commit -m "$(cat <<'EOF'
chore(branding): regenerate favicons from new 1:1 camera mark

Rasterize the new 1:1 camera-only mark into all favicon variants used by
web/static/ and docs/static/img/. Master is rendered at 1024x1024 from the
SVG via rsvg-convert, then resized via ImageMagick to each destination size.
Multi-frame .ico (16/32/48) generated via magick.

Stage app-icon.png (1024), favicon.png (256), and favicon.ico in
branding/assets/ for future apply-branding.sh integration. Mobile static
images, Android mipmap launchers, and PWA splash screens are still deferred
(separate from this favicon-only pass).

Sized PNGs cover: 16, 32, 48, 96, 144, 180 (apple-icon), 192/512 (PWA
manifest maskable), 256 (favicon.png + favicon-256).
EOF
)"
```

**Step 9.4: Verify the commit landed with the backdated timestamp**

```bash
git log -1 --format='%h %ad %s' --date=iso
```

Expected: `<hash> 2026-04-06 HH:MM:SS +ZZZZ chore(branding): regenerate favicons from new 1:1 camera mark`

**Step 9.5: Verify working tree is clean**

```bash
git status --short
```

Expected: empty output.

---

## Task 10: Final verification

**Step 10.1: Confirm branch state**

```bash
git log --oneline main..HEAD
```

Expected: 3 commits (oldest to newest):

1. `02a4ee0fe docs(plans): logo replacement design`
2. `<hash> chore(branding): replace gallery lockup logos and mark with new camera artwork`
3. `<hash> chore(branding): regenerate favicons from new 1:1 camera mark`

**Step 10.2: Confirm all 3 commits are dated 2026-04-06**

```bash
git log main..HEAD --format='%h %ad %s' --date=iso
```

Expected: every line begins with the same date `2026-04-06`. Times will vary by a few seconds across commits.

**Step 10.3: Summarize the diff at high level**

```bash
git diff main..HEAD --stat | tail -20
```

Expected: ~34 files changed (1 plan + 1 design doc + 18 commit-1 files + 16 commit-2 files - design committed earlier so technically 33 in main..HEAD; the count just needs to look reasonable).

**Step 10.4: Clean up working tmp files**

```bash
rm -f /tmp/logo-mark-master.png /tmp/icon-{16,32,48,96,144,180,192,256,512}.png /tmp/favicon.ico
```

**Step 10.5: Report back to the user**

Summarize:

- 3 commits on `feature/logo-replacement`, all dated 2026-04-06
- File counts changed in each commit
- What was deferred (mobile, Lottie, etc.)
- Suggest: spin up `make dev` post-merge to visually verify aspect ratio fit

Do NOT push. Do NOT open a PR.

---

## Rollback

If anything goes catastrophically wrong mid-execution:

```bash
# Soft reset to design-doc commit (preserves work)
git reset --soft 02a4ee0fe

# Or hard reset (destructive — loses uncommitted changes)
git reset --hard 02a4ee0fe
```

For just abandoning a single bad commit:

```bash
git reset --soft HEAD~1
```

If the worktree itself is broken, the lockup and 1:1 source artwork lives in
`/home/pierre/Downloads/noodle_gallery_camera_lockups_no_glare_4x3/` and
`/home/pierre/Downloads/noodle_gallery_camera_only_1x1/` — re-running this plan
from scratch is safe.
