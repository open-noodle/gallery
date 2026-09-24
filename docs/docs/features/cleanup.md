# Library Cleanup

Library Cleanup helps you work through a large library in short sessions. It does two things:

- **Rewind** shows you every photo taken on one calendar date, across all past years, so you can look back at them and decide what to keep.
- **Queues** collect photos that are likely candidates for removal: very large files, bursts, screenshots, and blurry or badly exposed shots. Each queue can be worked down to zero.

Nothing in Cleanup deletes a photo permanently. Photos you remove go to the trash, where you can restore them until the trash is emptied. The one exception is a server where the administrator has turned the trash off: there, Cleanup deletes photos permanently, and asks you to confirm a permanent delete every time.

## Where to find it

Open **Utilities** in the sidebar and choose **Cleanup**. It is the first entry under "Organize your library".

The Cleanup page shows:

- a calendar of the year, with one cell per date;
- the list of queues, each with the number of items and the space it could free;
- a **Rewind today** button;
- the size of your trash, with a button to empty it.

## Rewind and the calendar

The calendar has one row per month and one cell per day. A cell is shaded by how many photos you took on that date across all years. Dates you have finished are shown in green, and today is outlined. Hover over a date to preview its photos, then choose **Rewind this day** to open it.

A rewind page lists the date's photos grouped by year, newest year first. For each photo you can:

- **Keep** it (`K`);
- mark it as a **favourite** (`F`), which also keeps it;
- mark it for the **trash** (`Delete`);
- leave it as it is.

Marks are only saved when you choose **Move N to trash** or **Finish day**. Finish day moves the marked photos to the trash, saves your keeps and favourites, and marks the date as reviewed on the calendar. If you try to leave the page with marks that have not been saved, Gallery asks you to confirm first.

Other controls on the rewind page:

- **Grid** or **One at a time**: grid is the default. One at a time shows a single large photo with the next few photos below it. When the photo looks blurry, too dark or overexposed, or was taken within two seconds of another photo, a **Hints** card links to the Blurry & botched or Bursts & series queue.
- **Hide reviewed** (on by default): hides photos you kept in an earlier session.
- **Keep all remaining**: keeps every unmarked photo in a year.
- The arrow buttons move to the previous or next date.
- `Space` opens the focused photo in the viewer, and `Z` undoes the last mark. `Shift+Enter` finishes the day.

The header shows your streak: the number of consecutive days, ending today or yesterday, on which you finished at least one date.

29 February has a cell of its own. Photos are placed on a date by the local time at which they were taken, so a photo moves to a new date straight away if you edit its capture date.

## Queues

Each queue page acts immediately. After you trash photos from a queue, a notification offers **Undo** for a few seconds.

| Queue                | What it contains                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Space hogs**       | Your largest files, biggest first. You can show videos, photos or both, and set a minimum size (100 MiB by default). A live photo's size includes its video part.                                                                           |
| **Bursts & series**  | Groups of photos taken within about two seconds of each other: camera bursts, and shots of the same moment that look nearly identical. Gallery suggests the sharpest photo to keep. You can keep one, keep all, or stack the group instead. |
| **Screenshots**      | Screenshots and screen recordings. They are recognised by file name, or, for files with no camera information, by being a PNG or having a very wide or tall shape.                                                                          |
| **Blurry & botched** | Photos that look out of focus, too dark or overexposed. A strictness setting (lenient, balanced or strict) controls how blurry a photo must be to appear. Photos with faces are hidden by default.                                          |
| **Duplicates**       | The number of duplicates found, with a link to the existing [Duplicates utility](./duplicates-utility.md).                                                                                                                                  |

The Screenshots and Blurry & botched queues depend on a background analysis of your photos. Until it has finished, those queues show how much of your library has been analysed so far.

### What "keep" means

Choosing **Keep** (or **Not a problem**) on a photo removes it from that queue for good. It will not appear in that queue again, even if the queue's rules would still match it.

A keep applies to one queue only. Keeping a photo in Blurry & botched does not hide it from Space hogs or Bursts & series. Keeping a photo in a rewind marks it as seen.

## Trash and freeing space

Every photo removed through Cleanup goes to the regular trash. You can restore it from there, and restored photos appear in the queues again.

Storage is only freed when the trash is emptied, either with the **Empty** button on the Cleanup page, from the Trash page, or when items are removed automatically after the trash retention period.

If a photo you are about to trash is also in a [Shared Space](./shared-spaces.md), Gallery warns you first: trashing it removes it for the other members of that space as well.

If the trash is turned off on your server, there is no trash to restore from. Every Cleanup action that would move photos to the trash asks you to confirm a **permanent delete** instead, no **Undo** is offered afterwards, and the Cleanup page does not show a trash size or **Empty** button.

## Which photos are included

Cleanup only ever shows **your own** photos and videos. It includes archived items, because they still take up space.

It leaves out:

- photos from [external libraries](./libraries.md), because trashing them in Gallery does not free the file on disk;
- items in the locked folder;
- offline files;
- photos already in the trash.

In the queues, a stack is represented by its primary photo only.

## For administrators: quality analysis

The Screenshots and Blurry & botched queues use scores from the **Quality analysis** job. It runs automatically for new uploads, after their thumbnails are generated.

To analyse an existing library, or to run the analysis again, go to **Administration** > **Jobs**, find **Quality analysis**, and choose:

- **Missing** to analyse only the photos that have not been analysed yet;
- **All** to analyse every photo again.

Edited photos are scored from their original, unedited version.
