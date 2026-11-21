# Saved people order on Explore and visibility management

Issue: https://github.com/open-noodle/gallery/issues/1232

The People page sorts its loaded rows using the persisted `people-view-settings`
preference. Explore and `/people/manage` rendered the server's alphabetical order
instead, so navigating away from People silently changed the selected order.

Both surfaces now use a reactive Gallery singleton manager that delegates to the same
`sortPeople` comparator. Visible people precede hidden people, favorites come
first within each visibility tier, and named people precede unnamed people.
Within those tiers, Name orders alphabetically and Most photos orders by count,
with the existing deterministic tie breakers. Unknown persisted sort values
retain the comparator's Most photos fallback.

Explore sorts before taking the visible preview slice. Visibility management
sorts before projecting to its display-only model, preserving photo counts and
favorite flags for comparison; newly loaded pages are sorted with existing rows.
Changing the preference updates both views reactively without mutating the source
arrays. Toggling visibility remains staged in the modal, so a click does not move
the tile before saving.

`peopleSortManager` uses `fromStore` to read the existing persisted preference
reactively; it adds no new store or persisted state. The manager follows the
web's `*.svelte.ts` singleton class convention inside `gallery/managers/`, as
required by the root rule keeping new fork code in its namespace.

This remains a client-side sort of loaded rows, matching the People page. It does
not change API pagination, permissions, people type filters, or mobile behavior.
Older Gallery and stock Immich servers require no new fields or endpoints.
Old app/new server behavior stays unchanged; new web/old server sorts the same
existing fields, and stock Immich clients see no change.

Route-adjacent `page.gallery.spec.ts` files use `#test/unit/fixtures.ts`, real
page loaders and the mock API. Coverage checks both sort modes and preference
changes, staged visibility edits, a second page fetched through the API, hidden
people and the preview slice. Only the preview row's CSS-dependent capacity is
stubbed; the real page layouts render inside the fixture's standard host.

The two upstream route files gain only a Gallery manager import and a call.
Against `refs/upstream/v3.4.2`, Explore grows from +25/-10 to +28/-11 and
visibility management from +44/-145 to +46/-145; all new logic stays in Gallery.
