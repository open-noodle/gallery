# Data Saver video: a small stored copy for playback on mobile data

## Summary

An optional second transcode per video, small enough to play smoothly on a mobile connection (720p HEVC capped at
1.5 Mbit/s by default), stored next to the normal encoded video and recorded in a fork table. A new route serves it,
falling back to the normal playback file when a video has none. The mobile app plays it when the phone is on a
metered (cellular) network and the server advertises the feature; on Wi-Fi nothing changes.

Off by default. A fresh install, a stock Immich app and a stock Immich server booted on the database all behave
exactly as upstream.

## Problem

Immich stores one playback copy per video, and every client gets that copy regardless of the connection. The copy is
sized for a LAN: with the default `ultrafast` preset and no bitrate cap, the 720p H.264 encodes of five iPhone clips
in a test library averaged 10 Mbit/s (one reached 23 Mbit/s), which stalls on a weak LTE signal and spends a lot of
mobile data. The admin's only lever is `ffmpeg.maxBitrate`, which lowers quality on Wi-Fi too.

Upstream has been asked for this several times. Network-aware quality was requested in immich-28635 and immich-30763
(both closed as duplicates of immich-5617, "Load original image only on Wifi", open since 2023 without a maintainer
reply), and pre-generated lower-resolution copies in immich-19958 (closed as a duplicate of immich-7666, on-demand
transcoding). Upstream's answer is real-time HLS (`ffmpeg.realtime`, alpha in v3.3.5), which adapts to the connection,
but the mobile app does not play HLS yet (immich-29164, open since June) and real-time transcoding re-reads the original
on every view, which is slow when originals sit on S3.

## Goals and non-goals

Goals:

- A stored, bandwidth-capped copy per video that the mobile app picks on metered networks, with no change on Wi-Fi.
- No extra work on the playback path: the copy is made once, in the background, on the existing video-conversion
  queue.
- Works with S3 storage: the copy is written through the write backend and served by `serveFromBackend`, so redirect
  mode sends cellular clients straight to the bucket.
- Follows a trim: a trimmed video's copy is made from the trimmed file, and remade when the trim changes.
- Off by default, opt-in from the Video Transcoding settings page.

Non-goals:

- Adaptive bitrate. Upstream's real-time HLS is the long-term answer; this is the stored, works-today complement, and
  it costs nothing to remove once the app plays HLS.
- More than one extra copy, or a per-user quality choice.
- Changing what the web player loads. Browsers expose no reliable metered-network signal (`navigator.connection` is
  Chromium-only and absent in Safari). A later change could add a manual web toggle.
- Shared-link viewers and the cast service keep the normal file; only the mobile asset viewer switches.

## Server

### Config

A fork sub-object on the FFmpeg config, added to `AdminConfigFFmpegSchema` with one line, the same shape as
`realtime`:

```ts
ffmpeg.dataSaver = {
  enabled: false,            // off by default
  targetVideoCodec: 'hevc',  // h264 | hevc | av1
  targetResolution: '720',   // '480' | '720' | '1080'
  maxBitrate: '1500k',       // the cap, in ffmpeg notation (as ffmpeg.maxBitrate)
}
```

Everything else (hardware acceleration, preset, CRF per codec, tone-mapping, audio codec, threads) comes from the
main FFmpeg settings, so the copy uses the same encoder, GPU and HDR handling as the normal transcode. The cap is
applied as a constrained-quality cap (`-maxrate`/`-bufsize`), not a target, so simple scenes come out smaller.

Defaults: HEVC because every iPhone since the 7 and practically every Android phone since 2017 decodes it in hardware,
and it needs roughly half the bitrate of H.264 for the same quality. 720p capped at 1.5 Mbit/s is at most 0.7 GB per
hour of video. With the default CRF (23) the encoder wants more than that for iPhone footage, so in practice the copies
sit at the cap; the hand encodes below the server row used a looser CRF and came out smaller:

| 98 s 1080p iPhone clip (IMG_8053)                 | Size   | Average bitrate | Encode time* |
| :------------------------------------------------ | -----: | --------------: | -----------: |
| Normal encode (defaults: 720p H.264, `ultrafast`) | 105 MB | 8.6 Mbit/s      | n/a          |
| Data Saver as the server made it (defaults)       | 20 MB  | 1.5 Mbit/s      | ~45 s        |
| Data Saver, HEVC 720p, cap 1500k, `ultrafast`     | 7 MB   | 0.57 Mbit/s     | 32 s         |
| Data Saver, HEVC 720p, cap 1500k, `medium`        | 9 MB   | 0.69 Mbit/s     | 62 s         |
| Data Saver, H.264 720p, cap 2500k, `medium`       | 16 MB  | 1.32 Mbit/s     | 39 s         |

\* software encoding in Docker Desktop on a MacBook Air M2 with 4 GB given to the VM.

### Job

`JobName.AssetEncodeDataSaverVideo` (per asset, `IEntityJob & { force?: boolean }`) and
`JobName.AssetEncodeDataSaverVideoQueueAll` (`IBaseJob`), both on the existing `QueueName.VideoConversion`, so they
share its concurrency and the admin's Video Conversion "Missing" / "All" buttons cover them. No new queue.

Queued, without touching `JobService.onDone` (the `JobSuccess` pattern Spatial Scene and pet detection use):

| Trigger (`JobSuccess` of …)                      | Queues                                                                 |
| :----------------------------------------------- | :--------------------------------------------------------------------- |
| `AssetEncodeVideo`, status Success **or Skipped** | `AssetEncodeDataSaverVideo { id }`. Skipped matters: an accepted-codec original gets no encode, and a 4K HEVC original is exactly the file a phone should not stream on LTE. |
| `AssetEditThumbnailGeneration` on a video        | `AssetEncodeDataSaverVideo { id, force: true }`. The trim changed or was undone, so the source changed. |
| `AssetEncodeVideoQueueAll`                       | `AssetEncodeDataSaverVideoQueueAll { force }`, so the panel buttons backfill copies too. |
| `ConfigUpdate` where `dataSaver` changed and is enabled | `AssetEncodeDataSaverVideoQueueAll { force: false }`. Turning the feature on or changing its settings backfills; the stream selects only videos whose row is missing or was made with other settings, so a no-op save re-encodes nothing. |

Handler `handleDataSaverVideo({ id, force })`:

1. Skip when the feature is off, or the asset is gone, not a video, or hidden (a live photo's motion part is never
   viewed on its own).
2. Without `force`, skip when the row exists and its `settings` match the current config.
3. Source: the edited encoded video when the asset has one (the trim), else the original (`ensureLocalFile`, so S3
   originals are staged as `handleVideoConversion` does).
4. Not needed: when the source is already at or under the target resolution and the original's bitrate is at or under
   1.25× the cap, store a row with `path = null` and stop. The route then serves the normal file. This keeps short or
   low-bitrate clips from being encoded twice for nothing.
5. Encode with `BaseConfig.create({ ...ffmpeg, targetVideoCodec, targetResolution, maxBitrate, transcode: All,
   twoPass: false }, videoInterfaces).getCommand(TranscodeTarget.All, …)`, through `mediaRepository.transcode`, with
   the same hardware-acceleration fallback order as `handleVideoConversion`.
6. Persist to the write backend at a deterministic path (`dataSaverVideoPath`: `encoded-video/<owner>/<xx>/<yy>/<id>_ds.mp4`,
   absolute on disk, relative key on S3), upsert the row, delete the previous file if its path differs.

### Storage

New fork table `asset_data_saver_video`:

| Column       | Type          | Notes                                                                 |
| :----------- | :------------ | :-------------------------------------------------------------------- |
| `assetId`    | uuid PK, FK → `asset.id` ON DELETE CASCADE | one copy per video                     |
| `path`       | text NULL     | null = not needed (source already small enough)                      |
| `settings`   | text          | `"<codec>:<resolution>:<maxBitrate>"`, to find stale copies after a settings change |
| `fromEdited` | boolean       | made from the trimmed file                                            |
| `createdAt`, `updatedAt` | timestamptz |                                                        |

No upstream table or enum changes: a new `AssetFileType` would put a value in `asset_file` that a stock Immich server
cannot read (the reason `asset_spatial_scene` is a fork table too).

- `AssetDelete`: the cascade drops the row; the handler deletes the file by its deterministic path, as Spatial Scene
  does.
- Integrity: `DataSaverVideoRepository.getPathsByPaths` is added to the tracked-path lookup next to Spatial Scene's,
  so the copies are not reported as untracked files in `encoded-video/`.
- Storage Migration: the copies move with encoded videos (counted under `encodedVideos`), streamed and re-pointed the
  same way depth maps move with previews.

### API

`GET /assets/:id/video/data-saver`, on `GalleryAssetController` (mounted before upstream's, no upstream route
change). `Permission.AssetView`, shared links allowed, range requests honoured. Serves the copy when there is one,
otherwise exactly what `/video/playback` serves (the edited encode, the encode, or the original), so a client can
always call it without a second request. `Cache-Control` follows `videoPlaybackCacheControl`.

Server feature flag `dataSaverVideo: boolean` in `ServerFeaturesDto`, true when `ffmpeg.dataSaver.enabled`. Optional
in the schema, so older apps ignore it and newer apps read a missing flag as off.

## Web

- Admin: a "Data Saver video" accordion on the Video Transcoding settings page (one render line in
  `FFmpegSettings.svelte`), with the switch, codec, resolution and cap, and help text saying it is for the mobile app
  on cellular. Indexed in the settings search.
- No viewer change (see non-goals).

## Mobile app

Shipped in the same PR as the server and web parts, as its own commit.

### Behaviour

`NativeVideoViewer._createSource` asks `RemoteVideoRoute` (`mobile/lib/gallery/video/data_saver_video.dart`) for the
URL suffix, one call in the upstream widget:

| Force original video | Server `dataSaverVideo` | Setting "Data Saver video on mobile data" | Network | Plays |
| :------------------: | :---------------------: | :---------------------------------------: | :------ | :---- |
| on                   | any                     | any                                       | any     | `/original` (unchanged) |
| off                  | false / missing         | any                                       | any     | `/video/playback` (unchanged) |
| off                  | true                    | off                                       | any     | `/video/playback` |
| off                  | true                    | on (default)                              | metered (`getCapabilities()` not `isUnmetered`) | `/video/data-saver` |
| off                  | true                    | on                                        | Wi-Fi / Ethernet | `/video/playback` |

The network check uses the existing Pigeon `ConnectivityApi` that the backup Wi-Fi gate already uses, read once when
the video opens; switching networks mid-video does not swap the stream. A metered Wi-Fi hotspot counts as mobile
data. If the network cannot be read, the normal transcode plays: a failed check costs data, never playback. A local
file still wins over both routes.

Setting: `StoreKey.dataSaverVideoOnMobileData` (bool, id 90008 in the fork block, default true), a switch in the video
viewer settings, shown only when the server advertises the feature. It is a fork `StoreKey` rather than a
`SettingsKey`, so `settings_key.dart` and `app_config.dart` stay untouched (AGENTS.md, "Fork `StoreKey` ids").

### Version pairings

| App                     | Server                          | Result |
| :---------------------- | :------------------------------ | :----- |
| this                    | this, feature on                | Data Saver copy on cellular, normal file on Wi-Fi |
| this                    | this, feature off               | Normal file (flag false) |
| this                    | older Gallery / stock Immich    | Normal file (flag missing, read as off) |
| older Gallery / stock Immich | this                       | Normal file: the route is never called; `/video/playback` is unchanged |
| stock Immich server booted on a Gallery database | —      | The fork table is ignored; copies stay on disk as untracked files until the revert script runs |

## Layering compliance

Fork-only files: the table, migration, repository, service, utils, controller route, config schema, web component,
mobile helper and tests. Hooks in upstream files, each one line or one entry:

- `dtos/config.dto.ts`: `dataSaver` in `AdminConfigFFmpegSchema`, and its defaults spread.
- `enum.ts`, `types.ts`: two `JobName` values and their job items (the same inline exception every fork job uses).
- `dtos/server.dto.ts`, `services/server.service.ts`: the feature-flag spread.
- `services/base.service.ts`, `test/utils.ts`, `test/medium.factory.ts`: repository registration.
- `services/integrity.service.ts`: the tracked-path loop.
- `services/storage-migration.service.ts`, `repositories/storage-migration.repository.ts` (fork-owned): stream and
  re-point the copies.
- `web/.../FFmpegSettings.svelte`: one render line.
- `mobile/.../video_viewer.widget.dart`: one call; `video_viewer_settings.dart`: one tile; `store.model.dart`,
  `server_features.model.dart`: one entry each (the last also one `fromDto` line).

Registered in `gallery-upstream-fks.json` (`asset_data_saver_video_assetId_fkey`) and `scripts/revert-to-immich.sql`
(drop table, ledger rows, `fork_tables_left`). `down()` drops the table: the data is derived and can be rebuilt by
re-running the job, and the files are found by their deterministic paths.

## i18n

New keys under `i18n/gallery/` for the admin accordion and the mobile setting.

## Testing

- Unit (`data-saver-video.service.spec.ts`): each trigger in the table above queues what it says and nothing else;
  the handler skips (off, missing, image, hidden, current settings), stores `path = null` when not needed, encodes
  from the edited file when there is one, builds the ffmpeg command with the overridden codec/resolution/cap, persists
  to S3 (write backend mocked), deletes the old file when the path changes, and the delete handler removes the file.
  Route: serves the copy, falls back to the encode and then the original, enforces access.
- Medium: repository `upsert` / `get` / `streamForQueue` (missing and stale-settings selection) / `getPathsByPaths`;
  migration up and down.
- Guards: FK registry spec, revert spec, `merge.mjs --check`, ownership.
- Web: component spec for the accordion.
- Mobile (`test/gallery/video/data_saver_video_test.dart`): the decision table above as a unit test of
  `RemoteVideoRoute`, including a metered hotspot and an unreadable network; the server flag read and missing; the
  switch's default and persistence; the settings tile hidden without the flag and writing the switch.
- Manual: the clip in the Config table, encoded with the copy's settings by the server image's ffmpeg.

## Open questions

1. Name: "Data Saver video" vs "cellular copy". The setting is about metered networks, which covers hotspots too.
2. Should the copy get its own preset? It inherits the main one, `ultrafast` by default. On the clip above `medium`
   took twice as long for a copy that is still under 1 Mbit/s; a capped `ultrafast` encode spends its bits less
   evenly, which shows in motion. This design inherits the main preset and leaves that to the admin.
3. Reuse `QueueName.VideoConversion` (this design) or a separate queue so the copies can run at lower priority?
4. Should the copy get its own CRF? It inherits the main one (23), which keeps iPhone footage at the cap. Five
   clips on a trial server came out at 7-19% of the normal encode; a looser CRF for the copy would shrink calm scenes
   further, at some cost in detail.
