import { AssetStatus, AssetVisibility } from 'src/enum.js';
import { restoredState, type UndonePhoto, type UndoneVersion } from 'src/gallery/utils/asset-version-undo.js';

// What a version returns to when versions are undone: every combination of how its photo is now and how the file
// was shown before, from a table written out here.

const TRASHED_AT = new Date('2026-11-01T00:00:00.000Z');
const OWN_TRASHED_AT = new Date('2026-10-20T00:00:00.000Z');

const photoNow = (visibility: AssetVisibility, trashed = false): UndonePhoto => ({
  visibility,
  deletedAt: trashed ? TRASHED_AT : null,
  status: trashed ? AssetStatus.Trashed : AssetStatus.Active,
});

const versionBefore = (priorVisibility: string, wasStacked: boolean): UndoneVersion => ({
  priorVisibility,
  wasStacked,
  deletedAt: null,
  status: AssetStatus.Active,
});

describe('restoredState', () => {
  // photo now | shown before | stacked before | -> shown as | stacked with its photo
  it.each([
    [AssetVisibility.Timeline, 'timeline', false, AssetVisibility.Timeline, false],
    [AssetVisibility.Timeline, 'timeline', true, AssetVisibility.Timeline, true],
    [AssetVisibility.Timeline, 'archive', false, AssetVisibility.Archive, false],
    [AssetVisibility.Timeline, 'archive', true, AssetVisibility.Archive, true],
    [AssetVisibility.Archive, 'timeline', false, AssetVisibility.Archive, false],
    [AssetVisibility.Archive, 'timeline', true, AssetVisibility.Archive, true],
    [AssetVisibility.Archive, 'archive', false, AssetVisibility.Archive, false],
    [AssetVisibility.Archive, 'archive', true, AssetVisibility.Archive, true],
    [AssetVisibility.Locked, 'timeline', false, AssetVisibility.Locked, false],
    [AssetVisibility.Locked, 'timeline', true, AssetVisibility.Locked, false],
    [AssetVisibility.Locked, 'archive', false, AssetVisibility.Locked, false],
    [AssetVisibility.Locked, 'archive', true, AssetVisibility.Locked, false],
  ])(
    'photo %s, file shown in the %s before, stacked %s -> %s, stacked %s',
    (photoVisibility, priorVisibility, wasStacked, visibility, stackedWithPhoto) => {
      expect(restoredState(photoNow(photoVisibility), versionBefore(priorVisibility, wasStacked))).toEqual({
        visibility,
        deletedAt: null,
        status: AssetStatus.Active,
        stackedWithPhoto,
      });
    },
  );

  it('goes to the trash with its photo, with the photo’s trash state', () => {
    expect(restoredState(photoNow(AssetVisibility.Timeline, true), versionBefore('timeline', true))).toEqual({
      visibility: AssetVisibility.Timeline,
      deletedAt: TRASHED_AT,
      status: AssetStatus.Trashed,
      stackedWithPhoto: true,
    });
  });

  it('keeps its own trash state when it has one, whatever its photo’s', () => {
    const ownTrash = { deletedAt: OWN_TRASHED_AT, status: AssetStatus.Trashed };
    for (const photo of [photoNow(AssetVisibility.Timeline), photoNow(AssetVisibility.Timeline, true)]) {
      expect(restoredState(photo, { ...versionBefore('timeline', false), ...ownTrash })).toMatchObject(ownTrash);
    }
  });

  it('is in the timeline for a file whose earlier state is not one it knows', () => {
    expect(restoredState(photoNow(AssetVisibility.Timeline), versionBefore('hidden', false)).visibility).toBe(
      AssetVisibility.Timeline,
    );
  });
});
