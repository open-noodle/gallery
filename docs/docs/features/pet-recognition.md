# Pet Recognition

Pet Recognition tells your individual pets apart. With it enabled, two dogs in your library become **Rocky** and **Luna** — two people you can name, rename, merge and browse — instead of a single shared "dog" entry.

It builds on [Pet Detection](/features/pet-detection): detection finds the animal in the photo, recognition decides _which_ animal it is.

:::info Dogs and cats only
Only **dogs** and **cats** are recognized as individuals. The other eight detected categories (bird, horse, sheep, cow, elephant, bear, zebra, giraffe) keep the one-person-per-species behaviour Pet Detection has always had.

This is a limit of the model, not an oversight: it is trained on dog and cat identities, so it has no basis for telling one bird apart from another. It also contains the cost of a misdetection — the detector occasionally labels a person as an animal, and a shared species bucket absorbs that far more gracefully than a named identity would.
:::

## Enabling it

Pet Recognition is **off by default**, and turning it on is not enough on its own — see [Reprocessing your library](#reprocessing-your-library) below.

1. Go to **Administration** > **Settings** > **Machine Learning Settings** > **Pet Recognition**.
2. Enable **Enable pet recognition**.
3. Save.

Pet Detection must also be enabled, otherwise no new photos are scanned for animals at all and recognition has nothing to work with. The settings page warns you when detection is off.

From that point on, **newly uploaded** photos go through the individual pipeline. Photos already in your library keep whatever they had — so until you reprocess, the library is in a mixed state: old photos still grouped in a "dog" bucket, new ones appearing as named-able individuals.

## Reprocessing your library

:::danger This deletes data
Reprocessing **deletes every pet person and every pet embedding you have**, including any names you gave them and the copies that were projected into shared spaces. There is no undo. The names are gone even though the photos are not.
:::

To apply recognition to photos that were uploaded before you enabled it:

1. Go to **Administration** > **Jobs**.
2. On the **Pet Recognition** queue, press **Reset**.
3. Confirm the dialog.

Gallery then deletes all pet people and embeddings and re-runs pet detection over the whole library, embedding and clustering as it goes. On a large library this takes a while — it re-runs the detector on every asset.

:::warning Reset while pet detection is disabled
The deletion always happens, but the rebuild is gated on Pet Detection being enabled — that is what the confirmation dialog means by "reprocessing only runs while pet detection is enabled".

So if you reset while detection is off, your library ends up with **no pets at all** until you re-enable detection and reset again. Enable Pet Detection first.
:::

## Naming your pets

Recognized pets appear on the **People** page with a paw badge, exactly like recognized faces. Everything you already do with people works:

- Click an unnamed pet and give it a name.
- Merge two entries when the same pet was clustered twice.
- Hide a pet you don't want on the People page.
- Open a pet to browse every photo it appears in.

Pets propagate into shared spaces the same way people do, so a space's People page shows the pets in that space's photos.

## Model options

Three models are available, all producing the same 512-dimension embedding, so you can switch between them without a schema change. Larger models are more accurate and slower, and the download is not trivial.

| Model                   | Backbone       | Download | Top-1 (dogs) | Top-1 (cats) |
| ----------------------- | -------------- | -------- | ------------ | ------------ |
| `pet-recognition-small` | DINOv2-S, 22M  | ~89 MB   | 0.535        | 0.913        |
| `pet-recognition-base`  | DINOv2-B, 86M  | ~348 MB  | 0.612        | 0.916        |
| `pet-recognition-large` | DINOv2-L, 300M | ~1.2 GB  | 0.672        | 0.915        |

The default is **base**. Accuracy is measured on held-out identities — pets the model never saw during training — from the Dogs-World and Cat Individual Images test sets.

Cats score about the same on all three, so if your library is mostly cats there is little reason to pay for a bigger model. Dogs are where the larger models earn their size.

:::danger Switching the model deletes your named pets
Every model produces its own embedding space, so embeddings from one model are meaningless to another. Changing the model therefore **deletes all pet people and their embeddings and reprocesses your entire library**, exactly like a reset. The admin page asks you to confirm before saving.

Species buckets (the bird/horse/... entries) are pure detector output and are _not_ model-coupled, so they survive a model switch untouched.
:::

## Configuration

Under **Administration** > **Settings** > **Machine Learning Settings** > **Pet Recognition**:

### Maximum recognition distance

How far apart two pets can be in embedding space and still be treated as the same individual, from 0.1 to 2. Default `0.55`.

- **Lower it** if Gallery is merging two different pets into one — common with two dogs of the same breed and colour.
- **Raise it** if the same pet keeps showing up as several separate individuals.

Changing this affects future recognition jobs; existing assignments stay as they are until you reset.

### Minimum recognized faces

How many similar pet detections must exist before Gallery creates a named-able individual, from 1 to 1000. Default `1`.

Increasing it makes recognition more precise, at the cost of pets with only a photo or two never being grouped into an individual at all. The default of 1 suits most home libraries, where a pet may only appear in a handful of photos.

### Pet Recognition model

See [Model options](#model-options) above. Changing this deletes and rebuilds everything.

## How it works

1. **Detection** — the pet detector finds animals and their bounding boxes (see [Pet Detection](/features/pet-detection)).
2. **Embedding** — for dogs and cats, the same machine learning request crops the animal, resizes it to 224x224, and runs it through a frozen DINOv2 backbone plus a trained linear projection, producing a 512-dimension L2-normalized embedding. These are stored in a dedicated `pet_search` table, entirely separate from human face embeddings.
3. **Clustering** — a `PetRecognition` job runs a nearest-neighbour search over that table, scoped to the owner. A match within the recognition distance joins the existing individual; otherwise a new one is created.
4. **Shared spaces** — the pet is projected into every space its photo belongs to, the same path human faces already take.

Human and pet embeddings never mix: they live in different tables, are searched by different queries and are queued on different job queues, so a pet can never be clustered onto a person or vice versa.

Recognition also runs nightly, picking up any pet detections that have not yet been assigned to an individual.
