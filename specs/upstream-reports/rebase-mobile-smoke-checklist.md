# Rebase Mobile Smoke Checklist

Human-run checklist after an upstream rebase. Targets ~10 min on a device with the `de.opennoodle.gallery.debug` build installed.

## Boot + auth

- [ ] App boots past splash screen. (Bug if: immediate crash, blank screen >5s, framework exception dialog. Catches auto_route strict-mode collisions, riverpod-provider resolution failures, Drift schema version mismatch.)
- [ ] Login screen accepts credentials → lands on bottom nav.
- [ ] Logout → lands at login screen (not onboarding, not /photos).

## Bottom nav — each tab renders

- [ ] Timeline tab renders, shows the user's photos (or the empty-state illustration).
- [ ] Search tab opens, search input is focusable.
- [ ] Spaces tab opens, lists spaces. (Bug if: tap crashes the app — this is the primary repro for the duplicate-SpacesRoute crash seen on 2026-04-20.)
- [ ] Library tab opens.

## Viewer

- [ ] Open a photo from the Timeline → detail panel renders.
- [ ] Swipe left/right between photos in the viewer.

## Spaces

- [ ] Open a space → member avatars visible → tap a member → see their contributions → back.

## Filters + preferences

- [ ] Open the Timeline filter sheet → apply a filter → timeline content filters.
- [ ] Settings → Account → sub-page opens.
- [ ] Settings → Preferences → each sub-page opens without "unknown route".
- [ ] Pet detection toggle persists across app restart.

## Upload sanity

- [ ] Upload a photo via the system image picker → appears in Timeline within 30 seconds.

---

**When to run:** after every upstream rebase, before merging the rebase to main. Log any bugs with repro steps in a new issue tagged `rebase-regression`.
