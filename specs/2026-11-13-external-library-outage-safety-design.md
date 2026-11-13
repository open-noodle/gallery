# External-library outage safety

## Problem and evidence

External-library watcher unlink jobs call `AssetRepository.remove` directly. A mount disappearing can therefore become irreversible database deletion. Scheduled missing-file checks and exclusion reconciliation also set `deletedAt` on active assets, making temporary inaccessibility eligible for later expiry. The incident motivating this fix included unavailable bind mounts, overnight offlining, subsequent audited record deletions, and re-imported UUIDs. The exact historical unlink events were not retained; attribution of every deletion to the watcher is not proven.

## Required behavior

- Filesystem unlink notifications are hints, not deletion authorization.
- An unlink job checks for a readable containing import root and rechecks the original. An unavailable root or a now-accessible original causes no record mutation. Path containment is component-aware, not a string prefix.
- A missing or unreadable individual original under an accessible root is marked offline only. Its UUID, explicit trash status, deletion timestamp, metadata, and media associations are preserved.
- Scheduled missing-file checks and exclusion/import-path reconciliation set offline without starting trash expiry. Scans may mark assets offline during a drive outage; this is reversible and does not authorize deletion.
- Returning originals at the same path are reconciled onto their existing records. Explicitly trashed assets are not implicitly restored.
- Automatic expiry requires explicit Trashed or Deleted status and the existing inclusive retention cutoff. This protects legacy Active rows with `deletedAt`; explicitly trashed offline assets remain eligible.

## Design and tradeoffs

Gallery helpers own the watcher reconciliation and deletion-eligibility policy. Upstream services/repositories receive narrow call hooks, plus the shared offline-only update. This deliberately changes inherited hard-delete behavior for data safety. The upstream-file divergence grows by those hooks; it removes the old inline watcher deletion block. Existing upstream contract tests change only where the offline contract changed; fork regressions live in sibling Gallery specs and the Gallery medium-test namespace.

Retaining records for genuinely removed originals uses database space until explicit removal. A root that disconnects after the availability check can still cause reversible offlining, but cannot authorize hard deletion. Reconnects may require restoring stale container bind mounts and rescanning. There is no automatic restoration of already deleted records or repair of thumbnails in this patch.

## Compatibility

No schema, API, or sync payload changes. Old Gallery clients, new Gallery clients, and stock Immich clients retain their existing wire contracts; originals unavailable on disk remain unavailable. The safety behavior is server-side and only applies while running this patched Gallery server. Switching to stock Immich restores its own watcher/deletion policy.

## Test-driven verification

Before fixes, service regressions observed four failures: outage unlink, individual missing-file unlink, stale unlink, and scheduled-scan trash timestamp. The existing same-ID reconnect control passed. With original repository behavior restored temporarily, two real-Postgres regressions failed: expiry selected Active records and exclusion reconciliation assigned a deletion timestamp.

After fixes: 86 focused service tests passed; two real-Postgres tests passed. The database selection matrix covers Active/Trashed/Deleted, online/offline, and null/expired/recent deletion timestamps. Further service regressions cover explicit trash preservation and sibling-path containment. Focused ESLint passed. Full TypeScript checking and an additional existing repository contract run timed out locally; no successful result is claimed for either.
