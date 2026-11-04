import { cloneDeep } from 'lodash-es';
import { defaults } from 'src/dtos/config.dto.js';
import { galleryConfigPaths } from 'src/gallery/dtos/config.dto.js';
import { withStoredGallerySettings } from 'src/gallery/middleware/upstream-config-body.interceptor.js';

const read = (node: unknown, path: string) => {
  let value = node;
  for (const key of path.split('.')) {
    value = (value as Record<string, unknown> | undefined)?.[key];
  }
  return value;
};

const remove = (node: unknown, path: string) => {
  const keys = path.split('.');
  const key = keys.pop()!;
  delete ((keys.length > 0 ? read(node, keys.join('.')) : node) as Record<string, unknown>)[key];
};

describe(withStoredGallerySettings.name, () => {
  const stored = cloneDeep(defaults) as unknown as Record<string, any>;
  stored.classification = { enabled: false, categories: [{ name: 'Screenshots' }] };
  stored.machineLearning.petDetection.enabled = true;
  stored.job.peopleBackfill = { concurrency: 4 };
  stored.server.mergePeopleAcrossOwners = true;

  it('should name every Gallery setting by a path the stored config has', () => {
    for (const path of galleryConfigPaths) {
      expect(read(defaults, path), path).toBeDefined();
    }
  });

  it('should fill every Gallery setting an upstream-shaped body leaves out with its stored value', () => {
    const body = cloneDeep(defaults) as unknown as Record<string, any>;
    for (const path of galleryConfigPaths) {
      remove(body, path);
    }

    withStoredGallerySettings(body, stored);

    expect(body).toEqual(stored);
  });

  it('should keep a Gallery setting the body sends', () => {
    const body = cloneDeep(stored);
    body.classification = { enabled: true, categories: [] };

    withStoredGallerySettings(body, stored);

    expect(body.classification).toEqual({ enabled: true, categories: [] });
  });

  it('should leave a body without the parent section for validation to reject', () => {
    const body: Record<string, any> = {};

    withStoredGallerySettings(body, stored);

    expect(body.job).toBeUndefined();
    expect(body.classification).toEqual(stored.classification);
  });
});
