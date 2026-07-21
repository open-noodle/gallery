import { AssetTypeEnum } from '@immich/sdk';
import { get } from 'svelte/store';
import type { Faces } from '$lib/managers/asset-viewer-manager.svelte';
import { PeopleSortBy, peopleViewSettings } from '$lib/stores/preferences.store';
import type { Size } from '$lib/utils/container-utils';
import { getBoundingBox, sortPeople, sortPeopleForManagement, zoomImageToBase64 } from '$lib/utils/people-utils';

const makeFace = (overrides: Partial<Faces> = {}): Faces => ({
  id: 'face-1',
  imageWidth: 4000,
  imageHeight: 3000,
  boundingBoxX1: 1000,
  boundingBoxY1: 750,
  boundingBoxX2: 2000,
  boundingBoxY2: 1500,
  ...overrides,
});

describe('sortPeopleForManagement', () => {
  const p = (overrides: {
    id: string;
    name?: string | null;
    isFavorite?: boolean;
    numberOfAssets?: number;
    assetCount?: number;
    isHidden?: boolean;
  }) => overrides;

  it('sorts favorites first, named people alphabetically, then unnamed by count descending', () => {
    const people = [
      p({ id: 'unnamed-low', name: '', numberOfAssets: 1 }),
      p({ id: 'named-z', name: 'Zoe', numberOfAssets: 99 }),
      p({ id: 'favorite-unnamed-high', name: '', isFavorite: true, numberOfAssets: 10 }),
      p({ id: 'named-a', name: 'Alice', numberOfAssets: 1 }),
      p({ id: 'unnamed-high', name: '', numberOfAssets: 50 }),
      p({ id: 'favorite-named', name: 'Beth', isFavorite: true, numberOfAssets: 1 }),
    ];

    expect(sortPeopleForManagement(people).map((person) => person.id)).toEqual([
      'favorite-named',
      'favorite-unnamed-high',
      'named-a',
      'named-z',
      'unnamed-high',
      'unnamed-low',
    ]);
  });

  it('treats whitespace-only names as unnamed and uses assetCount for space people', () => {
    const people = [
      p({ id: 'space-unnamed-low', name: ' '.repeat(3), assetCount: 2 }),
      p({ id: 'space-named', name: 'anna', assetCount: 1 }),
      p({ id: 'space-unnamed-high', name: '', assetCount: 9 }),
    ];

    expect(sortPeopleForManagement(people).map((person) => person.id)).toEqual([
      'space-named',
      'space-unnamed-high',
      'space-unnamed-low',
    ]);
  });

  it('uses case-insensitive names, missing counts as zero, and id as final tiebreak', () => {
    const people = [
      p({ id: 'unnamed-b', name: '', numberOfAssets: undefined }),
      p({ id: 'named-b', name: 'bob' }),
      p({ id: 'unnamed-a', name: '', numberOfAssets: 0 }),
      p({ id: 'named-a', name: 'Alice' }),
    ];

    expect(sortPeopleForManagement(people).map((person) => person.id)).toEqual([
      'named-a',
      'named-b',
      'unnamed-a',
      'unnamed-b',
    ]);
  });
});

describe('sortPeople', () => {
  it('defaults the people view preference to Most photos', () => {
    // vitest isolates modules per spec file, so this reads the store's pristine default
    expect(get(peopleViewSettings).sortBy).toBe(PeopleSortBy.PhotoCount);
  });

  const p = (overrides: {
    id: string;
    name?: string | null;
    isFavorite?: boolean;
    numberOfAssets?: number;
    assetCount?: number;
    isHidden?: boolean;
  }) => overrides;

  describe('PhotoCount mode', () => {
    it('sorts named people by count descending with name then id tiebreaks, unnamed last', () => {
      const people = [
        p({ id: 'named-mid', name: 'Zoe', numberOfAssets: 50 }),
        p({ id: 'unnamed-high', name: '', numberOfAssets: 999 }),
        p({ id: 'named-top', name: 'Mara', numberOfAssets: 100 }),
        p({ id: 'tie-b', name: 'bob', numberOfAssets: 10 }),
        p({ id: 'tie-a', name: 'Alice', numberOfAssets: 10 }),
      ];

      expect(sortPeople(people, PeopleSortBy.PhotoCount).map((person) => person.id)).toEqual([
        'named-top',
        'named-mid',
        'tie-a',
        'tie-b',
        'unnamed-high',
      ]);
    });

    it('keeps favorites first, named favorites before unnamed favorites', () => {
      const people = [
        p({ id: 'named-big', name: 'Anna', numberOfAssets: 500 }),
        p({ id: 'fav-unnamed', name: '', isFavorite: true, numberOfAssets: 3 }),
        p({ id: 'fav-named', name: 'Zoe', isFavorite: true, numberOfAssets: 1 }),
      ];

      expect(sortPeople(people, PeopleSortBy.PhotoCount).map((person) => person.id)).toEqual([
        'fav-named',
        'fav-unnamed',
        'named-big',
      ]);
    });

    it('breaks equal-count ties among unnamed people by id, treating whitespace names as unnamed', () => {
      const people = [p({ id: 'u-b', name: '', numberOfAssets: 5 }), p({ id: 'u-a', name: '  ', numberOfAssets: 5 })];

      expect(sortPeople(people, PeopleSortBy.PhotoCount).map((person) => person.id)).toEqual(['u-a', 'u-b']);
    });
  });

  describe('Name mode', () => {
    it('sorts named people A–Z case-insensitively ignoring counts, unnamed by count last', () => {
      const people = [
        p({ id: 'unnamed-low', name: '', numberOfAssets: 1 }),
        p({ id: 'named-b', name: 'bob', numberOfAssets: 999 }),
        p({ id: 'unnamed-high', name: ' '.repeat(3), numberOfAssets: 50 }),
        p({ id: 'named-a', name: 'Alice', numberOfAssets: 1 }),
      ];

      expect(sortPeople(people, PeopleSortBy.Name).map((person) => person.id)).toEqual([
        'named-a',
        'named-b',
        'unnamed-high',
        'unnamed-low',
      ]);
    });

    it('treats missing counts as zero', () => {
      const people = [p({ id: 'u-zero', name: '' }), p({ id: 'u-five', name: '', numberOfAssets: 5 })];

      expect(sortPeople(people, PeopleSortBy.Name).map((person) => person.id)).toEqual(['u-five', 'u-zero']);
    });

    it('breaks identical-name ties by count then id, matching the mobile ordering', () => {
      const people = [
        p({ id: 'dup-a', name: 'Alex', numberOfAssets: 1 }),
        p({ id: 'dup-b', name: 'alex', numberOfAssets: 9 }),
      ];

      expect(sortPeople(people, PeopleSortBy.Name).map((person) => person.id)).toEqual(['dup-b', 'dup-a']);
    });
  });

  it('treats an unknown persisted mode as the default (Most photos)', () => {
    const people = [
      p({ id: 'alpha-first', name: 'Alice', numberOfAssets: 1 }),
      p({ id: 'count-first', name: 'Zoe', numberOfAssets: 99 }),
    ];

    expect(sortPeople(people, 'garbage' as PeopleSortBy).map((person) => person.id)).toEqual([
      'count-first',
      'alpha-first',
    ]);
  });

  it('sorts hidden people last in both modes', () => {
    const people = [
      p({ id: 'hidden-fav', name: 'Aaa', isFavorite: true, isHidden: true, numberOfAssets: 999 }),
      p({ id: 'visible', name: 'Zoe', numberOfAssets: 1 }),
    ];

    for (const mode of [PeopleSortBy.PhotoCount, PeopleSortBy.Name]) {
      expect(sortPeople(people, mode).map((person) => person.id)).toEqual(['visible', 'hidden-fav']);
    }
  });
});

describe('getBoundingBox', () => {
  it('should scale face coordinates to display dimensions', () => {
    const face = makeFace();
    const imageSize: Size = { width: 800, height: 600 };

    const boxes = getBoundingBox([face], imageSize);

    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toEqual({
      id: 'face-1',
      top: 600 * (750 / 3000),
      left: 800 * (1000 / 4000),
      width: 800 * (2000 / 4000) - 800 * (1000 / 4000),
      height: 600 * (1500 / 3000) - 600 * (750 / 3000),
    });
  });

  it('should map full-image face to full display area', () => {
    const face = makeFace({
      imageWidth: 1000,
      imageHeight: 1000,
      boundingBoxX1: 0,
      boundingBoxY1: 0,
      boundingBoxX2: 1000,
      boundingBoxY2: 1000,
    });
    const imageSize: Size = { width: 600, height: 600 };

    const boxes = getBoundingBox([face], imageSize);

    expect(boxes[0]).toEqual({
      id: 'face-1',
      top: 0,
      left: 0,
      width: 600,
      height: 600,
    });
  });

  it('should return empty array for empty faces', () => {
    expect(getBoundingBox([], { width: 800, height: 600 })).toEqual([]);
  });

  it('should handle multiple faces', () => {
    const faces = [
      makeFace({ id: 'face-1', boundingBoxX1: 0, boundingBoxY1: 0, boundingBoxX2: 1000, boundingBoxY2: 1000 }),
      makeFace({ id: 'face-2', boundingBoxX1: 2000, boundingBoxY1: 1500, boundingBoxX2: 3000, boundingBoxY2: 2500 }),
    ];

    const boxes = getBoundingBox(faces, { width: 800, height: 600 });

    expect(boxes).toHaveLength(2);
    expect(boxes[0].left).toBeLessThan(boxes[1].left);
  });
});

describe(zoomImageToBase64.name, () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sets anonymous CORS before loading video thumbnails and face crop images', async () => {
    const operations: Array<{ imageIndex: number; type: 'crossOrigin' | 'src'; value: string | null }> = [];
    let imageCount = 0;

    class TestImage extends EventTarget {
      readonly imageIndex = imageCount++;
      naturalWidth = 4000;
      naturalHeight = 3000;
      private source = '';

      set crossOrigin(value: string | null) {
        operations.push({ imageIndex: this.imageIndex, type: 'crossOrigin', value });
      }

      get crossOrigin() {
        return 'anonymous';
      }

      set src(value: string) {
        this.source = value;
        operations.push({ imageIndex: this.imageIndex, type: 'src', value });
      }

      get src() {
        return this.source;
      }

      override addEventListener(...args: Parameters<EventTarget['addEventListener']>) {
        super.addEventListener(...args);

        if (args[0] === 'load') {
          queueMicrotask(() => this.dispatchEvent(new Event('load')));
        }
      }
    }

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: vi.fn(() => ({ drawImage: vi.fn() })),
          toDataURL: vi.fn(() => 'data:image/png;base64,face'),
        } as unknown as HTMLCanvasElement;
      }

      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    vi.stubGlobal('Image', TestImage);

    await expect(zoomImageToBase64(makeFace(), 'asset-1', AssetTypeEnum.Video, undefined)).resolves.toBe(
      'data:image/png;base64,face',
    );

    for (const imageIndex of [0, 1]) {
      const crossOriginIndex = operations.findIndex(
        (operation) => operation.imageIndex === imageIndex && operation.type === 'crossOrigin',
      );
      const srcIndex = operations.findIndex(
        (operation) => operation.imageIndex === imageIndex && operation.type === 'src',
      );

      expect(crossOriginIndex).toBeGreaterThanOrEqual(0);
      expect(crossOriginIndex).toBeLessThan(srcIndex);
      expect(operations[crossOriginIndex].value).toBe('anonymous');
    }
  });

  it('crops from the loaded image even when the displayed photo has not decoded yet', async () => {
    class TestImage extends EventTarget {
      naturalWidth = 4000;
      naturalHeight = 3000;
      crossOrigin: string | null = null;
      private source = '';

      set src(value: string) {
        this.source = value;
      }

      get src() {
        return this.source;
      }

      override addEventListener(...args: Parameters<EventTarget['addEventListener']>) {
        super.addEventListener(...args);
        if (args[0] === 'load') {
          queueMicrotask(() => this.dispatchEvent(new Event('load')));
        }
      }
    }

    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toDataURL: () => 'data:image/png;base64,face',
    };
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) =>
      tagName === 'canvas' ? canvas : originalCreateElement(tagName)) as typeof document.createElement);
    vi.stubGlobal('Image', TestImage);

    // The displayed <img> is bound but still decoding: naturalWidth/Height are 0.
    const photoViewer = { naturalWidth: 0, naturalHeight: 0, src: 'http://localhost/preview.jpg' } as HTMLImageElement;

    const result = await zoomImageToBase64(makeFace(), 'asset-1', AssetTypeEnum.Image, photoViewer);

    // Must not emit a broken 0×0 "data:," thumbnail.
    expect(result).toBe('data:image/png;base64,face');
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
    // Crop rectangle must be scaled from the loaded clone (4000×3000), not the 0-sized element.
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 1000, 750, 1000, 750, 0, 0, 1000, 750);
  });

  it('returns null (so callers fall back) when the source image fails to load', async () => {
    class BrokenImage extends EventTarget {
      naturalWidth = 0;
      naturalHeight = 0;
      crossOrigin: string | null = null;
      src = '';

      override addEventListener(...args: Parameters<EventTarget['addEventListener']>) {
        super.addEventListener(...args);
        if (args[0] === 'error') {
          queueMicrotask(() => this.dispatchEvent(new Event('error')));
        }
      }
    }

    vi.stubGlobal('Image', BrokenImage);
    const photoViewer = { naturalWidth: 0, naturalHeight: 0, src: 'http://localhost/preview.jpg' } as HTMLImageElement;

    await expect(zoomImageToBase64(makeFace(), 'asset-1', AssetTypeEnum.Image, photoViewer)).resolves.toBeNull();
  });
});
