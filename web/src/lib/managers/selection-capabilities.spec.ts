import type { AlbumResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import type {
  AlbumContext,
  CommandContext,
  SelectionCommandContext,
  SpaceContext,
} from '$lib/managers/command-context-manager.svelte';
import { getSelectionCapabilities, type SelectionCapabilities } from './selection-capabilities';

// ---------------------------------------------------------------------------
// Fixture factories — build the minimal CommandContext shape the pure rule
// engine reads. Only the fields getSelectionCapabilities actually consumes
// are meaningful; everything else is a stable default.
// ---------------------------------------------------------------------------

const makeSelection = (overrides: Partial<SelectionCommandContext> = {}): SelectionCommandContext => ({
  assets: [],
  selectedAssetIds: ['asset-1'],
  ownedAssets: [],
  ownedSelectedAssetIds: [],
  canAddToAlbum: false,
  canAddToSpace: false,
  isAllUserOwned: true,
  isAllFavorite: false,
  isAllArchived: false,
  isAllTrashed: false,
  clearSelection: () => {},
  ...overrides,
});

const makeAlbum = (overrides: Partial<AlbumContext> = {}): AlbumContext => ({
  id: 'album-1',
  albumName: 'Album',
  ownerId: 'u-owner',
  isOwner: false,
  isEditor: false,
  isMember: true,
  raw: {} as unknown as AlbumResponseDto,
  ...overrides,
});

const makeSpace = (overrides: Partial<SpaceContext> = {}): SpaceContext => ({
  id: 'space-1',
  name: 'Space',
  createdById: 'u-owner',
  isOwner: false,
  isMember: true,
  canWrite: false,
  raw: {} as unknown as SharedSpaceResponseDto,
  members: [],
  ...overrides,
});

const makeCtx = (overrides: Partial<CommandContext> = {}): CommandContext => ({
  routeId: null,
  params: {},
  album: null,
  space: null,
  selection: makeSelection(),
  userId: 'u-me',
  isAdmin: false,
  ...overrides,
});

const ALL_FALSE: SelectionCapabilities = {
  canSelectAll: false,
  canDownload: false,
  canShare: false,
  canAddToAlbum: false,
  canFavorite: false,
  canEditMetadata: false,
  canTag: false,
  canDelete: false,
  canSetCover: false,
  canRemoveFromAlbum: false,
  canRemoveFromSpace: false,
};

// ---------------------------------------------------------------------------
// Space timeline (direct space): album === null, space !== null
// ---------------------------------------------------------------------------

describe('getSelectionCapabilities — space timeline (direct space)', () => {
  it("E1: Given a space viewer selecting another member's asset, When capabilities resolve, Then only select-all and download are allowed", () => {
    const ctx = makeCtx({
      space: makeSpace({ canWrite: false }),
      selection: makeSelection({ isAllUserOwned: false, selectedAssetIds: ['asset-1'] }),
    });

    expect(getSelectionCapabilities(ctx, true)).toEqual({
      ...ALL_FALSE,
      canSelectAll: true,
      canDownload: true,
    });
  });

  it('E2: Given a space editor selecting their own single asset, When capabilities resolve, Then every capability is allowed', () => {
    const ctx = makeCtx({
      space: makeSpace({ canWrite: true }),
      selection: makeSelection({ isAllUserOwned: true, selectedAssetIds: ['asset-1'] }),
    });

    expect(getSelectionCapabilities(ctx, true)).toEqual({
      canSelectAll: true,
      canDownload: true,
      canShare: true,
      canAddToAlbum: true,
      canFavorite: true,
      canEditMetadata: true,
      canTag: true,
      canDelete: true,
      canSetCover: true,
      canRemoveFromAlbum: false,
      canRemoveFromSpace: true,
    });
  });

  it("E3: Given a space editor selecting another member's asset, When capabilities resolve, Then role actions (remove-from-space, set-cover) are allowed but owner-gated actions are denied", () => {
    const ctx = makeCtx({
      space: makeSpace({ canWrite: true }),
      selection: makeSelection({ isAllUserOwned: false, selectedAssetIds: ['asset-1'] }),
    });

    expect(getSelectionCapabilities(ctx, true)).toEqual({
      canSelectAll: true,
      canDownload: true,
      canShare: false,
      canAddToAlbum: false,
      canFavorite: false,
      canEditMetadata: false,
      canTag: false,
      canDelete: false,
      canSetCover: true,
      canRemoveFromAlbum: false,
      canRemoveFromSpace: true,
    });
  });

  it("E4: Given a space owner selecting another member's asset, When capabilities resolve, Then role actions are allowed but owner-gated actions are denied (orthogonality: space role is independent of asset ownership)", () => {
    const ctx = makeCtx({
      space: makeSpace({ isOwner: true, canWrite: true }),
      selection: makeSelection({ isAllUserOwned: false, selectedAssetIds: ['asset-1'] }),
    });

    const caps = getSelectionCapabilities(ctx, true);
    expect(caps.canRemoveFromSpace).toBe(true);
    expect(caps.canSetCover).toBe(true);
    expect(caps.canShare).toBe(false);
    expect(caps.canAddToAlbum).toBe(false);
    expect(caps.canFavorite).toBe(false);
    expect(caps.canEditMetadata).toBe(false);
    expect(caps.canTag).toBe(false);
    expect(caps.canDelete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Space album: album !== null, space !== null
// ---------------------------------------------------------------------------

describe('getSelectionCapabilities — space album', () => {
  it("E5: Given a space viewer who is the space album's album-editor, When capabilities resolve, Then canRemoveFromAlbum is allowed via album.isEditor even though the space role is a viewer", () => {
    const ctx = makeCtx({
      space: makeSpace({ canWrite: false }),
      album: makeAlbum({ isOwner: false, isEditor: true }),
      selection: makeSelection({ isAllUserOwned: false }),
    });

    expect(getSelectionCapabilities(ctx, true).canRemoveFromAlbum).toBe(true);
  });

  it('E6: Given a space editor who is not an album member, When capabilities resolve, Then canRemoveFromAlbum is allowed via space.canWrite', () => {
    const ctx = makeCtx({
      space: makeSpace({ canWrite: true }),
      album: makeAlbum({ isOwner: false, isEditor: false, isMember: false }),
      selection: makeSelection({ isAllUserOwned: false }),
    });

    expect(getSelectionCapabilities(ctx, true).canRemoveFromAlbum).toBe(true);
  });

  it('E16: Given a space viewer (non-manager) selecting their own asset in a space album, When capabilities resolve, Then owner-gated actions are allowed but canRemoveFromAlbum and canSetCover are denied (decision C: role-gated only, no own-asset arm)', () => {
    const ctx = makeCtx({
      space: makeSpace({ canWrite: false }),
      album: makeAlbum({ isOwner: false, isEditor: false }),
      selection: makeSelection({ isAllUserOwned: true, selectedAssetIds: ['asset-1'] }),
    });

    const caps = getSelectionCapabilities(ctx, true);
    expect(caps.canShare).toBe(true);
    expect(caps.canAddToAlbum).toBe(true);
    expect(caps.canFavorite).toBe(true);
    expect(caps.canEditMetadata).toBe(true);
    expect(caps.canTag).toBe(true);
    expect(caps.canDelete).toBe(true);
    expect(caps.canRemoveFromAlbum).toBe(false);
    expect(caps.canSetCover).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting edge cases
// ---------------------------------------------------------------------------

describe('getSelectionCapabilities — cross-cutting edge cases', () => {
  it('E7: Given a mixed-ownership selection (some owned, some not), When capabilities resolve, Then every owner-gated action and Share/Add-to-album are denied while select-all/download remain allowed', () => {
    const ctx = makeCtx({ selection: makeSelection({ isAllUserOwned: false }) });

    const caps = getSelectionCapabilities(ctx, true);
    expect(caps.canSelectAll).toBe(true);
    expect(caps.canDownload).toBe(true);
    expect(caps.canShare).toBe(false);
    expect(caps.canAddToAlbum).toBe(false);
    expect(caps.canFavorite).toBe(false);
    expect(caps.canEditMetadata).toBe(false);
    expect(caps.canTag).toBe(false);
    expect(caps.canDelete).toBe(false);
  });

  it('E8: Given a multi-asset selection with an otherwise fully-permitted role and ownership, When capabilities resolve, Then canSetCover is denied because set-cover requires a single selection', () => {
    const ctx = makeCtx({
      space: makeSpace({ canWrite: true }),
      selection: makeSelection({ isAllUserOwned: true, selectedAssetIds: ['asset-1', 'asset-2'] }),
    });

    const caps = getSelectionCapabilities(ctx, true);
    expect(caps.canSetCover).toBe(false);
    expect(caps.canFavorite).toBe(true);
    expect(caps.canRemoveFromSpace).toBe(true);
  });

  it('E9/E10: Given the selection is all-favorite or all-archived, When capabilities resolve, Then canFavorite/canEditMetadata are unchanged — the rule engine is ownership-only; favorite/archive LABEL flipping ("remove from favorites" vs "favorite") is an asset-state UI concern the component owns, not this function', () => {
    const favoriteCaps = getSelectionCapabilities(
      makeCtx({ selection: makeSelection({ isAllUserOwned: true, isAllFavorite: true }) }),
      true,
    );
    const notFavoriteCaps = getSelectionCapabilities(
      makeCtx({ selection: makeSelection({ isAllUserOwned: true, isAllFavorite: false }) }),
      true,
    );
    expect(favoriteCaps.canFavorite).toBe(true);
    expect(notFavoriteCaps.canFavorite).toBe(true);

    const archivedCaps = getSelectionCapabilities(
      makeCtx({ selection: makeSelection({ isAllUserOwned: true, isAllArchived: true }) }),
      true,
    );
    const notArchivedCaps = getSelectionCapabilities(
      makeCtx({ selection: makeSelection({ isAllUserOwned: true, isAllArchived: false }) }),
      true,
    );
    expect(archivedCaps.canEditMetadata).toBe(true);
    expect(notArchivedCaps.canEditMetadata).toBe(true);
  });

  it('E11: Given tagsEnabled is false, When capabilities resolve for an all-owned selection, Then canTag is denied even though every other owner-gated action is allowed', () => {
    const ctx = makeCtx({ selection: makeSelection({ isAllUserOwned: true }) });

    const caps = getSelectionCapabilities(ctx, false);
    expect(caps.canTag).toBe(false);
    expect(caps.canFavorite).toBe(true);
    expect(caps.canShare).toBe(true);
  });

  it('E12: Given no registered selection (ctx.selection === null), When capabilities resolve, Then every capability is denied and no toolbar is rendered', () => {
    const ctx = makeCtx({ selection: null });

    expect(getSelectionCapabilities(ctx, true)).toEqual(ALL_FALSE);
  });

  it('E14: Given the personal timeline with an all-owned selection, When capabilities resolve, Then the full owner set is allowed but container actions (set-cover / remove) are denied because there is no album or space', () => {
    const ctx = makeCtx({
      album: null,
      space: null,
      selection: makeSelection({ isAllUserOwned: true, selectedAssetIds: ['asset-1'] }),
    });

    const caps = getSelectionCapabilities(ctx, true);
    expect(caps.canShare).toBe(true);
    expect(caps.canAddToAlbum).toBe(true);
    expect(caps.canFavorite).toBe(true);
    expect(caps.canEditMetadata).toBe(true);
    expect(caps.canTag).toBe(true);
    expect(caps.canDelete).toBe(true);
    expect(caps.canSetCover).toBe(false);
    expect(caps.canRemoveFromAlbum).toBe(false);
    expect(caps.canRemoveFromSpace).toBe(false);
  });

  it('E15: Given a regular shared album with the album owner selecting their own single asset, When capabilities resolve, Then the full album reference model is granted', () => {
    const ctx = makeCtx({
      album: makeAlbum({ isOwner: true, isEditor: false }),
      space: null,
      selection: makeSelection({ isAllUserOwned: true, selectedAssetIds: ['asset-1'] }),
    });

    expect(getSelectionCapabilities(ctx, true)).toEqual({
      canSelectAll: true,
      canDownload: true,
      canShare: true,
      canAddToAlbum: true,
      canFavorite: true,
      canEditMetadata: true,
      canTag: true,
      canDelete: true,
      canSetCover: true,
      canRemoveFromAlbum: true,
      canRemoveFromSpace: false,
    });
  });

  it('E17: Given an admin who is neither the asset owner nor holds an album/space role, When capabilities resolve, Then the result is identical to a non-admin in the same role/ownership state (isAdmin is never consulted)', () => {
    const base: Partial<CommandContext> = {
      album: makeAlbum({ isOwner: false, isEditor: false }),
      space: null,
      selection: makeSelection({ isAllUserOwned: false }),
    };

    const adminCaps = getSelectionCapabilities(makeCtx({ ...base, isAdmin: true }), true);
    const nonAdminCaps = getSelectionCapabilities(makeCtx({ ...base, isAdmin: false }), true);
    expect(adminCaps).toEqual(nonAdminCaps);
  });
});

// ---------------------------------------------------------------------------
// Parity guard — protects against silent drift from the album reference model.
// For equivalent role + ownership, space capability sets must equal the album
// capability set except for the two documented, server-enforced deviations.
// ---------------------------------------------------------------------------

describe('getSelectionCapabilities — album/space parity guard', () => {
  const roles = ['owner', 'editor', 'viewer'] as const;
  const ownerships = [true, false] as const;

  for (const role of roles) {
    for (const isAllUserOwned of ownerships) {
      const label = `${role} role, ${isAllUserOwned ? 'all-owned' : 'none-owned'} selection`;

      it(`${label}: owner-gated + universal capabilities are identical across regular-album, space-timeline, and space-album`, () => {
        const sel = makeSelection({ isAllUserOwned, selectedAssetIds: ['asset-1'] });
        const canWrite = role === 'owner' || role === 'editor';

        const regularAlbumCtx = makeCtx({
          album: makeAlbum({ isOwner: role === 'owner', isEditor: role === 'editor' }),
          space: null,
          selection: sel,
        });
        const spaceTimelineCtx = makeCtx({
          album: null,
          space: makeSpace({ isOwner: role === 'owner', canWrite }),
          selection: sel,
        });
        const spaceAlbumCtx = makeCtx({
          album: makeAlbum({ isOwner: false, isEditor: false }),
          space: makeSpace({ isOwner: role === 'owner', canWrite }),
          selection: sel,
        });

        const albumCaps = getSelectionCapabilities(regularAlbumCtx, true);
        const spaceCaps = getSelectionCapabilities(spaceTimelineCtx, true);
        const spaceAlbumCaps = getSelectionCapabilities(spaceAlbumCtx, true);

        const universalFields = [
          'canSelectAll',
          'canDownload',
          'canShare',
          'canAddToAlbum',
          'canFavorite',
          'canEditMetadata',
          'canTag',
          'canDelete',
        ] as const;

        for (const field of universalFields) {
          expect(spaceCaps[field]).toBe(albumCaps[field]);
          expect(spaceAlbumCaps[field]).toBe(albumCaps[field]);
        }

        // canSetCover is role+single-only (no ownership arm) — identical across every
        // surface given the matching role -> canWrite/isOwner/isEditor mapping above.
        expect(spaceCaps.canSetCover).toBe(albumCaps.canSetCover);
        expect(spaceAlbumCaps.canSetCover).toBe(albumCaps.canSetCover);
      });
    }
  }

  it('deviation (a): on a direct-space surface, canRemoveFromAlbum is replaced by canRemoveFromSpace, which is role-only (no own-asset arm) — an editor can remove-from-space a non-owned asset, but the album-equivalent (a non-owner editor) cannot remove-from-album', () => {
    const nonOwnedSel = makeSelection({ isAllUserOwned: false });
    const albumEditorCtx = makeCtx({
      album: makeAlbum({ isOwner: false, isEditor: true }),
      space: null,
      selection: nonOwnedSel,
    });
    const spaceEditorCtx = makeCtx({ album: null, space: makeSpace({ canWrite: true }), selection: nonOwnedSel });

    expect(getSelectionCapabilities(albumEditorCtx, true).canRemoveFromAlbum).toBe(false);
    expect(getSelectionCapabilities(spaceEditorCtx, true).canRemoveFromSpace).toBe(true);
    // The field belonging to the other surface never appears.
    expect(getSelectionCapabilities(albumEditorCtx, true).canRemoveFromSpace).toBe(false);
    expect(getSelectionCapabilities(spaceEditorCtx, true).canRemoveFromAlbum).toBe(false);
  });

  it("deviation (b): a space album's canRemoveFromAlbum is canManage-only (decision C — no own-asset arm), unlike the regular album which also lets a non-manager remove their OWN asset", () => {
    const ownAssetSel = makeSelection({ isAllUserOwned: true });
    const albumViewerOwnAssetCtx = makeCtx({
      album: makeAlbum({ isOwner: false, isEditor: false }),
      space: null,
      selection: ownAssetSel,
    });
    const spaceAlbumViewerOwnAssetCtx = makeCtx({
      album: makeAlbum({ isOwner: false, isEditor: false }),
      space: makeSpace({ canWrite: false }),
      selection: ownAssetSel,
    });

    expect(getSelectionCapabilities(albumViewerOwnAssetCtx, true).canRemoveFromAlbum).toBe(true);
    expect(getSelectionCapabilities(spaceAlbumViewerOwnAssetCtx, true).canRemoveFromAlbum).toBe(false);
  });

  it('Share and Add-to-album are isAllUserOwned on every surface, so personal/album/space/space-album contexts always agree', () => {
    for (const isAllUserOwned of ownerships) {
      const sel = makeSelection({ isAllUserOwned });
      const personalCaps = getSelectionCapabilities(makeCtx({ selection: sel }), true);
      const albumCaps = getSelectionCapabilities(makeCtx({ album: makeAlbum(), selection: sel }), true);
      const spaceCaps = getSelectionCapabilities(makeCtx({ space: makeSpace(), selection: sel }), true);
      const spaceAlbumCaps = getSelectionCapabilities(
        makeCtx({ album: makeAlbum(), space: makeSpace(), selection: sel }),
        true,
      );

      expect(albumCaps.canShare).toBe(personalCaps.canShare);
      expect(spaceCaps.canShare).toBe(personalCaps.canShare);
      expect(spaceAlbumCaps.canShare).toBe(personalCaps.canShare);
      expect(albumCaps.canAddToAlbum).toBe(personalCaps.canAddToAlbum);
      expect(spaceCaps.canAddToAlbum).toBe(personalCaps.canAddToAlbum);
      expect(spaceAlbumCaps.canAddToAlbum).toBe(personalCaps.canAddToAlbum);
    }
  });
});
