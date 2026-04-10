# Logo Replacement Design

Replace the user-visible Gallery logo set with new "Noodle Gallery Camera" artwork.
Two commits, both surgical, no `apply-branding.sh` invocation.

## Background

The Gallery fork has two parallel logo systems that have drifted apart:

1. **`branding/assets/` + `apply-branding.sh`** — the canonical branding pipeline
   inherited from the original Immich rebrand. The script copies sources from
   `branding/assets/` to `design/immich-logo-*`, `docs/static/img/immich-logo-*`,
   and `mobile/assets/immich-logo-*`. **None of these `immich-logo-*` paths are
   referenced by user-visible code.** They're orphaned.

2. **`gallery-logo-*.svg`** — fork-only files added in the foundational squash
   commit `308119cfe`. These are the actually-rendered Gallery logos:
   - `web/static/gallery-logo-{stacked, stacked-dark, inline-light, inline-dark, mark}.svg`
     — referenced by `web/src/lib/components/shared-components/Logo.svelte` and
     `web/src/lib/components/layouts/AuthPageLayout.svelte`
   - `docs/static/img/gallery-logo-inline-{light, dark}.svg` — referenced by
     `docs/docusaurus.config.js`

The current `gallery-logo-*.svg` files are 1024×1024 SVGs that embed a base64
PNG (~200 KB each) — effectively raster wrapped in SVG. The replacement uses
proper vector SVGs.

This design only touches system (2). System (1) gets a partial source update
(see "Branding pipeline" below) but is not invoked.

## Source artwork

| Folder                                                    | Files                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `~/Downloads/noodle_gallery_camera_lockups_no_glare_4x3/` | 6 SVGs (3 variants × 2 themes) at 1200×900 (4:3), plus PNG previews     |
| `~/Downloads/noodle_gallery_camera_only_1x1/`             | 2 SVGs (camera-only mark, light + dark) at 1024×1024, plus PNG previews |

All SVGs have a hardcoded background `<rect>`: `#FFFFFF` for light variants,
`#000000` for dark variants. The existing `gallery-logo-*.svg` files have
equivalent `<path fill="#fff">` covering the canvas, so background behavior
is unchanged.

## Out of scope

- Mobile assets (`mobile/assets/immich-logo.png`, `immich-logo.svg`,
  `immich-logo.json` Lottie animation, Android adaptive, iOS resources)
- Splash screens (`mobile/assets/immich-splash*.png`, `flutter_native_splash.yaml`)
- The orphaned `immich-logo-*` set (design/, docs/static/img/, mobile/assets/)
- Updates to `apply-branding.sh` itself (would be a separate refactor)
- `Logo.svelte` theme-aware mark switching (would need a code change)
- Pushing the branch / opening a PR

## Commit 1 — lockups + mark

### File operations

| Source                                        | Destination(s)                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `noodle_gallery_camera_inline_light_4x3.svg`  | `web/static/gallery-logo-inline-light.svg`, `docs/static/img/gallery-logo-inline-light.svg` |
| `noodle_gallery_camera_inline_dark_4x3.svg`   | `web/static/gallery-logo-inline-dark.svg`, `docs/static/img/gallery-logo-inline-dark.svg`   |
| `noodle_gallery_camera_stacked_light_4x3.svg` | `web/static/gallery-logo-stacked.svg` (note: existing name has no `-light` suffix)          |
| `noodle_gallery_camera_stacked_dark_4x3.svg`  | `web/static/gallery-logo-stacked-dark.svg`                                                  |
| `noodle_gallery_camera_only_light_1x1.svg`    | `web/static/gallery-logo-mark.svg`                                                          |

5 sources → 7 destinations.

### Branding pipeline staging (cosmetic, kept per user choice)

- The previous session left 9 untracked files in `branding/assets/`
  (5 SVGs + 4 PNGs derived from the 4:3 lockups). Keep them, commit alongside.
- Replace `branding/assets/logo-mark.svg` (currently the 4:3 light camera-only)
  with `noodle_gallery_camera_only_light_1x1.svg`.
- Add new `branding/assets/logo-mark-dark.svg`
  (`noodle_gallery_camera_only_dark_1x1.svg`). Not yet wired into
  `apply-branding.sh` but available for future theme-aware logic.
- Tick the lockup + `logo-mark.svg` rows in `branding/assets/README.md`.

### Why not run `apply-branding.sh`?

1. It doesn't write to any of the 7 user-visible destinations above.
2. Its 17 logo destinations target the orphaned `immich-logo-*` set.
3. It additionally `sed -i` patches ~50 unrelated files (i18n, web layout,
   app.html, etc.). Re-running on a clean tree may produce drift diffs that
   conflate the change.

A future refactor could either:

- Update `apply-branding.sh` to also write to the `gallery-logo-*` paths, or
- Migrate the gallery-logo-_ paths to use the immich-logo-_ set (rename)
  and unify around `apply-branding.sh`.

That refactor is not in scope here.

### Risks (commit 1)

1. **Aspect ratio shift.** Existing inline/stacked are 1024×1024 (with internal
   whitespace — the stacked file pins its 795×497 content at y=99, leaving
   ~430 px of bottom whitespace). New artwork is 1200×900 (4:3, content fills
   canvas). `Logo.svelte` uses fixed-height CSS (`h-12`/`h-16`), so the new
   logo will render wider than before. Visual reflow possible in the web header
   and docs navbar. Mitigation: spin up `make dev` post-commit and adjust CSS
   if needed.
2. **Mark theming.** `Logo.svelte:35` returns `/gallery-logo-mark.svg`
   regardless of theme. The new file's white background (`#FFFFFF`) is
   identical to the existing file's white background, so behavior is
   preserved. A theme-aware mark would need a separate code change.

## Commit 2 — favicons

### File operations

Source: `noodle_gallery_camera_only_light_1x1.svg`.

**Stage in `branding/assets/`** (canonical sources for future
`apply-branding.sh` integration):

| File                           | Size                    | How                                                              |
| ------------------------------ | ----------------------- | ---------------------------------------------------------------- |
| `branding/assets/app-icon.png` | 1024×1024               | `rsvg-convert -w 1024 -h 1024`                                   |
| `branding/assets/favicon.png`  | 256×256                 | `rsvg-convert -w 256 -h 256` (matches existing destination size) |
| `branding/assets/favicon.ico`  | 16+32+48 multi-size ICO | `magick` from 1024 master                                        |

**Write destinations** (manual, no `apply-branding.sh`):

| Destination                                 | Size    | Currently  |
| ------------------------------------------- | ------- | ---------- |
| `web/static/favicon.ico`                    | ICO     | old Immich |
| `web/static/favicon.png`                    | 256×256 | old Immich |
| `web/static/favicon-16.png`                 | 16×16   | old Immich |
| `web/static/favicon-32.png`                 | 32×32   | old Immich |
| `web/static/favicon-48.png`                 | 48×48   | old Immich |
| `web/static/favicon-96.png`                 | 96×96   | old Immich |
| `web/static/favicon-144.png`                | 144×144 | old Immich |
| `web/static/favicon-256.png`                | 256×256 | old Immich |
| `web/static/apple-icon-180.png`             | 180×180 | old Immich |
| `web/static/manifest-icon-192.maskable.png` | 192×192 | old Immich |
| `web/static/manifest-icon-512.maskable.png` | 512×512 | old Immich |
| `docs/static/img/favicon.ico`               | ICO     | old Immich |
| `docs/static/img/favicon.png`               | 256×256 | old Immich |

13 destination writes from 1 source SVG.

### Generation strategy

```bash
# Master at 1024 (matches SVG viewBox, clean nearest power-of-two)
rsvg-convert -w 1024 -h 1024 \
  /home/pierre/Downloads/noodle_gallery_camera_only_1x1/noodle_gallery_camera_only_light_1x1.svg \
  -o /tmp/master.png

# Each PNG destination
for size in 16 32 48 96 144 180 192 256 512; do
  magick /tmp/master.png -resize "${size}x${size}" /tmp/icon-${size}.png
done

# ICO (multi-size, browser-friendly)
magick \
  \( /tmp/master.png -resize 16x16 \) \
  \( /tmp/master.png -resize 32x32 \) \
  \( /tmp/master.png -resize 48x48 \) \
  /tmp/favicon.ico
```

Then `cp` each generated file to its destination(s). Use `-strip` on
`magick` calls to remove metadata for reproducibility.

### Risks (commit 2)

1. **Maskable icons need padding.** PWA `manifest-icon-*.maskable.png` files
   should keep critical content within an 80% safe-area circle, otherwise the
   OS may crop the logo when applying mask shapes. The new camera-only mark
   already has internal padding around the camera; verify visually after
   generation.
2. **ICO format quirks.** Browsers expect multi-size ICOs containing 16, 32,
   and 48 px variants. ImageMagick's default ICO output usually handles this
   correctly, but verify with `file favicon.ico` showing multiple frames.
3. **`favicon.png` size mismatch with apply-branding.sh README.** The README
   in `branding/assets/` says favicon.png should be 180×180, but the actual
   destination file is 256×256. Following destination reality (256×256) over
   README. README is informational and stale; not updating it as part of this
   commit unless trivially.

## Mechanics

Both commits use backdated git authorship to 2026-04-06 with the current
wall-clock time at commit moment:

```bash
DATE="2026-04-06 $(date +'%H:%M:%S %z')"
GIT_AUTHOR_DATE="$DATE" GIT_COMMITTER_DATE="$DATE" git commit -m "..."
```

The design doc commit itself uses the same backdating.

### Verification (no full build)

For each commit:

1. `git status` shows only expected files modified.
2. Spot-check at least one rendered destination by opening the SVG/PNG.
3. For commit 2, `file` each generated PNG to confirm dimensions and
   `file favicon.ico` to confirm multi-frame ICO.

Visual smoke testing in a running web/docs build is left to a follow-up
session — `make dev` is not invoked from this conversation.

## Open follow-ups

Captured here so they don't get lost; not part of this work:

- Replace mobile `immich-logo.png` (2366×2366) and `immich-logo.svg` from
  the 1:1 mark source.
- Replace mobile splash/Android adaptive/Android mipmap launcher icons
  (requires full mobile rebuild verification).
- Replace mobile Lottie animation (`immich-logo.json`) — needs designer rework,
  not auto-regeneratable.
- Refactor `apply-branding.sh` to write to `gallery-logo-*` paths, OR rename
  the gallery-logo-_ set to immich-logo-_ and let `apply-branding.sh` handle it.
- Theme-aware mark in `Logo.svelte` (use `gallery-logo-mark-dark.svg` on dark
  theme).
- Re-rasterize `branding/assets/logo-{inline,stacked}-{light,dark}.png` with
  a documented `rsvg-convert` command (current PNGs are recoded copies of
  source previews — auditable but provenance is unclear).
