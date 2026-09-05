# Space Album Folders

Album folders give a [Shared Space](shared-spaces.md)'s [Albums tab](space-albums.md) a shape. Instead of one flat list, albums can sit inside **folders**, and folders can sit inside other folders — so a space with twenty-five albums can be grouped by continent, by trip, by year, or by whatever the group actually thinks in.

A shared space fills up faster than a personal library, because several people fill it at once. Sorting and searching help you find an album whose name you already know; folders are what let you see what a space _contains_.

:::info Permissions Model
Folders follow the same three roles as the rest of Shared Spaces — **Owner**, **Editor**, and **Viewer**. Owners and Editors arrange the structure; Viewers browse it read-only. See [Roles and Permissions](#roles-and-permissions).
:::

## How it works

- **A real tree.** A folder holds albums and other folders, nested up to 10 levels deep. Folders and albums appear side by side on the same tab, so an album never has to be filed anywhere to stay reachable.
- **Nothing is copied or moved.** A folder is only a placement. Putting an album in a folder does not change the album, its owner, its photos, or who can see it — it changes where it appears on the Albums tab.
- **Counts are recursive.** A folder card shows the number of albums in its whole subtree, not just its direct children. A folder holding two subfolders of three albums each reads "6 albums".
- **Covers come from the subtree.** Each folder card shows a mosaic of up to four album covers drawn from everything beneath it, newest photo first. The order is stable, so the same folder does not reshuffle its collage between refreshes.
- **Deleting a folder never deletes its contents.** Direct children are promoted one level up, albums are never unlinked, and the structure below the deleted folder is preserved.

## Roles and Permissions

| Permission                            | Owner | Editor | Viewer |
| ------------------------------------- | ----- | ------ | ------ |
| Browse folders and open them          | Yes   | Yes    | Yes    |
| See folder counts and cover mosaics   | Yes   | Yes    | Yes    |
| Search albums across the whole space  | Yes   | Yes    | Yes    |
| Create a folder                       | Yes   | Yes    | No     |
| Rename a folder                       | Yes   | Yes    | No     |
| Move a folder to another parent       | Yes   | Yes    | No     |
| Delete a folder                       | Yes   | Yes    | No     |
| Move an album into or out of a folder | Yes   | Yes    | No     |

Folder names are member-only information: a non-member asking for a space's folders is refused outright rather than handed an empty list.

## Creating and arranging folders

### Create a folder

On the Albums tab, select **New folder**. The folder is created wherever you currently are — at the space root, or inside the folder you have open.

### Move things around

Albums **and** folders can be dragged. The drop targets are folder cards and the crumbs in the breadcrumb, so dragging onto a crumb is how you move something back up a level (or all the way to the space root).

An album's **⋮** menu also offers **Move to folder…**, which opens a picker — the non-drag route to the same thing, and the easier one on a long list.

### Rename or move a folder

A folder's **⋮** menu offers **Rename folder** and **Move to folder…**. Renaming and moving in one step is supported — the folder ends up with the new name in the new place, or neither change applies.

A folder cannot be moved into itself or into one of its own descendants. The move is re-checked against the tree at the moment it is written, so two editors reorganising at the same time cannot produce a loop that nothing can reach.

### Delete a folder

**Delete folder** promotes the folder's direct children — albums and subfolders alike — one level up, into wherever the deleted folder was. The confirmation says so: _"Albums inside it will move up one level. Nothing is unlinked."_

Deletion is refused when promoting a child would collide with a name that already exists at the destination, and the error says which name is in the way. There are two shapes of this, and they need opposite fixes:

- A collision with an **existing sibling** at the destination — go and look at the destination.
- A collision with the **folder you are deleting**, whose name is still taken while its children are promoted past it — rename the child first.

## Browsing

- A **breadcrumb** across the top of the Albums tab shows where you are (`Albums › Europe › Italy`) and takes you back up a level, or all the way out, in one click.
- The existing toolbar keeps working inside a folder: the same search box, sort, group-by and cover/list controls described in [Space Albums](space-albums.md#the-albums-tab).
- **Search leaves the tree.** Typing a query switches the tab out of folder browsing and into a flat list of every matching album in the space, wherever it lives, each labelled with its folder path. Clearing the query puts you back where you were. Search matches album names and descriptions — not folder names.
- **Creating during a search clears it.** A search hides the breadcrumb and every folder row, but **New folder** and album linking stay enabled and keep targeting the folder you were in — so the result would land somewhere you can neither see nor be told about. Creating or linking therefore drops the query, to put the thing you just made back on screen.

## On mobile

The Gallery mobile app is at parity: it browses the same tree with the same breadcrumb and recursive counts, and Owners and Editors can create, rename, move and delete folders and move albums between them there too. A space arranged on a laptop opens arranged on a phone.

## Limits

| Limit              | Value                                             |
| ------------------ | ------------------------------------------------- |
| Nesting depth      | 10 levels                                         |
| Folders per space  | 500                                               |
| Folder name length | 128 characters                                    |
| Sibling names      | Must be unique within their parent, ignoring case |

"Ignoring case" means `Italy` and `italy` cannot both sit in the same parent, but either may coexist with an `Italy` under a different parent. Exceeding the depth or the per-space cap is refused with a message naming the limit.

## Notes and limitations

- **Folders are per space.** They are not shared between spaces, and they have nothing to do with the [Folder view](folder-view.md) of your own library, which reflects on-disk storage paths.
- **Unlinking an album from the space** removes it from whatever folder it was in; the folder itself stays.
- **An album lives in at most one folder.** There is no way to place the same album in two folders at once.
- **Folders hold albums, not photos.** Individual photos are not filed into folders — only the albums that contain them.
