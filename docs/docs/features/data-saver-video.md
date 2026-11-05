# Data Saver Video

Data Saver video makes a second, much smaller copy of each video on your server. The mobile app streams that copy when your phone is on mobile data, and the normal video on Wi-Fi.

Gallery already stores one playback copy of each video. That copy is made for a home network: iPhone clips usually come out around 8 to 10 Mbit/s, which stalls on a weak mobile signal and uses a lot of data. The Data Saver copy is capped at 1.5 Mbit/s by default, which is at most about 0.7 GB per hour of video. In testing, a 31 MB 1080p clip became a 4 MB copy.

The feature is **off by default**. An administrator turns it on for the whole server, and each person can turn it off in the app.

:::info Quick summary

- **Nothing is replaced or changed.** Your originals and normal playback copies stay as they are. The small copy is stored alongside them.
- **Turning it on makes copies of every video you already have**, in the background. This takes server time and some disk space.
- **Only the mobile app uses the copies, and only on mobile data.** The web app, downloads, shared links and casting always get the full-quality video.
- **Videos stored on your phone are not touched**, and backups still upload the full original.

:::

## How it works

1. An administrator turns on **Data Saver video** in the server settings or the [config file](#config-file).
2. The server makes a small copy of each video in the background, on the same queue as normal video conversion. New uploads get a copy right after their normal conversion finishes.
3. When you open a video in the mobile app, the app checks your connection:
   - **On mobile data**, it streams the small copy.
   - **On Wi-Fi or Ethernet**, it streams the normal playback video, as before.

If a video has no small copy, the app gets the normal playback video instead. This happens when the copy hasn't been made yet, or when the video didn't need one. Playback never fails because a copy is missing.

## Turning it on

Go to **Administration → Settings → Video Transcoding Settings → Data Saver video** and switch on **Enable Data Saver video**. When you save, the server starts making copies of your existing videos.

### Settings

| Setting                 | Config file key                     | Default | What it does                                                                                                                                                                                                  |
| :---------------------- | :---------------------------------- | :------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Enable Data Saver video | `ffmpeg.dataSaver.enabled`          | `false` | Makes the copies and lets the mobile app use them.                                                                                                                                                            |
| Video codec             | `ffmpeg.dataSaver.targetVideoCodec` | `hevc`  | `h264`, `hevc` or `av1`. HEVC needs about half the bitrate of H.264 for the same picture, and every iPhone since the 7 and practically every Android phone since 2017 plays it. Older phones may need `h264`. |
| Resolution              | `ffmpeg.dataSaver.targetResolution` | `720`   | `480`, `720` or `1080`. Larger videos are scaled down to this for the copy.                                                                                                                                   |
| Bitrate cap             | `ffmpeg.dataSaver.maxBitrate`       | `1500k` | The most the picture may use, in FFmpeg notation (for example `800k` or `2m`). Simple scenes come out smaller than the cap. Sound comes on top of this, and is small.                                         |

Everything else comes from the main video transcoding settings: hardware acceleration, preset, quality (CRF), HDR tone-mapping, audio codec and threads. If you use [hardware transcoding](./hardware-transcoding.md), the copies use your GPU too.

Rough sizes at different caps, for the picture only:

| Bitrate cap | Per minute | Per hour |
| ----------: | ---------: | -------: |
|      `800k` |       6 MB |   360 MB |
|     `1500k` |      11 MB |   675 MB |
|     `2500k` |      19 MB |   1.1 GB |

With the default quality setting, iPhone footage usually reaches the cap, so expect copies close to these sizes.

### Config file {#config-file}

Data Saver video can be set in the [config file](/install/config-file) instead of the web UI. Add a `dataSaver` section inside `ffmpeg`. Any key you leave out keeps its default:

```json
{
  "ffmpeg": {
    "dataSaver": {
      "enabled": true,
      "targetVideoCodec": "hevc",
      "targetResolution": "720",
      "maxBitrate": "1500k"
    }
  }
}
```

The server reads the config file when it starts. If the feature is on, it also checks at every start for videos with a missing or out-of-date copy and makes those copies. Turning the feature on in the file, or changing its settings, therefore takes effect after a restart. If everything is up to date, a restart makes no new copies.

An invalid value stops the server from starting, with an error that names the key, for example `[ffmpeg.dataSaver.maxBitrate]`.

## What happens to videos you already have

- **Turning it on** queues every existing video. The server works through them in the background on the **Video Conversion** queue, at the same speed setting (concurrency) as normal transcoding. You can follow progress under **Administration → Job Queues**. On a large library this can take hours, and normal video conversion for new uploads waits in the same queue.
- **Originals and normal playback videos are never changed.** The copy is an extra file.
- **Short or already-small videos get no copy.** If a video is already at or below the chosen resolution and its bitrate is at most 1.25 times the cap, the server notes that no copy is needed, and the app streams the normal file. Nothing is encoded twice for no gain.
- **Changing a setting** (codec, resolution or cap) re-makes every copy that was made with the old settings, in the background.
- **Saving the settings page without changing anything** re-makes nothing.
- **Trimmed videos** get their copy from the trimmed version, and the copy is re-made whenever you change or undo the trim.
- **Live photos:** the short motion part of a live photo gets no copy, since it is never played on its own.
- **Deleting a video** deletes its copy too.

### The Video Conversion job buttons

The **Missing** and **All** buttons on the Video Conversion job also cover the copies while Data Saver video is on:

- **Missing** makes copies for videos that have none, or whose copy is out of date.
- **All** re-makes the normal playback video **and** the copy of every video. On a large library that is a lot of work.

## Disk space

Each copy is stored next to the normal playback video, in `encoded-video/<user>/<xx>/<yy>/<asset-id>_ds.mp4`, on disk or in [S3 storage](./s3-storage.md), whichever you store new files on.

To estimate the extra space, multiply the total length of your videos by the per-hour size in the table above. At the default cap, 10 hours of video takes roughly 7 GB more. Videos that need no copy take nothing.

- **[Storage Migration](./storage-migration.md)** moves the copies along with the normal playback videos, counted under encoded videos.
- **Integrity checks** know about the copies, so they are not reported as untracked files.
- **Backups:** the copies can be rebuilt from your originals, like normal playback videos and thumbnails, so you don't need to back them up.

## Turning it off

When you switch **Enable Data Saver video** off:

- The mobile app stops using the copies straight away and streams the normal video on every network. The app setting is hidden.
- New uploads get no copy.
- **Copies already made stay on disk.** They are not deleted. If you turn the feature back on with the same settings, the server reuses them instead of encoding again.

:::caution
Don't delete the `_ds.mp4` files by hand while the server still knows about them. The server would keep trying to serve the deleted files. There is currently no button that removes all copies.
:::

## On your phone

### What changes

Only which file the app **streams** from the server:

| Your phone is on                             | App streams               |
| :------------------------------------------- | :------------------------ |
| Wi-Fi or Ethernet                            | The normal playback video |
| Mobile data                                  | The Data Saver copy       |
| A Wi-Fi hotspot or network marked as metered | The Data Saver copy       |
| iPhone with **Low Data Mode** on             | The Data Saver copy       |

The app uses what your phone reports about the network: "metered" on Android, and "expensive" or "constrained" (Low Data Mode) on iOS. A Wi-Fi network you marked as metered on Android counts as mobile data. If the app can't read the network, it streams the normal video: the check may cost data, but it never stops a video from playing.

The app checks the network once, when you open a video. If you move from mobile data to Wi-Fi while watching, the video keeps playing the copy until you open it again.

### What doesn't change

- **Videos stored on your phone** are played from the phone, as before. Nothing on your phone is changed or deleted.
- **Backups** still upload the full original from your phone.
- **Downloads** from the app still save the full original.
- **Force original video** (in the app's video settings) still wins: with it on, the app always streams the original, on any network.
- **Photos** are not affected.

### The app setting

**Settings → Asset Viewer → Videos → Data Saver on mobile data**

It is **on by default**, and only shows when your server has Data Saver video turned on. Switch it off to always stream the normal video, even on mobile data. The setting is stored on the phone, so each person and each phone chooses for themselves.

## Where the copies are not used

- **The web app** always plays the normal playback video. Browsers don't reliably tell a website whether you are on mobile data.
- **Shared links** and **casting** use the normal playback video.
- **Downloads** always give the original file.

## App and server versions

| Mobile app                        | Server                               | Result                                                           |
| :-------------------------------- | :----------------------------------- | :--------------------------------------------------------------- |
| Gallery with Data Saver           | Gallery with Data Saver, feature on  | Copy on mobile data, normal video on Wi-Fi                       |
| Gallery with Data Saver           | Gallery with Data Saver, feature off | Normal video everywhere; the app setting is hidden               |
| Gallery with Data Saver           | Older Gallery, or an upstream server | Normal video everywhere                                          |
| Older Gallery, or an upstream app | Gallery with Data Saver              | Normal video everywhere. These apps don't know about the copies. |

## Switching back to upstream

The copies are a Gallery-only addition, so they don't get in the way if you [switch back to upstream](/guides/switch-back-to-immich):

- An upstream server started on a Gallery database ignores the copies. They stay on disk as files it doesn't know about.
- The switch-back script removes the list of copies from the database. The `_ds.mp4` files stay in `encoded-video/`, and you can delete them afterwards to free the space.

## FAQ

**Does this lower the quality of my videos?**
Only while streaming on mobile data. Your originals are untouched, and on Wi-Fi the app plays the normal video. Downloads always give the original.

**Why didn't some videos get a copy?**
They were already small enough: at or below the chosen resolution, and with a bitrate no more than 1.25 times the cap. The app streams their normal file, which is already light.

**I turned it on, but the app still streams the normal video on mobile data.**
Check that:

- the copies have been made (see the Video Conversion queue under **Administration → Job Queues**),
- **Data Saver on mobile data** is on in the app,
- **Force original video** is off,
- the app is a version that includes Data Saver video.

**Can I make copies only for some users or albums?**
No. The feature is on or off for the whole server. Each person can still turn it off in their app.

**Can I choose a different quality for each phone?**
No. There is one copy per video, with the settings the administrator chose.

**Does it work with S3 storage?**
Yes. Copies are written to the same storage as other new files, and served from it the same way.
