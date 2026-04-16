# Search Palette

A keyboard-driven command palette that searches everything in your library — photos, people, places, tags — and jumps to any admin or settings page, all from one input. Press <kbd>Cmd</kbd>+<kbd>K</kbd> (macOS) or <kbd>Ctrl</kbd>+<kbd>K</kbd> (Windows / Linux) to open it from anywhere in Gallery.

The classic search bar in the navbar still works exactly as before. The palette is a second, faster entry point optimised for "I know what I'm looking for, get me there in three keystrokes".

## What you can search

Each query runs in parallel against five providers and groups the results into named sections:

| Section        | What it returns                                                              |
| -------------- | ---------------------------------------------------------------------------- |
| **Photos**     | Top smart-search matches with thumbnails. Activate to open the asset viewer. |
| **People**     | Named faces from your library and any shared spaces you can access.          |
| **Places**     | Cities, regions, and countries from your reverse-geocoded photos.            |
| **Tags**       | Tags assigned to your assets, plus inherited tags from parent tags.          |
| **Navigation** | Admin and settings pages — fuzzy-matched against the live page catalog.      |

Empty sections collapse silently so the result list stays tight. If smart search is unhealthy (the ML server is unreachable), a banner appears at the top of the palette and offers a one-tap switch to filename mode.

## Search modes

The footer shows the current matching mode for the **Photos** section. Press <kbd>Ctrl</kbd>+<kbd>/</kbd> to cycle through them:

- **Smart** — CLIP semantic search ("photos of a kitten on a couch")
- **Filename** — Substring match against the original file name
- **Description** — Substring match against your photo descriptions
- **OCR** — Substring match against text extracted from your photos

The other four sections (People, Places, Tags, Navigation) are unaffected by the mode — they always run their own provider.

## Top result band

When your query closely matches a single navigation entry, that entry is promoted to a **Top result** band at the top of the list. Hitting <kbd>Enter</kbd> activates it immediately, no arrow keys needed.

Promotion is based on a fuzzy score against the page title, description, and search keywords. A short query like `peo` will surface **People** as the top result; `tags` will surface **Tags**; `users` will surface **Administration → User Management**.

## Recents

Every result you activate is added to a **Recent** list (per user, per browser). When you reopen the palette with an empty query, your last few activations are shown immediately so you can repeat a workflow with two keystrokes.

- Recent entries that are no longer accessible (admin pages after a demotion, deleted people, removed tags) are filtered out automatically the next time you open the palette.
- Remove a single entry with the **×** button on the row, or with <kbd>Delete</kbd> while it's highlighted.

## Quick links fallback

When you open the palette for the first time on a fresh browser — no recents yet — a curated set of **Quick links** is shown instead, so the empty state is still useful. The quick-link set is admin-aware: non-admins don't see admin destinations.

## Preview pane

On large screens (≥ `lg` breakpoint) a preview pane appears to the right of the result list:

- **Photos** → larger thumbnail with file name and an **Open** affordance
- **People** → face thumbnail with the person's name
- **Places** → region/country breakdown
- **Tags** → tag value with parent path

The preview updates as you arrow up and down through the list. On smaller screens it's hidden — the result list takes the full width and previews don't get in the way.

## Keyboard reference

| Key                                                        | What it does                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| <kbd>Cmd</kbd>+<kbd>K</kbd> / <kbd>Ctrl</kbd>+<kbd>K</kbd> | Open the palette from anywhere                                      |
| <kbd>Esc</kbd>                                             | Close the palette                                                   |
| <kbd>↑</kbd> / <kbd>↓</kbd>                                | Move through results — wraps at top/bottom                          |
| <kbd>Enter</kbd>                                           | Activate the highlighted result                                     |
| <kbd>Delete</kbd>                                          | Remove the highlighted **Recent** entry                             |
| <kbd>Ctrl</kbd>+<kbd>/</kbd>                               | Cycle the Photos search mode (smart → filename → description → OCR) |
| <kbd>Shift</kbd>+<kbd>T</kbd>                              | Toggle the theme (light / dark)                                     |

## How it stays responsive

- Each provider runs on its own **150 ms debounce** with a **5 s timeout** via `AbortSignal.timeout`. A slow people query never blocks photos from rendering.
- The palette uses a **stale-while-revalidate** rule: when a query is being re-run, the previous successful results stay visible until new ones arrive. No skeleton flash between keystrokes.
- A thin **progress stripe** appears across the top after a 200 ms grace window if any provider is still in flight, so you know work is happening when results are slow.
- The navigation provider runs **synchronously** against an in-memory catalog of admin/settings pages, so you see jumps from the very first keystroke even before the network comes back.
