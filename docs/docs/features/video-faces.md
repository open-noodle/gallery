# Faces in Videos

By default, face detection looks at one frame of a video: its poster, which is usually from the first second or two.
Anyone who appears later is missed, and the people it does find are cut from a small thumbnail, so their faces are
often too blurry to tell who they are.

With **Detect faces across the whole video** on, Gallery samples frames throughout each video instead. It follows each
person from frame to frame, keeps one face per person, and shows each person from the clearest frame it found.

This setting is off by default.

## Turning it on

Go to **Administration > Settings > Machine Learning Settings > Facial Recognition** and turn on **Detect faces across
the whole video**.

New videos are scanned this way as they are uploaded. Videos that were processed before you turned it on are not
rescanned automatically, because a large library can take a long time. To scan them, go to **Administration > Jobs**
and run **Face Detection** with **Missing**. That queues only the videos not yet scanned this way, along with anything
face detection has not seen at all.

To rescan one video, open it and choose **Refresh faces** from the menu.

Names you have already given are kept. A face that matches someone already found keeps its name and moves to the new,
clearer frame. An unnamed face that is no longer found is removed. A named face that is no longer found is kept, so a
rescan never loses a name.

:::note
**Reset** on the Face Detection job deletes every face and every name in the library, as it always has. You don't need
it to rescan your videos: use **Missing**.
:::

## Settings

| Setting                   | Default | What it does                                                                                       |
| ------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| Seconds between frames    | 2       | How often a frame is sampled. Videos of a minute or less are always sampled at least every second. |
| Sample after scene cuts   | On      | Also looks at the start of each new shot in edited videos, so a short shot is not missed.          |
| Frame budget per video    | 1800    | The most frames sampled from one video. A longer video is sampled at a wider interval instead.     |
| Find small faces (crowds) | Off     | Also searches each high-resolution frame as four quarters, to find small faces such as a crowd.    |

The frame budget never cuts a video short. A two-hour video at the defaults is sampled about every 4 seconds from
start to end, instead of stopping after the first hour.

**Find small faces** helps most with wide shots of groups and crowds. In testing, a 9-second crowd clip went from 7
people found to 24. It takes about five times as long per frame, so leave it off unless your videos need it.

## What to expect

- **Each person appears once per video.** Gallery recognises the same person across frames, so a person on screen for
  a minute is one face, not thirty.
- **The thumbnail is the clearest view.** Each person is shown from the frame where their face was largest and
  sharpest. Gallery also checks a few frames either side of that moment for an even sharper one. Small faces are
  cropped with some of their surroundings, such as head and shoulders, so they are easier to recognise.
- **Very small faces are left out.** A face under about 20 pixels across can't be recognised, even by you, so it is
  not added.
- **The detector is more forgiving in videos.** A face the detector is unsure of in any single frame is still kept if
  it is seen clearly enough across several frames.
- **A head turn can split one person in two.** If someone turns from facing the camera to side-on between frames,
  Gallery may not be sure it is the same person and keep both views. Give both the same name.
- **You can see every moment a person appears,** and jump the video to each one. See
  [Seeing where someone appears](#seeing-where-someone-appears).

Low-resolution and very blurry videos have limits. If a person is only ever a few pixels wide, or never in focus, no
frame will show them clearly.

## Seeing where someone appears

Gallery remembers every moment it saw each person, not just the clearest one. To see them, open a video, open the
info panel, and click the film button on a person's picture under **People**. A row of their face at each moment opens
under the pictures, in time order, with the clearest view starred.

Click a moment to jump the video there. The video pauses on that frame with a white box around the person's face and
the rest of the picture dimmed, the way a photo highlights a face. The box goes away when you play the video, drag the
timeline elsewhere, or pick another moment.

<img src={require('./img/video-faces-moments.webp').default} alt='The info panel lists Alex’s moments as a row of face crops; the 8:38 crop is selected, and the video is paused at 8:38 with a white box around Alex’s face' title='A person’s moments in the info panel, with the video paused on one of them' />

The same row appears when you name a face in a video: click the pencil next to **People**, then the pencil on a face.
It helps when one crop is not enough to tell who someone is, such as two people who look alike or a small face in a
crowd.

<img src={require('./img/video-faces-picker.webp').default} alt='The Select face panel for an unnamed face shows its 50 moments above the people search; the video is paused at 2:11 with a white box around the face' title='Naming a face, with its moments above the people to choose from' />

### In the mobile app

Open a video and swipe up to its details. Under **People**, each person who appears in the video has a small film
badge on the top-left of their picture. Tapping the picture still opens the person, as before. Tap the badge to open
a row of their moments under the pictures, then tap a moment: the video above pauses there with the same white box
around their face. Tap the badge again, or the close button, to close the row.

<img src={require('./img/video-faces-mobile-badge.webp').default} width="45%" alt='The People row in a video’s details, with a small film badge on the top-left of each person’s picture' title='The film badge on each person who appears in the video' />
<img src={require('./img/video-faces-mobile-moments.webp').default} width="45%" alt='Alex’s badge is on and his 48 moments are listed under People; the 0:29 moment is selected, and the video above is paused there with a white box around his face' title='A person’s moments, with the video paused on one of them' />

The app shows moments but doesn't change them: to correct a moment, use the web. People shown through a shared space
don't get the badge in the app yet.

## Correcting a face

Sometimes a moment shows someone else: two people standing in the same spot a moment apart can be followed as one
person. The video's owner can fix that from the same row. Each moment has a menu in its corner:

<img src={require('./img/video-faces-moment-menu.webp').default} width="60%" alt='The menu on a moment: Move to another person, Move to a new person, Move to unassigned, and Remove the moment' title='The menu on a moment' />

| Option                  | What it does                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| Move to another person… | Gives the moment to someone you pick. If they already appear in this video, it joins their face there. |
| Move to a new person    | Starts a new, unnamed person with this moment. Name them from the **People** list.                     |
| Move to unassigned      | Takes the moment out of this person and leaves it unnamed.                                             |
| Remove the moment       | Takes the moment out of this person entirely.                                                          |

Each change shows a message with **Undo** for a few seconds. Moving a moment back to the person it came from also
puts it back where it was.

- **The starred moment can move too.** The next clearest moment then becomes the face's picture, and the person's
  thumbnail is updated if it came from this face.
- **A person's only moment stands for their whole face.** Its menu moves the face to another person or a new person,
  or deletes the face after asking.
- **Several faces for one person can be combined.** If a person still has more than one face in a video, for example
  after a head turn split them in two, click the combine button beside their name in the row. All their moments end
  up in one face, and the **Edit people** list shows them once. Combining can't be undone.
- **Gallery offers to combine when you name a face.** If you name a face in **Edit people** after someone who already
  has a face in this video, a message says how many faces they now have here, with **Combine into one face**. It stays
  for 10 seconds and changes nothing unless you click it.
- **Running face detection on the video again undoes corrections.** It follows everyone through the video afresh, so
  removed moments come back, moved ones are added back to the face they came from, and combined faces can split
  again. A moment moved to a new person keeps that face, so it then shows twice.

Only the video's owner can change moments, on the web. Anyone who can see the video can view them, in the browser or
the app.

## How long it takes

Each sampled frame takes a fraction of a second on most servers. A two-minute phone video at the defaults is about 60
frames, well under a minute of work. An hour-long video uses the full frame budget and can take tens of minutes on a
server without a GPU, about as long as transcoding it. All of this runs in the background on the face detection
queue.

The server log shows each video as it is scanned:

```
Sampling 23 frames across 23s of video <id> (about every 1s, 1 scene cuts)
Found 7 faces in 23 frames of video <id> in 27s: 0 added, 7 updated, 0 deleted, 46 dropped as too small or unsure, 3 sharper views from 22 extra frames
```

Videos sampled from 100 frames or more also log their progress every 10%, with an estimate of the time left.

Each face found this way stores one frame, about 200 to 400 KB, next to the video's thumbnails. Deleting the video
deletes its frames.
