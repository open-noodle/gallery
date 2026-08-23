import { wrapper } from '@immich/plugin-sdk';
import type { Manifest } from '../dist/index.d.ts';
import { gallery } from './host.js';

const methods = wrapper<Manifest>({
  addToSpace: ({ data, config, workflow }) => {
    gallery(workflow.authToken)('addToSpace', {
      assetId: data.asset.id,
      spaceIds: config.spaceIds,
    });

    return {};
  },

  addToSpaceAlbum: ({ data, config, workflow }) => {
    gallery(workflow.authToken)('addToSpaceAlbum', {
      assetId: data.asset.id,
      spaceId: config.spaceId,
      albumName: config.albumName,
    });

    return {};
  },
});

const {
  addToSpace,
  addToSpaceAlbum,

  // should be empty. ensures that every field is destructured
  ...rest
} = methods;

export { addToSpace, addToSpaceAlbum };

'All methods must be destructured and exported' satisfies string & typeof rest;
