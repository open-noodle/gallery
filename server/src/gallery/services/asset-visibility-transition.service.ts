import { Injectable } from '@nestjs/common';
import type { ArgOf } from 'src/repositories/event.repository.js';
import { OnEvent } from 'src/decorators.js';
import { AssetVisibility } from 'src/enum.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { BaseService } from 'src/services/base.service.js';

/**
 * Runs every #757 visibility-transition side-effect (removeAssetsFromAll on Locked + the direct/album/
 * library space purge/restore emits). Shared by updateAll (bulk), update (single) and the AssetHide/
 * AssetShow event handlers (motion photos).
 *
 * correctness-6 — NOT wrapped in a Kysely transaction: the UPDATE, removeAssetsFromAll and each emit run
 * on a DIFFERENT repository's own `this.db` handle, so a single `transaction()` would hit the
 * `this.db`-inside-`transaction()` pool deadlock (#595). Resilience instead comes from the purge being
 * UNCONDITIONAL-AND-IDEMPOTENT on a non-shareable next (M3): it no longer depends on the prior visibility
 * read before the write, so a retry that re-reads an already-Hidden/Locked asset (e.g. after a crash or a
 * failed emit) re-affirms the tombstone rather than silently no-op'ing. Re-running emits the same audit
 * rows harmlessly. A crash between the UPDATE and the emits therefore leaves a RECOVERABLE state (re-run
 * converges), not a corrupted one.
 */
export async function applyVisibilityTransitionSideEffects(
  {
    albumRepository,
    sharedSpaceRepository,
  }: { albumRepository: AlbumRepository; sharedSpaceRepository: SharedSpaceRepository },
  ids: string[],
  nextVisibility: AssetVisibility,
  priorVisibilities: Map<string, AssetVisibility | undefined>,
): Promise<void> {
  const shareable = (v: AssetVisibility | undefined) => v === AssetVisibility.Timeline || v === AssetVisibility.Archive;

  if (nextVisibility === AssetVisibility.Timeline || nextVisibility === AssetVisibility.Archive) {
    // Restore: only assets whose PRIOR was non-shareable (Hidden/Locked) cross back in. A shareable→
    // shareable move (e.g. Timeline↔Archive, unarchive re-affirm) is not a crossing → no emit.
    const restoreIds = ids.filter((id) => !shareable(priorVisibilities.get(id)));
    if (restoreIds.length > 0) {
      await sharedSpaceRepository.emitDirectAssetVisibilityRestore(restoreIds);
      await sharedSpaceRepository.emitAlbumAssetVisibilityRestore(restoreIds);
      // L4: the library ASSET ROW restore is automatic (the visibility UPDATE bumped asset.updateId),
      // but its EXIF is not — asset_exif.updateId is untouched by a visibility flip, so without this
      // emit a restored library asset would show empty EXIF forever on an already-synced member device.
      await sharedSpaceRepository.emitLibraryAssetVisibilityRestore(restoreIds);
    }
    return;
  }

  // nextVisibility is non-shareable (Hidden or Locked).
  // M-1: strip album membership UNCONDITIONALLY on Locked — do NOT gate on prior !== Locked. The old
  // "lock-once" gate was not retry-convergent: a crash between the visibility UPDATE and this strip left
  // the album_asset rows in place with no tombstone, and on retry priorVisibilities read Locked so the
  // strip was skipped FOREVER — a durable on-device leak, plus a silent re-share into the space when the
  // asset was later unlocked (the surviving album_asset rows were restored). Calling removeAssetsFromAll
  // on every id is idempotent: an already-stripped asset matches zero rows (a no-op), while a
  // crashed-first-attempt asset gets its surviving rows deleted and the album delete-audit trigger fires
  // the tombstone the crashed attempt never sent (delivered via SharedSpaceAlbumToAssetSync.getDeletes).
  // Keep the empty-batch guard (removeAssetsFromAll has none — an empty `IN ()` is invalid SQL), matching
  // the purge/restore branches in this method.
  if (nextVisibility === AssetVisibility.Locked && ids.length > 0) {
    await albumRepository.removeAssetsFromAll(ids);
  }

  // Purge: unconditional on every id whenever nextVisibility is non-shareable (M3, retry-convergent).
  // This branch already guarantees nextVisibility ∈ {Hidden, Locked}, so we don't need to know the prior
  // to decide whether to purge — a re-affirm (Hidden→Hidden, Locked→Locked) re-emits the same tombstone,
  // which is harmless (idempotent) and is exactly what lets a retry after a failed emit converge.
  const purgeIds = ids;
  if (purgeIds.length === 0) {
    return;
  }

  await sharedSpaceRepository.emitDirectAssetVisibilityPurge(purgeIds);
  if (nextVisibility === AssetVisibility.Hidden) {
    // Locked's album removal is handled by removeAssetsFromAll above → no album tombstone for Locked.
    await sharedSpaceRepository.emitAlbumAssetVisibilityPurge(purgeIds);
  }
  await sharedSpaceRepository.emitLibraryAssetVisibilityPurge(purgeIds);
}

@Injectable()
export class AssetVisibilityTransitionService extends BaseService {
  // Motion-photo bypass: the live-photo/motion paths (asset.util onBeforeLink/onAfterUnlink,
  // metadata linkLivePhotos, metadata extraction-hide) flip a motion video's visibility directly and emit
  // AssetHide/AssetShow — but nothing routed those to the #757 space purge, so a motion video in a
  // space-linked library kept its bytes on member devices. AssetHide/AssetShow fire only on a genuine
  // Timeline↔Hidden crossing, so we run the same transition side-effects for the single asset.
  @OnEvent({ name: 'AssetHide' })
  async onAssetHide({ assetId }: ArgOf<'AssetHide'>): Promise<void> {
    // AssetHide fires only on Timeline→Hidden → seed a shareable prior so it registers as a crossing.
    await applyVisibilityTransitionSideEffects(
      { albumRepository: this.albumRepository, sharedSpaceRepository: this.sharedSpaceRepository },
      [assetId],
      AssetVisibility.Hidden,
      new Map([[assetId, AssetVisibility.Timeline]]),
    );
  }

  @OnEvent({ name: 'AssetShow' })
  async onAssetShow({ assetId }: ArgOf<'AssetShow'>): Promise<void> {
    await applyVisibilityTransitionSideEffects(
      { albumRepository: this.albumRepository, sharedSpaceRepository: this.sharedSpaceRepository },
      [assetId],
      AssetVisibility.Timeline,
      new Map([[assetId, AssetVisibility.Hidden]]),
    );
  }
}
