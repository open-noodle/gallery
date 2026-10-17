const BRANDING_ARTWORK =
  "upstream's logo artwork, replaced by the Gallery mark in 392e30134cf (#327); apply-branding supplies the Gallery assets";
const MOBILE_SEARCH =
  "upstream's mobile search page and filter sheet, replaced by the fork's filter-parity search (#654, #758)";
const PEOPLE_PAGE =
  "upstream's people-page pieces, replaced when people management was unified for Spaces in dce1a886dd4 (#450)";
const CLUSTER_GROUPS_UI =
  "upstream's cluster-groups UI, dropped in 20a28718040; cluster groups stay inert under Option M";

// Shape I from the fork's zero-conflict catalogue, in its hardest-to-see form.
//
// When the fork's rule is a DELETION — "we do not carry this upstream file" — upstream later
// re-creating or merely touching that path produces a delete/modify conflict that a replay can
// resolve toward upstream with no textual conflict left behind and no gate to notice. It happened
// this cycle: the fork deleted upstream's `packages/scripts` release-version tooling, upstream's
// Renovate bot touched its package.json, and the replay brought the file back ALONE — an orphan
// workspace member with build/check/lint/test scripts and no source, plus six phantom dependencies
// in the lockfile.
//
// The forward risk is worse than the immediate one: with the path present, the NEXT upstream batch
// that adds files under it applies cleanly instead of conflicting, silently re-adopting tooling the
// fork deliberately rejected.
//
// Detector: fork-deleted paths intersected against the working tree. Add an entry whenever the fork
// deletes an upstream path on purpose, with the commit that did it.
export const FORK_DELETED_PATHS: { path: string; why: string }[] = [
  {
    path: 'packages/scripts',
    why: "upstream's release-version tooling, dropped in bc06e84a1f4; the fork releases via its own gallery-release-* workflows",
  },
  {
    path: 'web/src/lib/services/person-user.service.ts',
    why: "upstream's person-sharing UI (immich-31620), dormant in Gallery — specs/2026-10-01-upstream-person-sharing-dormant-design.md",
  },
  {
    path: 'web/src/lib/modals/PeopleFilterModal.svelte',
    why: "upstream's person-sharing UI (immich-31620), dormant in Gallery — specs/2026-10-01-upstream-person-sharing-dormant-design.md",
  },
  {
    path: 'web/src/lib/modals/PeopleFilterUserPicker.svelte',
    why: "upstream's person-sharing UI (immich-31620), dormant in Gallery — specs/2026-10-01-upstream-person-sharing-dormant-design.md",
  },
  {
    path: 'web/src/lib/modals/PersonEditAccessModal.svelte',
    why: "upstream's person-sharing UI (immich-31620), dormant in Gallery — specs/2026-10-01-upstream-person-sharing-dormant-design.md",
  },
  {
    path: 'web/src/lib/modals/PersonEditModal.svelte',
    why: "upstream's person-sharing UI (immich-31620), dormant in Gallery — specs/2026-10-01-upstream-person-sharing-dormant-design.md",
  },
  {
    path: 'web/src/lib/modals/PeopleSelectionModal.svelte',
    why: "upstream's person-sharing UI (immich-31620), dormant in Gallery — specs/2026-10-01-upstream-person-sharing-dormant-design.md",
  },
  {
    path: 'web/src/lib/modals/PersonBulkShareModal.svelte',
    why: "upstream's person-sharing UI (immich-31620), dormant in Gallery — specs/2026-10-01-upstream-person-sharing-dormant-design.md",
  },
  {
    path: 'server/test/medium/specs/repositories/person-user.repository.spec.ts',
    why: "upstream's person-sharing repository tests; sharing cannot run under Option M — pinned instead by person-sharing-dormant.spec.ts",
  },
  {
    path: '.github/ISSUE_TEMPLATE/bug_report.yaml',
    why: "upstream's issue templates, replaced by the single Gallery template in 2eac76f65a2 (#161)",
  },
  {
    path: '.github/pull_request_template.md',
    why: 'PR template enforcement removed in 497543fc83c (#183); Gallery PRs have no template',
  },
  {
    path: 'design/immich-logo-inline-dark.png',
    why: BRANDING_ARTWORK,
  },
  {
    path: 'design/immich-logo-inline-dark.svg',
    why: BRANDING_ARTWORK,
  },
  {
    path: 'design/immich-logo-inline-light.png',
    why: BRANDING_ARTWORK,
  },
  {
    path: 'design/immich-logo-inline-light.svg',
    why: BRANDING_ARTWORK,
  },
  {
    path: 'design/immich-logo-stacked-dark.png',
    why: BRANDING_ARTWORK,
  },
  {
    path: 'design/immich-logo-stacked-dark.svg',
    why: BRANDING_ARTWORK,
  },
  {
    path: 'design/immich-logo-stacked-light.png',
    why: BRANDING_ARTWORK,
  },
  {
    path: 'design/immich-logo-stacked-light.svg',
    why: BRANDING_ARTWORK,
  },
  {
    path: 'design/immich-logo.png',
    why: BRANDING_ARTWORK,
  },
  {
    path: 'design/immich-logo.svg',
    why: BRANDING_ARTWORK,
  },
  {
    path: 'misc/release/notes.tmpl',
    why: "read only by packages/scripts' notes command (deleted above); removed in 949bb7215f5 (#207)",
  },
  {
    path: 'mobile/android/app/src/main/res/drawable/ic_launcher_foreground.xml',
    why: BRANDING_ARTWORK,
  },
  {
    path: 'mobile/android/app/src/main/res/drawable/ic_launcher_monochrome.xml',
    why: BRANDING_ARTWORK,
  },
  {
    path: 'mobile/integration_test/module_login/login_input_validation_test.dart',
    why: "upstream's patrol login integration tests, replaced by the fork's integration_test suite",
  },
  {
    path: 'mobile/integration_test/module_login/login_test.dart',
    why: "upstream's patrol login integration tests, replaced by the fork's integration_test suite",
  },
  {
    path: 'mobile/integration_test/test_utils/general_helper.dart',
    why: "upstream's patrol test helpers, removed with the patrol dependency in 53d9cbb3487 (#114)",
  },
  {
    path: 'mobile/integration_test/test_utils/login_helper.dart',
    why: "upstream's patrol test helpers, removed with the patrol dependency in 53d9cbb3487 (#114)",
  },
  {
    path: 'mobile/lib/pages/common/tab_shell.page.dart',
    why: "upstream's tab shell, replaced by GalleryTabShellPage; nothing navigated to TabShellRoute (INT-DIV-C-031)",
  },
  {
    path: 'mobile/lib/presentation/pages/search/paginated_search.provider.dart',
    why: MOBILE_SEARCH,
  },
  {
    path: 'mobile/lib/presentation/pages/search/search.page.dart',
    why: MOBILE_SEARCH,
  },
  {
    path: 'mobile/lib/providers/search/search_filter.provider.dart',
    why: MOBILE_SEARCH,
  },
  {
    path: 'mobile/lib/providers/search/search_input_focus.provider.dart',
    why: MOBILE_SEARCH,
  },
  {
    path: 'mobile/lib/widgets/search/search_filter/camera_picker.dart',
    why: MOBILE_SEARCH,
  },
  {
    path: 'mobile/lib/widgets/search/search_filter/common/dropdown.dart',
    why: MOBILE_SEARCH,
  },
  {
    path: 'mobile/lib/widgets/search/search_filter/display_option_picker.dart',
    why: MOBILE_SEARCH,
  },
  {
    path: 'mobile/lib/widgets/search/search_filter/filter_bottom_sheet_scaffold.dart',
    why: MOBILE_SEARCH,
  },
  {
    path: 'mobile/lib/widgets/search/search_filter/location_picker.dart',
    why: MOBILE_SEARCH,
  },
  {
    path: 'mobile/lib/widgets/search/search_filter/media_type_picker.dart',
    why: MOBILE_SEARCH,
  },
  {
    path: 'mobile/lib/widgets/search/search_filter/people_picker.dart',
    why: MOBILE_SEARCH,
  },
  {
    path: 'mobile/lib/widgets/search/search_filter/search_filter_chip.dart',
    why: MOBILE_SEARCH,
  },
  {
    path: 'mobile/lib/widgets/search/search_filter/search_filter_utils.dart',
    why: MOBILE_SEARCH,
  },
  {
    path: 'mobile/lib/widgets/search/search_filter/star_rating_picker.dart',
    why: MOBILE_SEARCH,
  },
  {
    path: 'web/src/lib/modals/ClusterGroupUserSelectionModal.svelte',
    why: CLUSTER_GROUPS_UI,
  },
  {
    path: 'web/src/lib/modals/ClusterGroupUsersModal.svelte',
    why: CLUSTER_GROUPS_UI,
  },
  {
    path: 'web/src/routes/(user)/people/PeopleCard.svelte',
    why: PEOPLE_PAGE,
  },
  {
    path: 'web/src/routes/(user)/people/PeopleInfiniteScroll.svelte',
    why: PEOPLE_PAGE,
  },
  {
    path: 'web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/MergeFaceSelector.svelte',
    why: PEOPLE_PAGE,
  },
];

/** True when `file` (repo-relative) is a listed path or sits under a listed directory. */
export function isForkDeletedPath(file: string): boolean {
  return FORK_DELETED_PATHS.some(
    ({ path }) => file === path || file.startsWith(`${path}/`),
  );
}
