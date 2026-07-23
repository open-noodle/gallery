# Map Filtering

The map view supports the same filter panel available on the Photos and Spaces pages, with the same set of filter sections. Filter map markers by people, location, camera, tags, rating, favorites, media type, album membership, text, and date range.

## How it works

Open the map from the sidebar or from a Space's map button. The filter panel appears on the left side, expanded by default.

- **People** — show only photos containing specific people
- **Location** — narrow to a country or city by name, alongside panning the map itself
- **Camera** — filter by camera make and model
- **Tags** — narrow to photos with specific tags
- **Rating** — minimum star rating
- **Favorites** — toggle between all photos and favorites only
- **Media type** — photos, videos, or both
- **Albums** — restrict to photos that are, or are not, in any album
- **Text** — match on description, original file name, or text recognised in the image (OCR)
- **Timeline** — pick a year or month to see photos from that period

Markers on the map update as you change filters. When you click a cluster, the timeline panel also respects your active filters and its counts stay scoped to the filtered result set.

## Searching the map

Use <kbd>Cmd</kbd>+<kbd>K</kbd> or <kbd>Ctrl</kbd>+<kbd>K</kbd> from the map and submit a free-text query. Gallery applies the query to the current map URL as `q=...` and combines it with the active map filters.

Map search uses smart search to find matching assets, then intersects those results with the geotagged marker set. Clearing the search chip removes only the query and keeps the other map filters intact.

## Global map vs. space map

- **Global map** (`/map`) — shows your own geotagged photos with global filter suggestions
- **Space map** (`/map?spaceId=...`) — scoped to a specific space, with space-aware filter suggestions (only people and cameras that exist in that space)

## Location filtering on a map

The map itself is the primary location filter — pan and zoom to explore geographically. The **Location** section complements it when you want to jump straight to a named country or city rather than navigating there by hand; the two intersect, so a city filter combined with a zoomed-in viewport shows only markers satisfying both.
