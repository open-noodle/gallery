// Seeded, in-memory stand-in for the Gallery MCP gateway.
//
// Injected into the dispatcher via `buildClient`, so workflows run their real
// `run()` against it with no DB and no Gallery server. Every call is recorded so
// the driver can assert the exact tool sequence a workflow issued.
import { DATASET } from './dataset.mjs';

// Every tool that creates a reviewable plan. The driver's no-raw-asset-IDs
// invariant only inspects these.
export const PLAN_TOOLS = Object.freeze(
  new Set([
    'proposeAlbumOperations',
    'proposeAlbumFromSelection',
    'proposeAssetBatchFromSelection',
    'proposeAddAssetsToSpaceFromSearch',
    'proposeSpaceFromSearch',
  ]),
);

const planOk = (dataset) => ({ status: 'success', plan: { id: dataset.planId } });

const HANDLERS = {
  listAlbums: (dataset) => ({ status: 'success', albums: [...dataset.albums] }),
  readAlbum: (dataset, args) => ({
    status: 'success',
    album: dataset.albums.find((album) => album.id === args?.albumId) ?? null,
  }),
  searchUsers: (dataset) => ({ status: 'success', users: [...dataset.users] }),
  listDuplicateGroups: (dataset) => ({ status: 'success', groups: [...dataset.duplicateGroups] }),
  resolveAssetSearchFilters: () => ({ status: 'success', results: [], resolvedFilters: {} }),
  searchAssets: (dataset) => ({ status: 'success', selectionHandle: { ...dataset.searchSelectionHandle } }),
  findTripCandidates: (dataset) => ({
    status: 'success',
    recommendation: { ...dataset.tripRecommendation },
    candidates: [...dataset.tripCandidates],
  }),
  proposeAlbumOperations: planOk,
  proposeAlbumFromSelection: planOk,
  proposeAssetBatchFromSelection: planOk,
};

/**
 * @param {object} [options]
 * @param {object} [options.dataset] seed data (defaults to DATASET)
 * @param {Record<string, unknown>} [options.overrides] per-tool override. An
 *   Error instance is thrown; a function is called with the args; anything else
 *   is returned verbatim.
 * @returns {{ client: { call: Function }, calls: Array<{name: string, args: unknown, options: unknown}> }}
 */
export const createFakeMcpClient = ({ dataset = DATASET, overrides = {} } = {}) => {
  const calls = [];
  const client = {
    async call(name, args, options) {
      // Record BEFORE dispatching so a throwing tool still appears in the
      // sequence — otherwise a failure scenario would show a misleading history.
      calls.push({ name, args, options });

      if (Object.hasOwn(overrides, name)) {
        const override = overrides[name];
        if (override instanceof Error) {
          throw override;
        }
        return typeof override === 'function' ? override(args) : override;
      }

      const handler = HANDLERS[name];
      if (!handler) {
        throw new Error(`fake MCP client: unexpected tool "${name}"`);
      }
      return handler(dataset, args);
    },
  };
  return { client, calls };
};
