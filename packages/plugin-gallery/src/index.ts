import { wrapper } from '@immich/plugin-sdk';
import type { Manifest } from '../dist/index.d.ts';

// No-ops: Gallery's server runs these steps in TypeScript before they reach this module
// (GalleryWorkflowHostService.runStep). The plugin imports only upstream's host functions, so a
// stock Immich server can load it.
const methods = wrapper<Manifest>({
  addToSpace: () => ({}),
  addToSpaceAlbum: () => ({}),
});

const {
  addToSpace,
  addToSpaceAlbum,

  // should be empty. ensures that every field is destructured
  ...rest
} = methods;

export { addToSpace, addToSpaceAlbum };

'All methods must be destructured and exported' satisfies string & typeof rest;
