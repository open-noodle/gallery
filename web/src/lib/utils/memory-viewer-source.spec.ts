import { AssetTypeEnum, AssetVisibility, MemoryType, type AssetResponseDto, type MemoryResponseDto } from '@immich/sdk';
import {
  buildMemoryAssets,
  findMemoryAsset,
  getMemoryViewerExitRoute,
  removeAssetsFromMemoryList,
} from '$lib/utils/memory-viewer-source';

const asset = (id: string): AssetResponseDto => ({
  id,
  checksum: `${id}-checksum`,
  createdAt: '2024-01-01T00:00:00.000Z',
  duration: null,
  exifInfo: {
    city: 'Cape Town',
    country: 'South Africa',
    latitude: -33.9249,
    longitude: 18.4241,
    projectionType: null,
    timeZone: 'Africa/Johannesburg',
  },
  fileCreatedAt: '2024-01-01T10:00:00.000Z',
  fileModifiedAt: '2024-01-01T10:00:00.000Z',
  hasMetadata: true,
  height: 3000,
  isArchived: false,
  isEdited: false,
  isFavorite: false,
  isOffline: false,
  isTrashed: false,
  libraryId: 'library-id',
  localDateTime: '2024-01-01T12:00:00.000Z',
  originalFileName: `${id}.jpg`,
  originalMimeType: 'image/jpeg',
  originalPath: `/upload/${id}.jpg`,
  ownerId: 'owner-id',
  people: [
    {
      birthDate: null,
      id: `${id}-person`,
      isHidden: false,
      name: 'Ada Lovelace',
      thumbnailPath: '',
    },
  ],
  tags: [
    {
      createdAt: '2024-01-01T00:00:00.000Z',
      id: `${id}-tag`,
      name: 'holiday',
      updatedAt: '2024-01-01T00:00:00.000Z',
      value: 'holiday',
    },
  ],
  thumbhash: `${id}-thumbhash`,
  type: AssetTypeEnum.Image,
  updatedAt: '2024-01-01T00:00:00.000Z',
  visibility: AssetVisibility.Timeline,
  width: 4000,
});

const memory = (id: string, assetIds: string[]): MemoryResponseDto => ({
  assets: assetIds.map((id) => asset(id)),
  createdAt: '2024-01-01T00:00:00.000Z',
  data: {},
  id,
  isSaved: false,
  memoryAt: '2024-01-01T00:00:00.000Z',
  ownerId: 'owner-id',
  type: MemoryType.OnThisDay,
  updatedAt: '2024-01-01T00:00:00.000Z',
});

describe('memory viewer source', () => {
  const memories = [memory('m1', ['a1', 'a2']), memory('m2', ['a3']), memory('m3', ['a4'])];

  it('finds a selected asset with its memory and neighboring context', () => {
    const selected = findMemoryAsset(memories, 'a2');

    expect(selected?.memoryIndex).toBe(0);
    expect(selected?.assetIndex).toBe(1);
    expect(selected?.memory).toBe(memories[0]);
    expect(selected?.asset.id).toBe('a2');
    expect(selected?.previousMemory).toBeUndefined();
    expect(selected?.nextMemory).toBe(memories[1]);
    expect(selected?.previous?.asset.id).toBe('a1');
    expect(selected?.next?.asset.id).toBe('a3');
  });

  it('falls back to the first asset when the selected asset is missing', () => {
    const selected = findMemoryAsset(memories, 'missing');

    expect(selected?.memoryIndex).toBe(0);
    expect(selected?.assetIndex).toBe(0);
    expect(selected?.memory).toBe(memories[0]);
    expect(selected?.asset.id).toBe('a1');
    expect(selected?.previous).toBeUndefined();
    expect(selected?.next?.asset.id).toBe('a2');
  });

  it('removes selected assets and drops empty memories', () => {
    const remaining = removeAssetsFromMemoryList(memories, ['a1', 'a3']);

    expect(remaining.map((memory) => memory.id)).toEqual(['m1', 'm3']);
    expect(remaining.map((memory) => memory.assets.map((asset) => asset.id))).toEqual([['a2'], ['a4']]);
    expect(remaining[0]).not.toBe(memories[0]);
    expect(memories[0].assets.map((asset) => asset.id)).toEqual(['a1', 'a2']);
  });

  it('returns to the memories index when exiting the history viewer', () => {
    expect(getMemoryViewerExitRoute('history')).toBe('/memories');
    expect(getMemoryViewerExitRoute()).toBe('/photos');
  });

  describe('duplicate assets across memories (#790)', () => {
    // rule memories (e.g. birthday) sort first and can contain assets that also
    // appear in a later on-this-day memory
    const withDuplicates = [
      memory('birthday', ['b1', 'dup']),
      memory('one-year-ago', ['a1']),
      memory('three-years-ago', ['dup', 'a2']),
    ];

    it('resolves the occurrence inside the requested memory', () => {
      const selected = findMemoryAsset(withDuplicates, 'dup', 'three-years-ago');

      expect(selected?.memory.id).toBe('three-years-ago');
      expect(selected?.memoryIndex).toBe(2);
      expect(selected?.assetIndex).toBe(0);
      // navigation keeps advancing forward instead of looping back to the birthday memory
      expect(selected?.next?.asset.id).toBe('a2');
    });

    it('falls back to the first occurrence without a memory id', () => {
      const selected = findMemoryAsset(withDuplicates, 'dup');

      expect(selected?.memory.id).toBe('birthday');
      expect(selected?.memoryIndex).toBe(0);
    });

    it('falls back to the first occurrence when the requested memory does not contain the asset', () => {
      const selected = findMemoryAsset(withDuplicates, 'dup', 'one-year-ago');

      expect(selected?.memory.id).toBe('birthday');
    });
  });
});

describe('buildMemoryAssets assetIndex contract', () => {
  it('indexes into its OWN memory.assets, not the concatenated viewer list', () => {
    // MemoryViewer renders the date overlay from `current.memory.assets[current.assetIndex]`.
    // That is only correct while assetIndex stays memory-relative; if it ever became an index
    // across all memories, the overlay would read another memory's asset or run off the end.
    const memories = [
      memory('memory-1', ['a1', 'a2']),
      memory('memory-2', ['b1', 'b2', 'b3']),
      memory('memory-3', ['c1']),
    ];

    const sources = buildMemoryAssets(memories);

    expect(sources).toHaveLength(6);
    for (const source of sources) {
      expect(source.memory.assets[source.assetIndex]).toBeDefined();
      expect(source.memory.assets[source.assetIndex].id).toBe(source.asset.id);
    }
    // spelled out for the boundary case the loop above would also cover
    const firstOfSecondMemory = sources[2];
    expect(firstOfSecondMemory.memory.id).toBe('memory-2');
    expect(firstOfSecondMemory.assetIndex).toBe(0);
    expect(firstOfSecondMemory.memory.assets[firstOfSecondMemory.assetIndex].id).toBe('b1');
  });
});
