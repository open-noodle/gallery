# Slice 3 — Mobile: force autoplay for videos in the memory viewer

Spec: `docs/plans/2026-07-19-memory-types-tier3-spec.md` §4.4, §6.9, Slice 3.
Independent of every other slice (mobile only, no shared files).

## Problem

`NativeVideoViewer` gates playback on the user's global setting
(`video_viewer.widget.dart:221-222`):

```dart
final autoPlayVideo = ref.read(appConfigProvider).viewer.autoPlayVideo;
if (autoPlayVideo || widget.asset.isMotionPhoto) {
  await _notifier.play();
}
```

`DriftMemoryCard` builds it with `showControls: false`
(`memory_card.widget.dart:63-70`), so a user with autoplay **off** sees a frozen first frame **and
no play button**. This is pre-existing (videos can already land in memories today) but becomes
user-visible with `video_moments`.

## Changes

1. `mobile/lib/presentation/widgets/asset_viewer/video_viewer.widget.dart`
   - Add `final bool forceAutoPlay;` to `NativeVideoViewer` (class fields, ~line 26).
   - Add `this.forceAutoPlay = false,` to the constructor (~line 34). Default `false` means **no
     existing call site changes behavior**.
   - Change the gate (~line 222) to:
     `if (widget.forceAutoPlay || autoPlayVideo || widget.asset.isMotionPhoto) {`

2. `mobile/lib/presentation/widgets/memory/memory_card.widget.dart`
   - Pass `forceAutoPlay: true` in the `NativeVideoViewer(...)` construction (~line 63-70).

## Verification

```bash
cd mobile && dart analyze --fatal-infos lib test
cd mobile && dart format --set-exit-if-changed .
```

Note: CI runs **two** Dart gates — `dart analyze --fatal-infos lib test` (local
`flutter analyze lib` misses test-only lints) and `dart format --set-exit-if-changed`.

Analyzer/formatter need generated files that are gitignored. Per CLAUDE.md, from `mobile/`:
`flutter pub get`, then `dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart`.

## Test (§6.9) — with an honest constraint

Intended: assert `NativeVideoViewer` defaults `forceAutoPlay` to `false`, and that `DriftMemoryCard`
constructs it with `forceAutoPlay: true` for a video asset.

`NativeVideoViewer` initialises a platform video controller on mount, so a full `pumpWidget` may be
flaky in CI. **If it proves unstable, downgrade to a construction-only assertion** (instantiate the
widget directly and read the field — no pumping, no platform channel) and record manual verification
in the PR. Do **not** paper over a flake with a retry: per fork policy, flakes are fixed at the root
or the test is scoped down deliberately.

A direct-construction assertion is genuinely meaningful here because the whole change is "is the flag
plumbed through with the right default", which is a pure constructor-wiring property.

## Out of scope

No mobile auto-advance timer (pre-existing gap affecting every memory type — spec §9). No muting
changes.

## Commit

`fix(mobile): force autoplay for videos in the memory viewer`
