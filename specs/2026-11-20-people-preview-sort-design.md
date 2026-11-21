# Saved people order on Explore and visibility management

Issue: https://github.com/open-noodle/gallery/issues/1232

The People page sorts its loaded rows using the persisted `people-view-settings`
preference. Explore and `/people/manage` rendered the server's alphabetical order
instead, so navigating away from People silently changed the selected order.

Both surfaces now use a reactive Gallery store that delegates to the same
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

This remains a client-side sort of loaded rows, matching the People page. It does
not change API pagination, permissions, people type filters, or mobile behavior.
Older Gallery and stock Immich servers require no new fields or endpoints.

Regression coverage renders Explore and visibility management, checks both sort
modes and preference changes, and verifies appended rows and the preview slice.
The two upstream route files gain only a Gallery store import and a call;
their diff against the pinned Immich tag grows by this small seam.
