# Map Filtering

The map view has the same filter panel as the Photos and Spaces pages, and the same set of filter sections. You can filter map markers by people, location, camera, tags, rating, favorites, media type, album membership, text, and date range.

## How it works

Open the map from the sidebar, or from a Space's map button. The filter panel sits on the left, expanded by default.

- People: show only photos containing specific people
- Location: narrow to a country or city by name, alongside panning the map itself
- Camera: filter by camera make and model
- Tags: narrow to photos with specific tags
- Rating: minimum star rating
- Favorites: toggle between all photos and favorites only
- Media type: photos, videos, or both
- Albums: restrict to photos that are, or are not, in any album
- Text: match on description, original file name, or text recognised in the image (OCR)
- Timeline: pick a year or month to see photos from that period

Markers update as you change filters. Click a cluster and the timeline panel respects your active filters too, so its counts stay scoped to the filtered result set.

## Searching the map

Press <kbd>Cmd</kbd>+<kbd>K</kbd> or <kbd>Ctrl</kbd>+<kbd>K</kbd> on the map and type a free-text query. Gallery adds it to the current map URL as `q=...` and combines it with the active map filters.

Map search runs a smart search, then intersects those results with the geotagged marker set. Clearing the search chip drops the query. Your other map filters stay.

## Global map vs. space map

The global map (`/map`) shows your own geotagged photos, with filter suggestions drawn from your whole library. A space map (`/map?spaceId=...`) is scoped to one space. Its suggestions only offer people and cameras that exist in that space.

## Location filtering on a map

The map itself is the main location filter: pan and zoom to explore geographically. Use the Location section when you want to jump straight to a named country or city instead of navigating there by hand. The two intersect. A city filter combined with a zoomed-in viewport shows only the markers that satisfy both.
