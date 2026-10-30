# Spatial Scene

Spatial Scene makes an ordinary photo look three-dimensional. Open a photo, press **Spatial**,
and its subject stands out from the background, which shifts behind it as you move the pointer
or tilt your phone. It is Gallery's take on the Spatial Scene option in Apple Photos.

Gallery estimates how far away each part of the photo is, once, when the photo is uploaded. That
estimate, a small greyscale **depth map**, is stored on your server next to the photo's
thumbnails. Your browser does the rest: it shifts the near and far parts of the photo by
different amounts as you move. Nothing is sent to any outside service.

Spatial Scene is **disabled by default**. It is the most demanding of Gallery's machine learning
features, so read [Model Options](#model-options) before you turn it on.

:::note Web only for now
This release supports Spatial Scene in the web app, including phone and tablet browsers. The
Gallery mobile app does not show it yet.
:::

## Viewing a Spatial Scene

1. Open a photo in the web app.
2. Press **Spatial** in the top bar. It only appears on photos Spatial Scene is offered for (see
   [Which photos get it](#which-photos-get-it)).
3. Move the pointer over the photo, or drag on a touch screen. On a phone or tablet you can also
   tilt the device. iPhones and iPads ask for permission to use motion first.

If you leave it alone, the scene sways gently on its own after a few seconds. If your system is
set to reduce motion, it stays still until you move it.

Press **Spatial** again, or move to another photo, to return to the normal view.

The button does not appear in browsers without WebGL 2, which the effect needs. Every current
desktop and mobile browser has it.

## Which photos get it

Spatial Scene looks best on a photo with a clear subject in front of a background: a person, a
pet, an object, a group, a street with buildings at different distances. It adds little to a flat
scene such as a screenshot, a document, a wall, or an open beach or field, where the effect just
looks like the photo tilting.

By default Gallery offers the **Spatial** button only on suitable photos, as Apple Photos does. A
photo counts as suitable when either of these holds:

- Its depth map has **sharp edges** where a subject is cut out against its background, or many
  sharp edges, as in a forest or a street of buildings.
- It has a detected **face of a person or a pet** that is at least 3% of the photo's height. This
  uses the faces Gallery has already found, so it costs nothing extra.

On a library of 492 iPhone photos, this offered Spatial Scene on 408 (83%). Photos of people,
pets and objects close up were offered; screenshots, documents and open landscapes were not.

### Offering it on every photo

If you would rather decide for yourself, an administrator can offer the button on **every photo**
that has a depth map. See [Configuration](#configuration).

The decision is made each time a photo is opened, from the depth map and faces already stored. So
changing this setting, or a face being found in a photo later, takes effect straight away,
without reprocessing anything.

## Model Options

Three models are available. All three produce depth maps the same way, so the choice is about
quality against the time each photo takes.

| Model                                 | Download (CPU / GPU) | Best for                                           |
| ------------------------------------- | -------------------- | -------------------------------------------------- |
| `depth-anything-v2-small` _(default)_ | 29 MB / 101 MB       | Almost everyone. Runs on any CPU.                  |
| `distill-any-depth-small`             | 29 MB / 101 MB       | The same cost as the default, from a newer method. |
| `distill-any-depth-large`             | 1.3 GB / 1.3 GB      | Servers with a GPU. Sharper on fine detail.        |

The model downloads on first use and is cached afterwards. For the two small models, a server
without [hardware acceleration](/features/ml-hardware-acceleration) downloads a smaller copy that
runs about a quarter faster on a CPU, with practically identical results. A server with hardware
acceleration downloads the full-precision copy. The large model always uses full precision: the
smaller copy changed which photos get the Spatial button too often to be worth its speed.

The two small models give very similar depth maps. The large model is noticeably sharper on thin
details such as railings, hair, instrument strings and the outlines of people standing close
together.

### How long it takes

These are times per photo on a CPU, with the machine learning service's default of two threads
per model. The Apple M2 and Intel Core i7-7700K figures are measured (the i7 as a 4-core virtual
machine, timing the whole job from preview to stored depth map); the NAS figures are an estimate.

| Model                     | Apple M2 | Intel Core i7-7700K | Typical NAS processor (estimate) |
| ------------------------- | -------- | ------------------- | -------------------------------- |
| `depth-anything-v2-small` | ~1.8 s   | ~1.9 s              | 2–5 s                            |
| `distill-any-depth-small` | ~1.8 s   | Not measured        | 2–5 s                            |
| `distill-any-depth-large` | ~11 s    | Not measured        | Too slow to be useful            |

For comparison, [Pet Detection](/features/pet-detection) takes about 0.04 seconds per photo. New
uploads add one depth map each, which is rarely noticeable. Processing an existing library is
another matter: at 3 seconds a photo, 50,000 photos take about two days. The job runs in the
background and can be paused from **Administration** > **Jobs**.

On a processor with spare cores, more threads per model help: raise
`MACHINE_LEARNING_MODEL_INTRA_OP_THREADS` (see [Environment Variables](/install/environment-variables)).
With four to eight threads the default model took 0.5 to 0.65 seconds a photo on an Apple M2. Choose
`distill-any-depth-large` only if the machine learning service runs on a GPU (see
[Machine Learning Hardware Acceleration](/features/ml-hardware-acceleration)).

## Limitations

- **Edges can stretch.** When the subject moves aside, the part of the background it was hiding
  has to come from somewhere, and Gallery fills it by stretching the nearby background. Apple
  Photos uses generative AI to paint it in. Gallery keeps the movement small and the subject
  still to make the stretching hard to notice, but you can spot it on large movements, especially
  around hair and fur.
- **Photos only.** Videos, 360° panoramas and Apple's stereo spatial photos (taken for Vision Pro)
  are not processed.
- **Edited photos.** After you crop or rotate a photo, its depth map is recomputed from the
  edited version.

## Configuration

### Admin Settings

1. Go to **Administration** > **Machine Learning Settings**.
2. Under **Spatial Scene**, turn it on and choose a model.
3. Choose **Offer it on**: **Suitable photos** (the default) or **All photos**.

Changing the model recomputes the depth map of every photo with the new model.

### Processing existing photos

Turning Spatial Scene on processes photos uploaded from then on. To process the photos already in
your library:

1. Go to **Administration** > **Jobs**.
2. Run the **Spatial Scene** job for **Missing** assets.

Running it for **All** assets recomputes every depth map. Nothing is lost by doing that, but it
takes as long as the first run did.

### Fine-tuning which photos are suitable

The thresholds behind [Which photos get it](#which-photos-get-it) can be changed in the
[config file](/install/config-file) under `machineLearning.spatialScene`. The defaults were tuned
on real photo libraries, and most servers should leave them alone.

| Setting                | Default | Meaning                                                                   |
| ---------------------- | ------- | ------------------------------------------------------------------------- |
| `minBoundarySharpness` | 0.03    | How sharp the edge around the subject must be.                            |
| `minEdgeDensity`       | 0.02    | Or: how much of the photo must be sharp depth edges.                      |
| `minForegroundRatio`   | 0.01    | The smallest share of the photo the subject may cover.                    |
| `maxForegroundRatio`   | 0.75    | The largest share of the photo the subject may cover.                     |
| `minFaceHeight`        | 0.03    | Or: the smallest face, as a share of the photo's height. 0 ignores faces. |

## Storage

Each depth map is a small PNG image, typically 50 to 120 KB, stored with the photo's thumbnails
(on S3 too, if you use [S3 storage](/features/s3-storage)). It is deleted with the photo.
A storage migration between disk and S3 moves the depth maps along with the previews.

If you [switch back](/guides/switch-back-to-immich), the depth maps stay in the thumbnails
folder, where they are ignored. They are named `<asset id>_depth.png` and can be deleted safely.
