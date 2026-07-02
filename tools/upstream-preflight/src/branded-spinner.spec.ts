import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Repo-invariant guard for Slice 13 (finding LOW#8).
//
// The fork swaps upstream `@immich/ui`'s generic `LoadingSpinner` for a
// fork-local, branded one (`$lib/components/shared-components/LoadingSpinner.svelte`,
// which renders `/gallery-loader.svg` / `/gallery-loader-dark.svg`) across the
// themed app shell. The rebase dropped the swap in exactly 2 of the fork's 25
// swapped call-sites: `ActivityViewer.svelte` and `DetailPanel.svelte`.
//
// This guard fails the *next* rebase if any file in the fork's swapped set
// reverts to importing the generic `@immich/ui` spinner.

const WEB_SRC = path.resolve(process.cwd(), '../../web/src');
const FORK_LOCAL_SPECIFIER =
  '$lib/components/shared-components/LoadingSpinner.svelte';
const GENERIC_SPECIFIER = '@immich/ui';

// The fork's full 25-file "swapped set" — every call-site that must render the
// branded spinner, not the generic one. Paths are relative to `web/src`.
const SWAPPED_SET = [
  'lib/modals/PeoplePickerModal.svelte',
  'lib/modals/PartnerSelectionModal.svelte',
  'lib/modals/SpaceAddMemberModal.svelte',
  'lib/modals/MapModal.svelte',
  'lib/modals/UserGroupModal.svelte',
  'lib/modals/AlbumAddUsersModal.svelte',
  'lib/components/spaces/space-search-results.svelte',
  'lib/components/faces-page/AssignFaceSidePanel.svelte',
  'lib/components/faces-page/PersonSidePanel.svelte',
  'lib/components/asset-viewer/ImagePanoramaViewer.svelte',
  'lib/components/asset-viewer/VideoPanoramaViewer.svelte',
  'lib/components/asset-viewer/VideoNativeViewer.svelte',
  'lib/components/asset-viewer/VideoRemoteViewer.svelte',
  'lib/components/asset-viewer/ActivityViewer.svelte',
  'lib/components/asset-viewer/DetailPanel.svelte',
  'lib/components/assets/thumbnail/VideoThumbnail.svelte',
  'lib/elements/SearchBar.svelte',
  'routes/admin/system-settings/StorageTemplateSettings.svelte',
  'routes/admin/system-settings/TemplateSettings.svelte',
  'routes/admin/queues/[name]/QueueGraph.svelte',
  'routes/(user)/user-settings/OauthSettings.svelte',
  'routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  'routes/(user)/utilities/geolocation/+page.svelte',
  'routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  'routes/(user)/memories/+page.svelte',
];

// Matches both import forms used in this codebase:
//   import LoadingSpinner from '...';
//   import { A, LoadingSpinner, B } from '...';
const IMPORT_RE =
  /import\s+(?:([$\w]+)|\{([^}]*)\})\s+from\s+['"]([^'"]+)['"]/g;

type SpinnerSource = 'fork-local' | 'generic' | 'other' | 'none';

function collectSvelteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSvelteFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.svelte')) {
      out.push(full);
    }
  }
  return out;
}

function classifySpecifier(specifier: string): SpinnerSource {
  if (specifier.endsWith(FORK_LOCAL_SPECIFIER)) {
    return 'fork-local';
  }
  if (specifier === GENERIC_SPECIFIER) {
    return 'generic';
  }
  return 'other';
}

// Find how (if at all) a file imports the `LoadingSpinner` component.
function findLoadingSpinnerImport(content: string): SpinnerSource {
  for (const match of content.matchAll(IMPORT_RE)) {
    const [, defaultName, namedList, specifier] = match;
    if (defaultName === 'LoadingSpinner') {
      return classifySpecifier(specifier);
    }
    if (namedList) {
      const names = namedList.split(',').map((entry) =>
        entry
          .trim()
          .split(/\s+as\s+/)[0]
          .trim(),
      );
      if (names.includes('LoadingSpinner')) {
        return classifySpecifier(specifier);
      }
    }
  }
  return 'none';
}

describe('branded LoadingSpinner swap', () => {
  it('every file in the fork swapped set imports the fork-local branded spinner', () => {
    const offenders: string[] = [];

    for (const rel of SWAPPED_SET) {
      const full = path.join(WEB_SRC, rel);
      const content = fs.readFileSync(full, 'utf8');
      const source = findLoadingSpinnerImport(content);
      if (source !== 'fork-local') {
        offenders.push(
          `${rel}: imports LoadingSpinner from ${source} instead of the fork-local component`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  it('no file in the swapped set imports the generic @immich/ui LoadingSpinner', () => {
    const swappedSetAbs = new Set(
      SWAPPED_SET.map((rel) => path.join(WEB_SRC, rel)),
    );
    const offenders: string[] = [];

    for (const file of collectSvelteFiles(WEB_SRC)) {
      if (!swappedSetAbs.has(file)) {
        continue;
      }
      const content = fs.readFileSync(file, 'utf8');
      if (findLoadingSpinnerImport(content) === 'generic') {
        offenders.push(path.relative(WEB_SRC, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
