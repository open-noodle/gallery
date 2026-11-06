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

Low-resolution and very blurry videos have limits. If a person is only ever a few pixels wide, or never in focus, no
frame will show them clearly.

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
