import { getBaseUrl, IntegrityReport, QueueName, type MetadataSearchDto, type SmartSearchDto } from '@immich/sdk';
import { omitBy } from 'lodash-es';
import type { FilterState } from '$lib/components/filter-panel/filter-panel';
import { OpenQueryParam, QueryParameter, type SharedLinkTab } from '$lib/constants';
import { encodeFilterParams } from '$lib/utils/filter-url';

const asQueueSlug = (name: QueueName) => {
  return name.replaceAll(/[A-Z]/g, (m) => '-' + m.toLowerCase());
};

export const fromQueueSlug = (slug: string): QueueName | undefined => {
  const name = slug.replaceAll(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (Object.values(QueueName).includes(name as QueueName)) {
    return name as QueueName;
  }
};

type QueryValue = number | string;
const asQueryString = (
  params?: Record<string, QueryValue | undefined>,
  options?: { skipEmptyStrings?: boolean; skipNullValues?: boolean },
) => {
  const { skipEmptyStrings = true, skipNullValues = true } = options ?? {};
  const items = Object.entries(params ?? {})
    .filter((item): item is [string, QueryValue] => {
      const value = item[1];

      if (value === undefined) {
        return false;
      }

      if (skipNullValues && value === null) {
        return false;
      }

      return !(skipEmptyStrings && value === '');
    })
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);

  return items.length === 0 ? '' : `?${items.join('&')}`;
};

const DOCS_BASE = 'https://docs.immich.app';

export const Docs = {
  duplicates: () => `${DOCS_BASE}/features/duplicates-utility`,
};

export const Route = {
  // auth
  login: (params?: { continue?: string; autoLaunch?: 0 | 1 }) => '/auth/login' + asQueryString(params),
  logout: (params?: { continue?: string }) => '/auth/logout' + asQueryString(params),
  register: () => '/auth/register',
  changePassword: () => '/auth/change-password',
  onboarding: (params?: { step?: string }) => '/auth/onboarding' + asQueryString(params),
  pinPrompt: (params?: { continue?: string }) => '/auth/pin-prompt' + asQueryString({ continue: params?.continue }),

  // albums
  albums: () => '/albums',
  viewAlbum: ({ id }: { id: string }) => `/albums/${id}`,
  viewAlbumAsset: ({ albumId, assetId }: { albumId: string; assetId: string }) =>
    `/albums/${albumId}/photos/${assetId}`,

  // buy
  buy: () => '/buy',

  // explore
  explore: () => '/explore',
  places: () => '/places',

  // family
  family: () => '/family',

  // folders
  folders: (params?: { path?: string }) => '/folders' + asQueryString(params),

  // import
  import: () => '/import',

  // libraries
  libraries: () => '/admin/library-management',
  newLibrary: () => '/admin/library-management/new',
  viewLibrary: ({ id }: { id: string }) => `/admin/library-management/${id}`,
  editLibrary: ({ id }: { id: string }) => `/admin/library-management/${id}/edit`,

  // maintenance
  maintenanceMode: (params?: { continue?: string }) => '/maintenance' + asQueryString(params),

  // map
  //
  // Emits `/map?<scope+filters>#<zoom>/<lat>/<lng>` (E11). The map keeps its VIEWPORT in the hash
  // (`<Map hash>` on the map page) and its SCOPE + FILTERS in the query, so both halves have to be
  // buildable from one call — a map link that drops the caller's filters is bug #767.
  map: (params?: {
    zoom?: number;
    lat?: number;
    lng?: number;
    spaceId?: string;
    query?: string;
    filters?: FilterState;
  }) => {
    const search = new URLSearchParams();
    if (params?.spaceId) {
      search.set(QueryParameter.SPACE_ID, params.spaceId);
    }
    const query = params?.query?.trim();
    if (query) {
      search.set('q', query);
    }
    if (params?.filters) {
      encodeFilterParams(search, params.filters);
    }

    const point =
      params?.zoom !== undefined && params?.lat !== undefined && params?.lng !== undefined
        ? `#${params.zoom}/${params.lat}/${params.lng}`
        : '';

    const searchString = search.toString();
    return '/map' + (searchString ? `?${searchString}` : '') + point;
  },

  // memories
  memories: () => '/memories',
  memoryViewer: (params?: { id?: string; memoryId?: string; source?: 'history' }) => '/memory' + asQueryString(params),

  // partners
  viewPartner: ({ id }: { id: string }) => `/partners/${id}`,

  // people
  people: () => '/people',
  viewPerson: ({ id }: { id: string }, params?: { previousRoute?: string; action?: 'merge' }) =>
    `/people/${id}` + asQueryString(params),
  viewSpacePerson: (spaceId: string, personId: string, params?: { previousRoute?: string; action?: 'merge' }) =>
    `/spaces/${spaceId}/people/${personId}` + asQueryString(params),

  // photos
  // `city` / `country` are filter-panel params (FILTER_URL_PARAMS) — /photos hydrates its filter
  // state from the URL, so this lands on the timeline already narrowed to that place (#867).
  //
  // #989: pass BOTH halves of a place. The location filter nests cities under their country, and a
  // `city` with no `country` has nowhere to nest — it renders flat beside the country list as an
  // orphaned selection. The params are rebuilt here in a fixed order rather than forwarded, so the
  // emitted URL does not depend on the caller's object-literal key order.
  photos: (params?: { at?: string; city?: string; country?: string }) =>
    '/photos' + asQueryString({ at: params?.at, city: params?.city, country: params?.country }),
  viewAsset: ({ id }: { id: string }) => `/photos/${id}`,
  archive: () => '/archive',
  favorites: () => '/favorites',
  locked: () => '/locked',
  trash: () => '/trash',
  viewTrashedAsset: ({ id }: { id: string }) => `/trash/photos/${id}`,
  recentlyAdded: () => '/recently-added',

  // search
  search: (dto?: MetadataSearchDto | SmartSearchDto) => {
    const metadata = omitBy(dto ?? {}, (value) => value === undefined);
    const query = Object.keys(metadata).length === 0 ? undefined : JSON.stringify(metadata);
    return `/search` + asQueryString({ query });
  },

  // sharing
  sharing: () => '/sharing',

  // spaces
  spaces: () => '/spaces',
  viewSpace: ({ id }: { id: string }) => `/spaces/${id}`,
  viewSpaceAlbums: ({ id }: { id: string }) => `/spaces/${id}/albums`,
  viewSpaceAlbum: ({ spaceId, albumId }: { spaceId: string; albumId: string }) =>
    `/spaces/${spaceId}/albums/${albumId}`,

  // shared links
  sharedLinks: (params?: { filter?: SharedLinkTab }) => '/shared-links' + asQueryString(params),
  editSharedLink: ({ id }: { id: string }) => `/shared-links/${id}/edit`,
  viewSharedLink: ({ slug, key }: { slug?: string | null; key: string }) =>
    slug ? `/s/${encodeURIComponent(slug)}` : `/share/${key}`,

  // settings
  userSettings: (params?: { isOpen?: OpenQueryParam }) => '/user-settings' + asQueryString(params),

  // system
  systemSettings: (params?: { isOpen?: OpenQueryParam }) => '/admin/system-settings' + asQueryString(params),
  systemStatistics: () => '/admin/server-status',
  systemMaintenance: (params?: { continue?: string }) => '/admin/maintenance' + asQueryString(params),
  systemMaintenanceIntegrityReport: ({ reportType }: { reportType: IntegrityReport }) =>
    `/admin/maintenance/integrity-report/${reportType}`,
  storageMigration: () => '/admin/storage-migration',

  // tags
  tags: (params?: { path?: string }) => '/tags' + asQueryString(params),

  // users
  users: () => '/admin/users',
  newUser: () => `/admin/users/new`,
  viewUser: ({ id }: { id: string }) => `/admin/users/${id}`,
  editUser: ({ id }: { id: string }) => `/admin/users/${id}/edit`,

  // utilities
  utilities: () => '/utilities',
  duplicatesUtility: (params?: { index?: number }) => '/utilities/duplicates' + asQueryString(params),
  largeFileUtility: () => '/utilities/large-files',
  geolocationUtility: () => '/utilities/geolocation',

  // workflows
  workflows: () => '/workflows',
  viewWorkflow: ({ id }: { id: string }) => `/workflows/${id}`,

  // face cleanup
  faceCleanup: () => '/admin/face-cleanup',
  faceCleanupScan: () => '/admin/face-cleanup/scan',
  faceCleanupPeople: () => '/admin/face-cleanup/people',
  viewFaceCleanupPerson: ({ id }: { id: string }) => `/admin/face-cleanup/${id}`,
  viewFaceCleanupManualPerson: ({ id }: { id: string }) => `/admin/face-cleanup/people/${id}`,
  faceCleanupResolutions: () => '/admin/face-cleanup/resolutions',

  // queues
  queues: () => '/admin/queues',
  viewQueue: ({ name }: { name: QueueName }) => `/admin/queues/${asQueueSlug(name)}`,

  // integrity checks
  integrityReportFile: (reportId: string) => `${getBaseUrl()}/admin/integrity/report/${reportId}/file`,
  integrityReportCsv: (reportType: IntegrityReport) => `${getBaseUrl()}/admin/integrity/report/${reportType}/csv`,

  // continue helper for ensuring same-origin URLs
  continue: (url: string | null, fallback: string): string | URL => {
    const resolved = new URL(url ?? fallback, document.baseURI);

    if (resolved.origin !== location.origin) {
      return fallback;
    }

    return resolved;
  },
};
