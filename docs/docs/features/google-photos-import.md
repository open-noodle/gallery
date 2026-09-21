# Google Photos Import

Gallery imports a Google Photos Takeout export straight from the web app. The importer runs in your browser: it scans the ZIP files or Takeout folder you pick, matches Google's metadata sidecars to the media files, and uploads each item through the normal upload API. It can recreate albums from the Takeout folders too.

Open **Import** from the Gallery app, choose **Google Photos**, then select either:

- one or more `.zip` files from Google Takeout
- an extracted Takeout folder

Keep the browser tab open until the import finishes.

## Import flow

1. Source: choose Google Photos.
2. Files: select Takeout ZIP files or an extracted folder.
3. Scan: Gallery reads media files and Google metadata sidecars locally in the browser.
4. Review: confirm the number of photos, videos, dates, locations, favorites, archived items, and detected albums.
5. Import: Gallery uploads items one by one and creates the selected albums.

In the review step you choose whether to import favorites, archived state and descriptions, and whether to skip duplicates that already exist on the server.

## Preserved metadata

When a matching Takeout sidecar is available, Gallery imports:

- original taken date
- GPS coordinates
- description
- favorite state
- archived state
- album membership derived from Takeout folder names

If an item has no date metadata, Gallery warns you at the review step and falls back to the file date when uploading.

## Album detection

Takeout albums are detected from paths shaped like:

```text
Takeout/<Google Photos root>/<Album name>/<file>
```

Gallery recognizes localized Google Photos root folders such as `Google Fotos` and `Google フォト`, alongside the English `Google Photos`. Non-English Takeout exports therefore keep their album structure through the scan.

Auto-generated Takeout folders like **Photos from 2023** are listed, but not selected by default. Before importing you can select all albums, deselect all of them, or pick individual ones.

## Sidecar matching

Google has changed Takeout sidecar naming several times. Gallery matches the common forms, including:

| Sidecar shape                                      | Example                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| Classic appended `.json`                           | `IMG_1234.jpg.json`                                                  |
| 2024+ supplemental metadata suffix                 | `IMG_1234.jpg.supplemental-metadata.json`                            |
| Truncated supplemental suffixes                    | `IMG_1234.jpg.supplemental-me.json`                                  |
| Duplicate-index variants                           | `IMG_1234.jpg(1).json`, `IMG_1234.jpg.supplemental(1).json`          |
| Sidecars missing the media extension               | `Peanut Butter Balls.supplemental-metadata.json`                     |
| Edited copies sharing the original sidecar         | `IMAG0061.JPG.supplemental-metadata.json` plus `IMAG0061-edited.JPG` |
| Localized edited suffixes confirmed by Google data | `-edited`, `-modifié`, `-bearbeitet`, `-modificato`                  |

A sidecar is only matched to media files in the same folder. Non-Takeout JSON files such as `metadata.json`, `print-subscriptions.json`, shared album comments, or JSON from other Takeout services are ignored.

## Duplicate behavior

The importer derives a stable upload identifier from the Takeout data and leans on the normal server-side duplicate detection. With **Skip duplicates already in Immich** enabled, duplicates count as skipped. They can still go into albums, as long as the server returns the existing asset id.

## Limits

- The import runs in the browser, so very large Takeouts are limited by browser memory and tab lifetime.
- Uploads run one at a time. You can pause and resume within the current tab session, but closing the tab stops the import.
- Live Photo edge cases, where the video sidecar uses a different duplicate index than the still photo, may still need manual review.
