# Searching in the Mobile App

The Gallery mobile app searches your library without leaving the timeline. Results replace the photos on screen as you add filters, every filter option shows how many photos it would leave, and the same search works inside albums, Spaces and most other photo screens.

This page covers the app. For the web app, see [Searching](/features/searching) and the [Search Palette](/features/search-palette).

:::note Server version
Search works best with a Gallery server from v5.10.0 on. Connected to an older Gallery server, the filters still work, but the options show no photo counts.
:::

## Opening search

- **Photos tab:** tap the round search button in the bottom bar.
- **Other photo screens** (an album, a Space, a person, a place, Favorites and more; see [Where you can search](#where-you-can-search)): tap the search button in the Years/Months pill at the bottom of the screen.

The screen switches to search mode in place: a search field and a row of filter chips appear at the top, and the photo grid stays underneath. The keyboard does not open until you tap the field.

Tap **←** (or Android's back gesture) to leave search mode. This clears every filter and takes you back to where you were in the timeline.

## The search field

Type in the field to get suggestions grouped into **People**, **Tags**, **Places** and **When**, each with a photo count. Pick one to apply it as a filter.

- Start with **`@`** to suggest only people, or **`#`** to suggest only tags.
- Places match a city or a country name ("lis" finds Lisbon).
- Dates match years that have photos ("2019"), decades ("2010s" or "10s") and month names ("june").
- The last suggestion, **Photos that look like "…"**, runs a [Smart Search](/features/searching) for what you typed. Pressing Enter does the same.

Suggestions only offer what is still possible with the filters you have already chosen. With Kyoto selected, `@a` only suggests people who appear in your Kyoto photos.

A Smart Search shows as a token in the field, and results switch to **Relevance** order. Tap the token's ✕, or press backspace in the empty field, to remove it.

## Filter chips

The chip row holds **People**, **When**, **Places** and **Tags**, then any other filters you have turned on, then **Filters**. Tap a chip to open its sheet. A chip that is in use shows what you picked ("Anna, Ben", "Jun 2024", "Kyoto", "#beach").

Choices apply as you make them: the photos behind the sheet update straight away, and the sheet's button reads **Show N photos**. Tap it, or tap outside the sheet, to close it. **Clear** in a sheet's header clears that one filter. Once two or more filters are on, a **Clear all** chip appears at the end of the row.

### People

Pick one or more people to see photos that have **all** of them. Selected people sit at the top, then a short row of recent people, then everyone else with their photo counts.

- The search box at the top finds a person by name.
- Sort by **Most photographed** or **A–Z**. The app remembers your choice.
- If your library has pets, an **All / People / Pets** switch narrows the list.

### When

Quick ranges (**Today**, **This week**, **This month**, **This year**) sit at the top, then every year with matching photos, newest first, with counts. Tap a year to pick it, or open **Months** to pick a month in that year. Months with no photos are greyed out.

You can pick one period at a time. For any other range, use **Date range** in the Filters sheet.

### Places

Countries are listed with their photo counts. Tap a country to pick all of it, or open **Cities** beside it to pick one city. The search box matches cities and countries, and opens a country at the cities that match. Sort by most photos or A–Z.

### Tags

Selected tags are at the top, then every tag with its count. When you are browsing, results show photos with **any** of the selected tags. Once a Smart Search is active, they show photos with **all** of them. The hint above the tags says which applies.

Picking a tag turns **Untagged only** off, and the other way round.

### The Filters sheet

**Filters** holds everything else. Its badge counts the filters you have turned on in it.

| Section        | What it does                                                                               |
| -------------- | ------------------------------------------------------------------------------------------ |
| Favorites only | Only your favorites.                                                                       |
| Photo or video | All, photos only or videos only.                                                           |
| Rating         | At least the number of stars you pick.                                                     |
| Camera         | A camera make, then optionally one of its models.                                          |
| Albums         | Any, photos that are in an album, or photos that are not in one.                           |
| Text           | Text **In the photo** (OCR), the file name and the description. You can fill in all three. |
| Date range     | Photos taken between two dates.                                                            |
| Archived only  | Only archived photos.                                                                      |
| Untagged only  | Only photos without tags.                                                                  |

With a Smart Search active, the file name and description fields do not apply. In-photo text still does.

Tap a section's title to fold it away. The cog at the top of the sheet lets you hide sections you never use. A hidden section still shows while it has a filter set, so you can always change it. The app remembers both choices.

Filters added here also appear as chips in the chip row, each with a ✕ to remove it.

### Options that are hidden or greyed out

Filters react to each other, following the same rules as the web app's [dynamic filter suggestions](/features/dynamic-filter-suggestions):

- A chip or section that could never filter anything on this screen is hidden. For example, Tags is hidden if nothing is tagged.
- A chip or section that your current filters have emptied is greyed out and cannot be tapped. Remove a filter and it comes back.
- All five rating stars and all three photo/video choices always show, so their meaning never shifts.

## Results

The header above the results shows the exact number of matches and the sort order: **Newest first**, **Oldest first**, or **Relevance** while a Smart Search or a similar-photo search is active. While a new answer is on its way, the header reads **Searching…** and the previous results stay on screen, dimmed.

Results are grouped like the normal timeline, so the Years/Months pill still works. You can open photos, select several and use the usual actions on them. **View in timeline** on a result leaves search mode and jumps to that photo in the normal timeline.

### Similar photos

**View similar photos** on a photo opens search with a **Similar to this photo** token in the field. Results are photos only, sorted by how similar they are, and you can narrow them with any of the chips.

## Where you can search

Search is limited to the screen you open it from. The field's placeholder says where you are, for example "Search in Japan 2023".

| Screen         | Searches                                                                |
| -------------- | ----------------------------------------------------------------------- |
| Photos         | Your timeline, including partners and Spaces shown in it.               |
| Album          | That album.                                                             |
| Space          | That Space. People are the Space's people.                              |
| Space album    | That album only.                                                        |
| Person         | That person's photos. You can add more people.                          |
| Place          | That city.                                                              |
| Favorites      | Your favorites, including the ones in partners' photos and your Spaces. |
| Archive        | Your archived photos.                                                   |
| Videos         | Your videos.                                                            |
| Recently added | Your recent uploads, newest upload first.                               |
| Recently taken | Your recently taken photos.                                             |

A filter the screen already fixes is left out. For example, Albums does not appear inside an album, and Places does not appear on a place page.

Search is not available on the folder view, the map, device-only albums, the trash and the locked folder.
