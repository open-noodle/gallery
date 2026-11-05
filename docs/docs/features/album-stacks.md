# Stacks in Albums

A stack groups related photos, such as a burst, a RAW and its JPEG, or several takes of the same shot, behind one thumbnail. On the timeline a stack shows as a single photo with a count badge, and opening it shows every photo in the stack along the bottom of the viewer.

Albums on the web now show stacks the same way. Before, an album showed each stacked photo on its own, and only opening one revealed that it belonged to a stack.

:::note
The mobile app collapses stacks in albums and in a space's albums the same way. The settings below are web-only: on the phone the stack icon carries no count, and opening a stack always shows all of its photos.
:::

## Which photo an album shows

An album shows one photo per stack:

- the stack's **primary photo**, if the album holds it;
- otherwise, of the stack's photos the album holds, the **earliest**.

Photos of the stack that are not in the album are never added to it. Collapsing changes only how the album displays the photos it already holds.

### With filters

When you filter an album (by favorites, a person, a place, a date…), a photo is never hidden behind a stack-mate that the filter leaves out. The stack shows its best-ranked photo _among the photos that match_. So the thumbnail that stands for a stack can change as you change filters. For example, an unfiltered album shows the primary, while the Favorites filter shows the stack's favorite.

### In shared albums

Only **your own** stacks collapse. Opening a stack is limited to its owner, so in an album shared with you, someone else's stacked photos stay separate and carry no badge: collapsing them would hide photos you could never open.

## Settings

Open the album's **⋮** menu. Both settings are off by default and are remembered in your browser.

| Setting                                                | Off (default)                                            | On                                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Count only this album's photos in stacks**           | The badge counts every photo in the stack.               | The badge counts only the stack's photos in this album. A stack with just one photo in the album shows no badge. |
| **Show only this album's photos when opening a stack** | The viewer's stack strip shows every photo in the stack. | The strip shows only the stack's photos in this album, and none when the album holds just one.                   |

With the strip setting on, the stack actions in the viewer (Unstack, Keep this, delete others…) still act on the **whole** stack.

## Stacking and unstacking in an album

Select photos in an album and open the selection's **⋮** menu to **Stack** or **Unstack** them, as on the Photos page (or press `s` to stack). These appear when every selected photo is yours.

After any change to a stack, and after adding or removing a stacked photo, the album reloads so it shows the right photo for each stack. For example, removing the stack's photo from the album brings its next photo in the album into view with the badge, and adding the stack's primary makes the album show the primary. If you remove the stack's photo from the album while viewing it, the viewer moves to the stack's next photo in the album rather than the album's next photo.

| Action                   | What the album shows afterwards                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| Stack                    | One thumbnail for the selection. The first photo you selected becomes the primary.                |
| Unstack                  | Every photo of the stack that the album holds shows on its own again.                             |
| Remove from stack        | That photo shows on its own.                                                                      |
| Set as primary           | It becomes the album's thumbnail if the album holds it; otherwise the album's photo stays.        |
| Add uploads to stack     | The badge grows. The uploads join the stack but are not added to the album.                       |
| Keep this, delete others | The other photos of the stack are deleted from your **library**, including ones not in the album. |

:::warning
**Keep this, delete others** deletes photos from your whole library, not just from the album. Inside an album, its confirmation says so and tells you how many photos it will delete.
:::
