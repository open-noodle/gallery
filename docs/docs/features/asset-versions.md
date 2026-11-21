# Versions

A photo often comes as more than one file: the camera saves a RAW next to its JPEG, and an edit exported from
Lightroom or darktable is a third file of the same shot. With **Versions**, Gallery shows those files as one photo.
The timeline, albums, Spaces and shared links show the photo once, and its **Versions** section lists the files of
the shot.

Versions are **disabled by default**. Once an administrator turns them on, Gallery does this by itself, from the
names and capture times of the files. There is nothing to confirm and nothing to arrange: Gallery only groups files
when those leave no doubt, and otherwise leaves them as they are.

## What Gallery recognises

- **A RAW and the camera's JPEG or HEIC of the same shot.** Cameras and phones give the two files of one shot the
  same name (`DSC_0201.NEF` and `DSC_0201.JPG`; a Pixel's `PXL_….RAW-01.COVER.jpg` and `PXL_….RAW-02.ORIGINAL.dng`).
  Gallery pairs a RAW with the camera's file when they have the same name, were taken within ten seconds of each
  other, and nothing in the files says they come from different cameras or shots. The frames of a burst each have
  their own name, so each frame is paired with its own RAW. A RAW and a JPEG that were renamed differently are left
  as two photos.
- **An edit** (a separate switch, see below). Gallery takes a file for an edit when its name says so (`DSC_0201-edit.jpg`,
  `DSC_0201_edited.jpg`, a phone's `IMG_E0201.JPG`), or when the file says so inside: Lightroom, Photoshop, Camera Raw
  and darktable record that an export was made from another file. It finds the shot an edit belongs to by the edit's
  name, or, for an edit under a name of its own, by the file the edit says inside it was made from: that file's name,
  and the capture time, which editors keep (an edit and its original were taken at exactly the same moment). This
  also works when the RAW it was made from is not in Gallery but the camera JPEG is.
- **Files stored side by side under one name.** Files in the same folder whose names differ only in the extension
  (`roll12_07.tif` and `roll12_07.heic`, or `DSC_0201.JPG`, `DSC_0201.NEF` and `DSC_0201.DNG`) are one photo, also
  when they have no capture time, as a film scan and the picture made from it often do. A name is used only once in a
  folder, so they cannot be two shots. A capture time still says no when both files have one and they are more than
  ten seconds apart (a camera's counter that came round again), and so does anything else that tells two cameras or
  shots apart. A JPEG or HEIC is the photo, with the RAW or TIFF behind it; files of one kind only (a RAW and its
  DNG) are combined too. Only the name a file is stored under counts: an upload kept under its own id, which is the
  default, is not combined this way; with the storage template on, the uploads of one day stored by name in that
  day's folder are.

Gallery would rather leave two files apart than combine two different shots:

- The capture time alone never combines two files: a camera takes several shots in one second.
- What an edit says inside comes first. An edit that names another file as the one it was made from is not combined
  with the file it happens to be named after.
- A file with no capture time is combined only with files stored beside it under its name (the date a file was
  saved does not count).
- A copy with another name (`DSC_0201 (1).JPG`, `PXL_…~2.jpg`) and a program's output (`DSC_0201_result.jpg`) stay
  photos of their own, unless they say inside which file they were made from.
- Files from different users or libraries, identical copies, images marked as a merged HDR or panorama, and live
  photos are not grouped.

An edit whose original is not in Gallery stays an ordinary photo until the original arrives. Where ten or more of one
user's files in one library carry exactly the same time, the camera's clock was probably never set: Gallery then goes by the names
alone.

### Telling Gallery yourself

Two instructions, written into a file's **Instructions** field, decide for that file. Most photo programs offer that
field among a picture's IPTC details (Lightroom Classic, Photoshop and Bridge, Capture One, digiKam), and Gallery
does not show it or turn it into a tag:

| Instruction                              | Effect                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `noodle-gallery:keep-apart`              | the file is never combined with anything: it stays a photo of its own                                                             |
| `noodle-gallery:version-of=DSC_0201.JPG` | the file goes behind the photo of the file with that name, as an edit does: the camera's file, its RAW, or an edit made from them |

For example, with ExifTool: `exiftool -XMP-photoshop:Instructions="noodle-gallery:version-of=DSC_0201.JPG" glare-fix.jpg`.
Other text in the field is left alone: put an instruction on a line of its own, or separate it with `;`.

- The file name alone does not identify a photo (a camera uses a name again after 10,000 shots), so a file marked
  `noodle-gallery:version-of=` must have kept the capture time of the photo it names, as a copy or an export of it has,
  unless it is stored beside that file under the same name.
- The named file can be anywhere in its shot: if it is behind a photo, the marked file goes behind that photo too.
  If it is an edit and Gallery has neither the camera's file nor the RAW it was made from, that edit becomes the
  photo, and the RAW or camera file goes behind it when it is added later.
- A file with two `noodle-gallery:version-of=` instructions that name different photos is left alone, so replace the
  instruction instead of adding a second one.
- Gallery reads the instructions from the file itself and from its XMP sidecar, which is where most programs write
  a RAW's details, when it reads the file's metadata: on upload, when a file in an external library changes, or when
  the Versions job runs on all photos. After changing only a sidecar, run the Versions job on all photos; after
  adding a sidecar a file did not have, run the **Sidecar discovery** job first, so Gallery knows it is there.
- Keywords and tags are not read: Gallery turns keywords into tags, and a tag given in Gallery is not an
  instruction.
- `noodle-gallery:keep-apart` keeps a file from being combined from then on. What is combined already stays as it is (a
  marked photo takes no new versions); **Undo versions** takes it apart.
- A file marked `noodle-gallery:version-of=` is taken for an edit, so it needs the **Edits** switch.

## One photo, and it stays that photo

One file of the shot is the photo. It keeps its place in your albums and Spaces, its favourite, its comments, its
people and its shared links, and nothing is moved when another file of the shot arrives: the other files simply go
behind it.

- Normally the photo is **the camera's JPEG or HEIC** (or the RAW, when the camera saved only a RAW).
- When you turn versions on in a library you have already organised, Gallery picks **the file you organised**. If the
  export is what you put into albums and favourited while the camera original sat untouched, the export is the photo
  and the originals go behind it.
- Once chosen, the photo never changes.

A file that has something of its own that the photo lacks (it is in another album, has a comment, is in a shared link
by itself, has a face someone drew on it, or named, by hand) is **not combined**: it stays a separate photo, as today, so nothing is lost. Tags are the exception:
the tags of the files behind a photo are the photo's tags too. Gallery copies them to the photo again whenever it has
read the photo's metadata, so a tag that came from a version returns if you remove it from the photo.

## What the photo looks like

With edits switched on, the photo shows **its newest edit**, the file that was written last. When you export the
photo again and the new file arrives, the photo's picture changes to it; the photo itself, and everything on it,
stays the same. Without an edit, the photo shows its own file; a RAW or TIFF that is the photo shows the JPEG or HEIC
behind it, if it has one (with several, one of them; one that arrives later can take its place).

Gallery's own editor crops and rotates the photo's own file, not the edit you are looking at, so **a photo that
shows an edit cannot be cropped or rotated in Gallery**: the editor says so. Colour adjustments still work, and apply
on top of the edit. A crop made in Gallery before the edit arrived stays what you see until you remove it; then the
newest edit shows. Face boxes are found on the photo's own file, so on an edit that is cropped or straightened
differently they can sit in the wrong place.

## Seeing versions

Open a photo and its info panel. When the photo has versions, the **Versions** section lists every file of the shot,
the photo's own included, each with its thumbnail, what it is (**Edit**, **Original** for the camera's own JPEG or
HEIC, **RAW**), its format, size and date. The file the photo's picture comes from is marked **Shown**. Edits come
first, newest on top, then the original, then the RAW. Select a thumbnail to see it larger, or download the file. On
the web, holding the mouse over a thumbnail shows that version beside the panel, over the photo, so you can compare
the versions by moving down the list.

Everyone who can see the photo can see its versions: you, your partners, the members of the albums and Spaces the
photo is in, and people with a shared link to it. Downloading a version follows the photo: a shared link that does
not allow downloads does not allow downloading versions either, and a shared link that hides metadata does not list
the versions (their names and dates are metadata). When the photo is archived, locked or in the trash, its versions
are as out of reach as the photo itself.

## What you cannot do

Gallery arranges versions itself, and there are no controls to change the result. You cannot add a version by hand,
choose which version is shown, or make a version a separate photo again.

**Deleting the photo deletes its versions too.** For an external library, Gallery removes only its own record of
them, never the file.

## Duplicates

A camera's JPEG with its RAW behind it is one unit: it is checked for duplicates like any photo, and if you discard
it on the **Duplicates** page, the RAW goes with it. A photo whose shot includes an **edit** is different: the edit is
work that exists nowhere else, so that photo is left out of duplicate detection. It is never suggested as a duplicate
and never shows up as the duplicate of another photo.

## For administrators

Turn versions on in **Administration > Settings > Server > Versions**:

| Setting             | Default | Effect                                                                                                      |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| **Enable versions** | off     | shows the files of one shot as one photo: a RAW is kept behind the camera's JPEG or HEIC of the same shot   |
| **Edits**           | off     | includes edits of a photo as its versions, and shows the newest as the photo's picture; needs the first one |

Edits are a separate switch because they change what a photo looks like, which not every library wants.

Turning a switch on does not go through existing photos by itself: run the **Versions** job on the **Jobs** page.
_Missing_ reads the photos never looked at, _All_ reads every photo again. Each photo is read with ExifTool, a file
found with several others sometimes more than once, so on a large library the first run takes a while; the files of a shot may appear separately until it has passed them.
Existing stacks of a RAW and its JPEG are converted: the RAW leaves the stack and becomes a version.

**Why was this combined, or not?** Gallery writes a line to its log when it puts a file behind a photo, and each time
it finds two files of one shot and leaves them apart, with the reason. A file behind a photo also keeps how it was
found in the database (`asset_version.rule`, for example `raw:name`). A file with nothing to combine with is not
mentioned.

Turning versions off stops Gallery from finding new ones. Versions already found stay behind their photo, and the
photo keeps its picture, but the **Versions** section is hidden until versions are on again. Turning only edits off
changes nothing that is already combined.

### Undoing versions

While versions are off, **Undo versions** appears under the two switches. It makes every version a photo of its own
again:

- It is shown the way it was before: in the timeline or in the archive. If its photo is now archived, locked or in
  the trash, it goes with it.
- It is stacked with its photo again only if the two were in a stack before Gallery combined them. Otherwise they
  are two separate photos, as they were. Where Gallery has to make the stack anew, the photo is on top.
- A photo that showed an edit shows its own file again.
- Nothing is deleted. Albums, favourites and the like stay on the photo; a file that was hidden behind it does not
  get its own copy of them back.

A file that arrived while versions were on was never a photo of its own, so it becomes one now, in the timeline.

The undo runs as a job, and the files that were hidden are then analysed like any other photo (search, faces, text,
duplicates). If it is interrupted, run it again. To combine everything again, turn versions on and run the
**Versions** job for the missing files: Gallery looks at the same files again and combines them as they are then.

Versions are ordinary files in Gallery's storage or in your external libraries. A version's file counts towards its
owner's storage, but not towards the number of photos.

## Switching back

The switch-back script shows every version as a photo again, the same way **Undo versions** does: stacked with the
photo it belonged to only if the two were in a stack before. A photo that showed an edit shows its own file again. See [Switch back](/guides/switch-back-to-immich).
