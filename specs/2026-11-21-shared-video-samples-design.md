# Shared video samples

Human and pet video detection run in independent jobs. Both previously probed and staged the source, searched for
scene cuts and extracted their own frames, deleting samples as tracking progressed. Recognition already consumes
stored embeddings; it does not replay the source video.

## Decision

Keep the jobs, model calls, trackers and persistence separate. Wrap their `VideoFrameReader` extraction and scene
analysis in `CachedVideoFrames`, backed by a disposable `VideoSampleCache` on the worker's temporary filesystem.
This saves duplicate video extraction and scene analysis when the jobs request the same samples, without making
one model's availability or results a dependency of the other.

The cache shares **whole frames**, not face crops. A pet detector needs pixels outside human face boxes. Each job
gets an independent copy in its existing temporary directory (using a copy-on-write filesystem clone where
available). Existing early unlink, sharpness measurement, tiled detection, best-frame persistence and final
cleanup therefore continue unchanged. Even eviction during detection cannot remove a consumer's copy.

## Identity and compatibility

A source key includes asset id, owner id, the original's content checksum, and trim start/end. Frame keys also
include the requested timestamp rounded to ffmpeg's millisecond seek precision, ffmpeg configuration and probed
video stream information. Local staging paths do not participate: separately staged S3 copies of one original
can share extracted samples. Missing checksums bypass caching. The cache root is versioned; changes to extraction
or scene analysis semantics require incrementing its version.

Sampling intervals, scene-cut settings, maximum frame counts, model names and recognition thresholds remain each
job's own choices. Common timestamps reuse pixels; different timestamps produce extra samples. Human-only extra
samples used to select a sharper face are cached as well. Different plans, including the different default frame
caps on long videos, need not overlap, so this does not guarantee one decode for every requested sample plan.
Scene analysis is cached independently of whether a particular caller requests it.

The implementation and lifecycle service live in fork files. Existing fork repository reads additionally select
the original checksum, with their generated SQL documentation updated. The upstream `ServerSettings.svelte` adds
only an import and one component call: its diff against `refs/upstream/v3.4.2` grows from 9 to 11 added lines
(+2, no deletions). The controls and settings
search registration live in fork files. `docs/fork/ownership.yml` explicitly owns the cache modules and records
the upstream settings adapter under `shared-video-samples`. OpenAPI and TypeScript/Dart clients are regenerated from the schema. No
migrations or authorization rules change. Cache controls are an optional `server.videoSampleCache` block in the
admin config API. Older admin clients omit that block; the existing config-body interceptor preserves its
stored values. New web clients hide the controls against servers without the block. Stock Immich clients keep
their existing behavior, and stock Immich servers ignore the temporary files.

## Lifetime and capacity

The default root is `gallery-video-samples-v1` inside Node's temporary directory. Root and lock directories are
private to the server account. By default, retained sample files have a 2 GiB logical-byte budget, split over sixteen
hash shards. Each shard evicts its least recently used entries before publishing a replacement. Sharding bounds
both directory scans and lock contention; unused capacity in another shard is not borrowed. A single sample larger
than its shard budget is used directly and not cached.

Administrators can change the size and retention in **Server Settings → Shared video sample cache**. Size is
specified in GiB (0–1024; fractional GiB supported), with 0 disabling caching. Retention is specified in whole hours
(1–8760). Defaults remain 2 GiB and 24 hours. The settings are admin-only and are included in config-file defaults.
A fork lifecycle service applies them on worker config initialization and propagated config updates, without a
restart. Reducing a limit immediately prunes retained entries; disabling also clears retained samples. Running
jobs keep their independent frame copies, and subsequent reads/publications use the updated policy. Optional
cleanup failures are logged and do not reject a configuration save or prevent startup.

By default, entries expire after 24 hours without reuse. Hits refresh their last-used time. Reads reject expired entries;
publication prunes them, and a ten-minute background sweep also collects them during idle periods while the worker
is running. The timer starts on worker configuration or first use and does not keep the process alive. The budget covers retained cache
files; consumers' existing temporary copies and atomic-publication staging files are additional in-flight space.
No extracted sample is permanent or written to S3 by this cache. Retained best-view images continue to follow the
existing asset lifecycle. Deleted assets' cache entries become unreachable and expire under the same policy.

## Concurrency and failure

Filesystem locks coordinate instances and Node processes sharing the same temporary directory. A unique non-empty
claim directory is atomically renamed to acquire a lock. Entry locks suppress duplicate producers; brief shard
locks protect copying, publication, accounting and eviction. A producer writes the consumer's output first, then
copies it to a unique staging file and atomically publishes it. Failed extraction never publishes partial output.

Owner tokens heartbeat every twenty seconds. Tokens untouched for sixty seconds can be reclaimed, including
abandoned claims during sweeps. Release removes only its own token and removes a lock directory only when empty,
so an old owner cannot release a replacement owner's lock. Paused workers or a lock wait exceeding thirty seconds
may cause duplicate extraction; no job waits indefinitely for this optimization. Independent source extraction
and cache storage errors are distinguished: producer failures propagate normally, while unavailable cache storage,
copy errors, capacity pressure or lock timeouts fall back to the normal extraction path.

Completion logs include the number of frame extractions reused, to verify whether a workload benefits. Models
still run independently. Original staging and probing still happen in each job, so S3 originals can still be
downloaded twice. Separate worker containers with separate temporary filesystems do not share samples. This
change does not claim a particular wall-clock speedup; ffmpeg extraction already overlaps with ML inference.

## Verification

Tests exercise real human and pet job handlers in either order and concurrently, proving four sample extractions
and one scene analysis serve both models while both retain their independent model calls and result writes.
Filesystem tests cover independent cache instances, separate Node processes, private consumer copies, producer
failure/retry, expiration, eviction, oversized entries, unavailable storage, bounded waits and abandoned lock
recovery. Reader tests cover source/trim/config invalidation, independent S3 staging paths, extra timestamps,
empty/corrupt scene analysis and absent fingerprints. Configuration tests cover validation, admin-only projection,
startup/live application, old-client preservation, disabling, reducing retention and shrinking/growing the budget.
Browser tests cover draft binding (including size 0), config-file disabling and older-server hiding. Existing video detection and frame-reader tests remain in place.
