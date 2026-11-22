# Full-path search in the Gallery palette

Issue: [Gallery 1319](https://github.com/open-noodle/gallery/issues/1319).

## Existing support and missing entry point

Immich already provides MetadataSearchDto.originalPath, a case/accent-insensitive substring predicate with literal wildcard escaping, and a full-results screen that accepts it. Its original search UI offers “Full path or folder.” Gallery's replacement palette exposed only smart, filename, description and OCR modes, so users could not select the existing path search there. Filename search correctly targets the filename column and keeps that meaning.

Expose the existing fullPath query type in both palette mode controls. Reuse the upstream full_path_or_folder translation and the existing metadata API. No new endpoint, DTO field, migration, index, setting or translation is introduced.

## Literal input and mode transitions

In full-path mode the entire trimmed input is literal, preserving internal spaces, slashes, backslashes, quotes, percent signs, underscores and colons. A leading slash must not become the palette's collections prefix, nor may person:Alice inside a path become a people token. Other modes retain their prefix and typed-search grammar.

Switching into or out of full-path mode reruns query classification and provider dispatch, including cancellation/debounce handling. This prevents a collections-only batch from surviving a switch into a path query. Persist the mode under the existing searchQueryType key. Navigation and command promotion are suppressed in path mode so a folder named photos or theme cannot turn Enter into an unrelated action. One shared mode order drives the global and input-local Ctrl+/ shortcut, including wraparound.

## Preview and complete results

The photo provider sends originalPath using the existing metadata endpoint. Enter, the query result and “See all” route to the existing /search?query=… full-results screen. Time-bucket APIs have no original-path predicate; sending a path to the filtered timeline would silently ignore it, so that is deliberately avoided.

Preview and complete results use the same terms. Existing panel filters are converted through filterStateToSearchTerms, the same adapter used to collect all matching assets from a timeline. Text-path matching is ANDed with those filters.

| Starting surface | Metadata search scope |
| --- | --- |
| Photos | Existing global metadata scope, withSharedSpaces: true, preserving libraryViewOptions |
| Recently Added | Personal/partner metadata scope, withSharedSpaces: false |
| Other global pages | Existing global metadata scope, withSharedSpaces: true |
| Album detail | Route's albumIds, withSharedSpaces: false |
| Album opened through a Space | Album scope only, exactly like createAlbumTimeline.collectTerms |
| Space photos | spaceId, withSharedSpaces: false; bare person ids move to spacePersonIds |

All requests explicitly use Timeline visibility, matching the palette's existing policy even during an elevated session. The results URL leaves `visibility` out because the results page applies the same Timeline default itself; written into the URL it would show as an "In archive: timeline" filter chip. The server's existing access checks remain authoritative. This change adds no authorization gate or grant. An album route overrides any stale album filter, and an explicit false prevents the results screen's global shared-spaces default from widening a scoped request.

On a path results page the existing search header displays the searched path instead of the generic legacy-search notice. The existing palette button remains available. Other searches keep their current header.

## Compatibility and layering

Old Gallery clients and stock Immich apps are unchanged. The new web client calls the original-path field already supported by the current Immich base and older Gallery servers. Existing shared-space fields and scopes are reused. An older Gallery palette encountering the persisted fullPath mode applies its existing unknown-mode fallback; upstream's older search manager already recognizes the same query type.

New helpers and regression tests live in web/src/lib/gallery/search/; the result-page regression is a sibling page.gallery.spec.ts. The palette files are existing fork-owned paths in docs/fork/ownership.yml, absent from the Immich tag. Upstream routes retain narrow calls into fork modules.

Compared with refs/upstream/v3.4.2, root +layout.svelte divergence shrinks from +71/-30 to +70/-30 by replacing its local mode-cycle array with one helper call. The search page remains +34/-23: its existing fork component call gains an optional prop without increasing changed-line count. The route spec shrinks from +176/-0 to +120/-0 by moving its fork-only call-site guard to route.gallery.spec.ts. That guard allows the full-path helper as a deliberate metadata landing-page link, while retaining its prohibition on new contextual-search links elsewhere. No server, SDK, mobile or upstream locale file changes.

## Verification

The missing menu option was reproduced in Chromium before the change. Browser regressions cover both mode controls, persisted selection, absolute and Windows paths, prefix/token literals, switching back to collections search, preview API terms, complete-result navigation, scope/filter preservation, and space-person id handling. The actual results page is exercised through its loader and mock-API fixture to verify that it posts the path to metadata search and displays it. Existing manager, mode-control, palette and search-page suites check regressions in the other modes. The new mode tests isolate localStorage and disable cross-tab store synchronization inside their iframe so saved full-path/library preferences cannot leak into parallel browser specs.
