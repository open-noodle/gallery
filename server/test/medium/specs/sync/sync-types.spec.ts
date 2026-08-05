import { SyncRequestType } from 'src/enum';
import { SYNC_TYPES_ORDER } from 'src/services/sync.service';

describe('types', () => {
  it('should have all the types in the ordering variable', () => {
    for (const key in SyncRequestType) {
      expect(SYNC_TYPES_ORDER.includes(key as SyncRequestType)).toBe(true);
    }

    expect(SYNC_TYPES_ORDER.length).toBe(Object.keys(SyncRequestType).length);
  });

  it('should ensure album follows albums assets', () => {
    const albumIndex = SYNC_TYPES_ORDER.indexOf(SyncRequestType.AlbumsV1);
    const albumAssetsIndex = SYNC_TYPES_ORDER.indexOf(SyncRequestType.AlbumAssetsV1);

    expect(albumIndex).toBeGreaterThan(albumAssetsIndex);
  });

  // Regression guard: mobile's space-detail Drift query joins
  // shared_space_library with remote_asset on library_id, so the link rows
  // MUST arrive before the bulky library asset rows. Otherwise the JOIN is
  // empty until the end of the sync pass and a 40k-asset library-backed space
  // looks blank for the ~60 s the backfill takes. See the mobile space
  // slowness investigation.
  it('should stream shared_space_library links before library assets', () => {
    const linkIndex = SYNC_TYPES_ORDER.indexOf(SyncRequestType.SharedSpaceLibrariesV1);
    const assetsIndex = SYNC_TYPES_ORDER.indexOf(SyncRequestType.LibraryAssetsV1);

    expect(linkIndex).toBeLessThan(assetsIndex);
  });

  // Regression guard: the SYNC_TYPES_ORDER comment in sync.service.ts says album folders must land
  // before album links so mobile never renders an album flat at the root for one frame and then
  // re-nests it once the folder sync catches up.
  it('should stream shared space album folders before shared space album links', () => {
    const folderIndex = SYNC_TYPES_ORDER.indexOf(SyncRequestType.SharedSpaceAlbumFoldersV1);
    const linkIndex = SYNC_TYPES_ORDER.indexOf(SyncRequestType.SharedSpaceAlbumLinksV1);

    expect(folderIndex).toBeLessThan(linkIndex);
  });
});
