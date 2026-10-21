# S3-Compatible Storage

Gallery can store new uploads in S3-compatible object storage instead of on local disk: AWS S3, MinIO, Cloudflare R2, Backblaze B2 and Wasabi all work. Storage then grows without resizing the server, durability becomes your provider's problem, and a bucket you already run fits straight in.

:::tip
If you have existing files on disk, you can migrate them to S3 using the built-in [Storage Migration](/features/storage-migration) tool.
:::

:::tip
With this backend active, Gallery can also upload its scheduled database backups to object storage. See [Remote Database Backups](/administration/remote-database-backups).
:::

## How It Works

When S3 storage is enabled:

- **New uploads** (photos, videos, thumbnails, transcoded videos, profile images) are written to your S3 bucket.
- **Existing files** on disk keep being served from disk. Both backends run at the same time.
- The [Storage Template](/administration/storage-template) works as it does on disk: uploads land under `upload/` in the bucket, and with the template enabled Gallery then moves them to their template path under `library/`. See [Storage Template on S3](#storage-template-on-s3).

Gallery supports two modes for serving files from S3:

| Mode       | Behavior                                                                                                                          |
| :--------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| `redirect` | Returns a temporary presigned URL. The client downloads directly from S3. Recommended when the browser can reach the S3 endpoint. |
| `proxy`    | The Gallery server streams the file from S3 to the client. Use only when S3 is not directly reachable by browsers.                |

:::info
Direct media delivery makes `redirect` the normal S3 mode for browser-reachable buckets. Before you switch an existing deployment from `proxy` to `redirect`, apply bucket CORS for your Gallery origins, or canvas-based features can fail.
:::

For most deployments, use `redirect`. Only use `proxy` when browsers cannot reach your S3 endpoint directly.

## Environment Variables

All S3 variables are set on the `immich-server` container.

| Variable                         | Description                                                                                                                   |   Default   | Required          |
| :------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- | :---------: | :---------------- |
| `IMMICH_STORAGE_BACKEND`         | Storage backend for new uploads (`disk` or `s3`)                                                                              |   `disk`    | Yes (set to `s3`) |
| `IMMICH_S3_BUCKET`               | S3 bucket name                                                                                                                |             | Yes               |
| `IMMICH_S3_REGION`               | AWS region (or region of your S3-compatible provider)                                                                         | `us-east-1` | No                |
| `IMMICH_S3_ENDPOINT`             | Custom endpoint URL for S3-compatible services (e.g. MinIO, R2)                                                               |             | No<sup>\*1</sup>  |
| `IMMICH_S3_ACCESS_KEY_ID`        | Access key ID                                                                                                                 |             | No<sup>\*2</sup>  |
| `IMMICH_S3_SECRET_ACCESS_KEY`    | Secret access key                                                                                                             |             | No<sup>\*2</sup>  |
| `IMMICH_S3_PRESIGNED_URL_EXPIRY` | Presigned URL expiration time in seconds (only relevant for `redirect` mode)                                                  |   `3600`    | No                |
| `IMMICH_S3_SERVE_MODE`           | How to serve S3 assets: use `redirect` for normal deployments; `proxy` is the fallback when browsers cannot reach S3 directly | `redirect`  | No                |

\*1: Required for non-AWS S3-compatible services (MinIO, R2, B2, etc.). Omit for AWS S3.

\*2: If omitted, the AWS SDK falls back to IAM role credentials (e.g. EC2 instance roles, ECS task roles, IRSA on EKS). For non-AWS services, these are typically required.

## Setup Guide

### 1. Create an S3 Bucket

<details>
<summary>AWS S3</summary>

1. Open the [AWS S3 Console](https://s3.console.aws.amazon.com/) and click **Create bucket**.
2. Choose a bucket name (e.g. `my-gallery-storage`) and region.
3. Leave "Block all public access" **enabled**. Gallery uses presigned URLs or proxying, so the bucket does not need to be public.
4. Create the bucket.
5. Create an IAM user (or use an existing one) with programmatic access. Attach a policy granting access to your bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket", "s3:AbortMultipartUpload"],
      "Resource": ["arn:aws:s3:::my-gallery-storage", "arn:aws:s3:::my-gallery-storage/*"]
    }
  ]
}
```

`s3:AbortMultipartUpload` lets Gallery cancel a large upload or copy that fails partway. Without it, the parts already sent stay in the bucket, where you pay for them but do not see them in a normal object listing.

6. Note the **Access Key ID** and **Secret Access Key**.

</details>

<details>
<summary>MinIO</summary>

1. Install and start MinIO (or add it to your Docker Compose stack).
2. Open the MinIO Console and create a bucket (e.g. `gallery`).
3. Create an access key pair from the MinIO Console or CLI.
4. Note the **endpoint URL** (e.g. `http://minio:9000` if running in the same Docker network, or `http://<host-ip>:9000` if external).

</details>

<details>
<summary>Cloudflare R2</summary>

1. In the Cloudflare dashboard, go to **R2 Object Storage** and create a bucket.
2. Under **Manage R2 API Tokens**, create a token with read/write access to your bucket.
3. Note the **Account ID** from your Cloudflare dashboard. Your S3 endpoint will be `https://<account-id>.r2.cloudflarestorage.com`.
4. Note the **Access Key ID** and **Secret Access Key** from the API token.

</details>

### 2. Configure Environment Variables

Add the S3 variables to your `.env` file:

```bash title=".env"
IMMICH_STORAGE_BACKEND=s3
IMMICH_S3_BUCKET=my-gallery-storage
IMMICH_S3_REGION=us-east-1
IMMICH_S3_ACCESS_KEY_ID=your-access-key
IMMICH_S3_SECRET_ACCESS_KEY=your-secret-key
```

For S3-compatible services, also set the endpoint:

```bash title=".env"
IMMICH_S3_ENDPOINT=https://your-s3-endpoint.example.com
IMMICH_S3_SERVE_MODE=redirect
```

### 3. Choose a Serve Mode

Pick the mode that fits your setup:

- **`redirect`** (default, recommended). Use this unless the network forces your hand. Gallery authorizes the API request and returns a short-lived presigned URL, so media bytes go straight from S3 to the browser.
- **`proxy`**. The fallback for S3 endpoints that only exist on a private network. Gallery streams every media byte through the API process, so it costs more server resources and is a poor fit for large scrolling grids.

```bash title=".env"
IMMICH_S3_SERVE_MODE=proxy
```

If you change an existing deployment from `proxy` to `redirect`, treat bucket CORS as part of the same rollout.

### 4. Configure CORS For Redirect Mode

Redirect mode keeps the bucket private, but browsers still need CORS headers when Gallery loads S3 media directly. Without bucket CORS, normal image viewing may appear to work while editing, face crops, video thumbnails, copy-to-clipboard, or browser canvas operations fail with a CORS error.

Apply bucket CORS before you enable `IMMICH_S3_SERVE_MODE=redirect` on an existing instance.

:::note
CORS does not make the bucket public. It only tells browsers which Gallery origins may read responses from valid presigned URLs. Keep normal bucket public access disabled unless your provider requires a different setup.
:::

#### Pick the Correct Origins

An origin is just a scheme, a host and an optional port. It must not include a path or trailing slash.

Use every browser URL that people use to open Gallery:

- `https://gallery.example.com` for production;
- `https://photos.example.com` if you also expose Gallery on another hostname;
- `http://localhost:2283` for local Docker testing;
- `http://localhost:3000` only if you run the web dev server.

Do not put API paths, album paths, or S3 bucket URLs in `AllowedOrigins`.

For `redirect` mode, the S3 endpoint in `IMMICH_S3_ENDPOINT` must also be reachable by the browser. If users open Gallery over HTTPS, use an HTTPS S3 endpoint or custom domain; browsers can block `http://` media from an HTTPS page as mixed content.

#### Recommended S3 CORS Policy

For AWS S3 and most S3-compatible providers, use this policy and replace the origins with your real Gallery origins:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://gallery.example.com", "http://localhost:3000", "http://localhost:2283"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["Accept-Ranges", "Content-Length", "Content-Range", "Content-Type", "ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

This allows browser reads of presigned objects from Gallery. `GET` loads media, `HEAD` allows metadata checks when a provider or tool uses them, `AllowedHeaders` covers preflight headers, and `ExposeHeaders` lets Gallery and browser media features read the range, size, type and cache-validation headers.

Do not use `"*"` for production origins. Gallery media requests use anonymous CORS today, but explicit origins are safer and avoid surprises if credentialed browser requests are introduced later.

#### Apply the Policy on AWS S3

In the AWS Console:

1. Open the S3 bucket.
2. Go to **Permissions**.
3. Find **Cross-origin resource sharing (CORS)** and choose **Edit**.
4. Paste the JSON policy above.
5. Save changes.

Or use the AWS CLI:

```bash
aws s3api put-bucket-cors \
  --bucket my-gallery-storage \
  --cors-configuration '{"CORSRules":[{"AllowedOrigins":["https://gallery.example.com","http://localhost:3000","http://localhost:2283"],"AllowedMethods":["GET","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["Accept-Ranges","Content-Length","Content-Range","Content-Type","ETag"],"MaxAgeSeconds":3600}]}'
```

If you prefer a file, save the policy as `cors.json` and run:

```bash
aws s3api put-bucket-cors \
  --bucket my-gallery-storage \
  --cors-configuration file://cors.json
```

#### Apply the Policy on S3-Compatible Providers

For MinIO, Wasabi, Backblaze B2, and other providers that accept AWS S3 API calls, use the same `put-bucket-cors` command with your endpoint:

```bash
aws s3api put-bucket-cors \
  --endpoint-url https://your-s3-endpoint.example.com \
  --bucket my-gallery-storage \
  --cors-configuration file://cors.json
```

If your provider has a bucket CORS UI instead of an AWS-compatible CLI, enter the same origins, methods, headers, exposed headers, and max age there.

For MinIO in the same Docker Compose network, you normally keep `IMMICH_S3_SERVE_MODE=proxy` because browsers cannot reach `http://minio:9000`. Only configure CORS and use `redirect` when the endpoint in `IMMICH_S3_ENDPOINT` is reachable from the browser, such as `https://minio.example.com`.

If you use a CDN or custom domain in front of your S3 provider, make sure it forwards the browser's `Origin` request header to S3 or applies an equivalent CORS response-header policy. Purge the CDN cache after changing CORS so old responses without CORS headers do not linger.

#### Apply the Policy on Cloudflare R2

Cloudflare R2 accepts CORS from the bucket settings page:

1. Open **R2 Object Storage** in the Cloudflare dashboard.
2. Select the bucket.
3. Open **Settings**.
4. Under **CORS Policy**, choose **Add CORS policy**.
5. Use the JSON tab and paste this R2 policy, replacing the origins:

```json
[
  {
    "AllowedOrigins": ["https://gallery.example.com", "http://localhost:2283"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Accept-Ranges", "Content-Length", "Content-Range", "Content-Type", "ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

You can also use Wrangler:

```json title="cors.json"
{
  "rules": [
    {
      "allowed": {
        "origins": ["https://gallery.example.com", "http://localhost:2283"],
        "methods": ["GET", "HEAD"],
        "headers": ["*"]
      },
      "exposeHeaders": ["Accept-Ranges", "Content-Length", "Content-Range", "Content-Type", "ETag"],
      "maxAgeSeconds": 3600
    }
  ]
}
```

```bash
npx wrangler r2 bucket cors set my-gallery-storage --file cors.json
npx wrangler r2 bucket cors list my-gallery-storage
```

If you serve R2 through a custom domain or CDN, purge that cache after changing CORS so old responses without CORS headers do not linger.

#### Verify CORS

After saving the policy, test from the same browser origin you configured:

1. Restart Gallery if you changed `IMMICH_S3_SERVE_MODE`.
2. Open Gallery from the exact origin in `AllowedOrigins`.
3. Open a photo or video that is stored on S3.
4. Open browser developer tools and check the media request after Gallery redirects to S3.
5. Confirm the S3 response includes `access-control-allow-origin` with your Gallery origin.
6. Try editing an image, viewing face crops, copying an image to the clipboard, and playing a video.

You can also test with `curl` by sending an `Origin` header. Replace the URL with a fresh presigned S3 URL copied from the browser network panel. Use `GET`, not `HEAD`, because presigned URLs are method-specific:

```bash
curl -sS -D - -o /dev/null \
  -H 'Origin: https://gallery.example.com' \
  'https://my-gallery-storage.s3.eu-west-1.amazonaws.com/path/to/object?...'
```

The response should include `access-control-allow-origin: https://gallery.example.com`. A request without an `Origin` header may not show CORS headers, even when the policy is correct.

#### Common CORS Mistakes

- `AllowedOrigins` contains `https://gallery.example.com/` with a trailing slash. Use `https://gallery.example.com`.
- `AllowedOrigins` contains a path such as `https://gallery.example.com/photos`. Use only the origin.
- The user opens Gallery through a different hostname than the one in the policy.
- `HEAD` is missing from `AllowedMethods`.
- A CDN or custom domain does not forward the `Origin` request header, overrides CORS response headers, or cached the old response before CORS was configured.
- `IMMICH_S3_ENDPOINT` points at an internal Docker hostname such as `http://minio:9000` while `IMMICH_S3_SERVE_MODE=redirect`; browsers outside Docker cannot reach that endpoint. Use `proxy` or expose S3 on a browser-reachable hostname.
- Gallery is opened over HTTPS but `IMMICH_S3_ENDPOINT` uses plain HTTP. Use an HTTPS endpoint for redirect mode.

### 5. Restart Gallery

Recreate the containers to apply the new environment variables:

```bash
docker compose up -d
```

New uploads will now be stored in your S3 bucket. Existing files on disk will continue to be served normally.

For an existing deployment switching from `proxy` to `redirect`, the safe order is:

1. Apply bucket CORS.
2. Set `IMMICH_S3_SERVE_MODE=redirect`.
3. Recreate the Gallery containers.
4. Verify thumbnails, editing, face crops, copy-to-clipboard, and video playback from a browser.

## Example Configurations

### AWS S3

```bash title=".env"
IMMICH_STORAGE_BACKEND=s3
IMMICH_S3_BUCKET=my-gallery-storage
IMMICH_S3_REGION=eu-west-1
IMMICH_S3_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
IMMICH_S3_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

### MinIO (Docker Compose)

```bash title=".env"
IMMICH_STORAGE_BACKEND=s3
IMMICH_S3_BUCKET=gallery
IMMICH_S3_ENDPOINT=http://minio:9000
IMMICH_S3_ACCESS_KEY_ID=minioadmin
IMMICH_S3_SECRET_ACCESS_KEY=minioadmin
IMMICH_S3_SERVE_MODE=proxy
```

:::tip
When MinIO runs in the same Docker Compose stack, use the service name (e.g. `http://minio:9000`) as the endpoint.
Set `IMMICH_S3_SERVE_MODE=proxy` since clients cannot reach the internal Docker network directly.
:::

### Cloudflare R2

```bash title=".env"
IMMICH_STORAGE_BACKEND=s3
IMMICH_S3_BUCKET=my-gallery-storage
IMMICH_S3_ENDPOINT=https://abc123.r2.cloudflarestorage.com
IMMICH_S3_ACCESS_KEY_ID=your-r2-access-key
IMMICH_S3_SECRET_ACCESS_KEY=your-r2-secret-key
```

## Storage Template on S3

The [Storage Template](/administration/storage-template) organizes the bucket the way it organizes the disk, and the same **Enable storage template engine** setting turns it on for both.

- **New uploads** are written to `upload/<user id>/…` in the bucket first. Once metadata extraction has read the file's date and other details, Gallery moves the object to its template path under `library/<storage label or user id>/…`, together with its XMP sidecar if it has one.
- **Existing objects** move when an admin runs the **Storage template migration** job from **Administration > Job Queues**. Starting that job by hand also moves the S3 thumbnails, previews, full-size images, encoded videos and person thumbnails to the paths the current settings give them, unless the **Migration** job is running at that moment: start **Storage template migration** again once it has finished. The **Migration** job does the same, for S3 files as well as files on disk.
- **Files never move between disk and S3.** A file on disk is moved on disk, and an object in the bucket stays in the bucket. To move files from one backend to the other, use [Storage Migration](/features/storage-migration).

### Why a Move Is a Copy and a Delete

S3 has no rename operation for ordinary buckets: AWS offers one only for S3 Express One Zone directory buckets, and MinIO, Cloudflare R2 and Backblaze B2 have none. Gallery therefore moves an object in four steps:

1. Copy it to the new key. The copy happens inside the bucket, so no file data passes through Gallery.
2. Check that the copy has the expected size.
3. Point the asset at the new key.
4. Delete the old object.

If the copy or the size check fails, the asset stays at its old key and a later run tries again. If the delete fails, the asset is already at its new key and only the old object is left behind; Gallery logs a warning.

An XMP sidecar moves the same way, after its original. If the original's move failed, the sidecar stays where it is, and a later run moves both.

### Costs and Caveats

- **Requests.** Moving an original takes about five requests: one to check that the template path is free, one to read the object's details, the copy, one to check the copy's size, and the delete. An XMP sidecar takes about five more. When the template path is already taken, Gallery tries the name with `+1`, `+2` and so on, and each extra name costs one more request. Check your provider's request pricing: many bill a copy like an upload.
- **First run on a large library.** The first **Storage template migration** run on an existing S3 library moves one asset at a time, so it takes a while on a large library. Later runs make no requests for assets that are already in place.
- **Large objects.** A single copy request stops at 5 GiB, so larger objects are copied in parts with a multipart copy. A provider that does not support multipart copies, such as Storj, gets a single copy request instead. If a multipart copy fails, Gallery cancels it. If the server stops in the middle of one, the parts copied so far stay in the bucket, where you pay for them but do not see them in a normal listing. Add a lifecycle rule that aborts incomplete multipart uploads (`AbortIncompleteMultipartUpload` on AWS) after a few days; it also cleans up after an upload that was interrupted the same way.
- **Versioned buckets.** Deleting the old object only hides it: it stays in the bucket as a noncurrent version, and you pay for it, until a lifecycle rule removes it. Add a rule that expires noncurrent versions if you do not need them.
- **Object Lock and retention.** A locked object cannot be removed before its retention period ends. Depending on the provider, the delete either leaves the old object as a noncurrent version or fails. When it fails, Gallery logs a warning and does not try again, so the old object stays until you remove it. Either way, the asset itself has already moved.
- **Storage classes.** The copy keeps the source object's storage class, such as Standard-IA or Intelligent-Tiering, so a move does not undo a lifecycle rule. This applies to the standard S3 storage classes: a provider's own tier name, such as a MinIO lifecycle tier, is not passed on, and the copy gets the default storage class.
- **Archive storage classes.** An object in an archive class, S3 Glacier Flexible Retrieval, Glacier Deep Archive, or the Archive Access tiers of Intelligent-Tiering, cannot be copied until it is restored. It stays at its old key, with a warning on every run, until you restore it; the copy then keeps the archive class.
- **Links in flight.** In `redirect` mode, a presigned link Gallery handed out just before the object moved stops working, for example under a video that is already playing. Reloading the page fetches a link to the new key.

## FAQ

**Can I migrate existing files from disk to S3?**
Yes. Use the built-in [Storage Migration](/features/storage-migration) tool. It migrates in both directions, resumes after an interruption, is idempotent, and can roll back.

**Do I need to make my S3 bucket public?**
No. Gallery uses presigned URLs (in `redirect` mode) or proxies the files through the server (in `proxy` mode). The bucket should remain private.

**What happens if I switch back to disk storage?**
Files already stored in S3 will continue to be served from S3. Only new uploads will go to disk. Both backends are always active.

**Can I use IAM roles instead of access keys?**
Yes. If you omit `IMMICH_S3_ACCESS_KEY_ID` and `IMMICH_S3_SECRET_ACCESS_KEY`, the AWS SDK will use the standard credential chain (environment variables, IAM roles, instance metadata, etc.).

## Technical Implementation

### Storage Abstraction

S3 support is built on a `StorageBackend` interface that both the disk and S3 backends implement:

```
                    StorageBackend interface
                    ├── put(key, source)
                    ├── get(key) → stream
                    ├── exists(key)
                    ├── copy(fromKey, toKey)
                    ├── stat(key) → size
                    ├── delete(key)
                    ├── getServeStrategy(key) → file | redirect | stream
                    └── downloadToTemp(key) → tempPath + cleanup

        ┌───────────────────┐         ┌───────────────────┐
        │ DiskStorageBackend│         │ S3StorageBackend   │
        ├───────────────────┤         ├───────────────────┤
        │ Reads/writes to   │         │ AWS SDK v3         │
        │ local filesystem  │         │ @aws-sdk/client-s3 │
        │                   │         │ Multipart uploads  │
        │ getServeStrategy: │         │                    │
        │  → { type: file } │         │ getServeStrategy:  │
        └───────────────────┘         │  redirect mode:    │
                                      │   → presigned URL  │
                                      │  proxy mode:       │
                                      │   → S3 stream      │
                                      └───────────────────┘
```

The `StorageService` manages both backends as static singletons and routes operations based on the file path format.

### Dual Backend Routing

The **file path format decides the backend**:

- **Absolute paths** such as `/usr/src/app/upload/library/user/file.jpg` are legacy disk files and route to the disk backend.
- **Relative paths** such as `library/user/file.jpg` are S3 files and route to the S3 backend.

So no database schema change was needed. The existing `originalPath`, `path`, `thumbnailPath`, and `profileImagePath` columns store either format, and `StorageService.backendFor()` dispatches to the correct backend at runtime. Both backends are always active; `IMMICH_STORAGE_BACKEND` only controls where **new writes** go.

### Serve Modes

When a client requests an asset, `BaseService.serveFromBackend()` asks the resolved backend for a serve strategy and returns one of three response types:

| Backend | Mode       | Response                 | Client Behavior                                     |
| :------ | :--------- | :----------------------- | :-------------------------------------------------- |
| Disk    | n/a        | `ImmichFileResponse`     | Express sends the local file directly               |
| S3      | `redirect` | `ImmichRedirectResponse` | HTTP 302 to a presigned URL; client fetches from S3 |
| S3      | `proxy`    | `ImmichStreamResponse`   | Server streams S3 data through to the client        |

Presigned URLs expire after `IMMICH_S3_PRESIGNED_URL_EXPIRY` seconds (default 3600). Gallery sends `Cache-Control: private, no-cache, no-transform` on redirect responses so browsers do not reuse an expired 302. The S3 backend signs content type and filename response overrides when they are available, so inline display and explicit downloads behave consistently after the browser follows the redirect.

The S3 backend uses `forcePathStyle: true` when a custom endpoint is configured, which is required for MinIO, DigitalOcean Spaces, and similar providers.

### Upload Flow

When S3 is the write backend, uploads follow this path:

1. File is uploaded to a local temp directory (standard NestJS multipart handling).
2. The file is uploaded to S3 under `upload/<user id>/…` using the `@aws-sdk/lib-storage` `Upload` class (supports automatic multipart for large files).
3. The database is updated with the relative path.
4. A cleanup job deletes the local temp file.
5. After metadata extraction, if the storage template is enabled, the object and its sidecar are moved to their template keys under `library/<storage label or user id>/…` with a server-side copy, a size check and a delete (see [Why a Move Is a Copy and a Delete](#why-a-move-is-a-copy-and-a-delete)).

Profile images (both user-uploaded and OAuth-synced) follow the same pattern: the file is written to disk first, then uploaded to S3 if the write backend is S3, and the local temp file is cleaned up.

For operations that require filesystem access (ffmpeg transcoding, exiftool metadata extraction), the S3 backend provides a `downloadToTemp()` method that streams the object to a local temp file and returns a cleanup function.

### Archive Downloads

Album downloads, selection downloads and shared-link archives all work with both disk and S3-backed assets. For S3 assets, Gallery opens object streams lazily and serializes ZIP entry appends so large archives do not exhaust the S3 connection pool. This is most visible in `proxy` mode or when downloading many S3-only assets through the server.

### Cleanup Behavior

When a user is permanently deleted, Gallery removes their files from both backends:

- **On disk**, the folders `library/<storage label or user id>`, `upload/<user id>`, `profile/<user id>`, `thumbs/<user id>` and `encoded-video/<user id>` in the media location, as Immich does.
- **In S3**, every object under the same five prefixes: `library/<storage label or user id>/`, `upload/<user id>/`, `profile/<user id>/`, `thumbs/<user id>/` and `encoded-video/<user id>/`. This happens whenever S3 is configured (`IMMICH_S3_BUCKET` is set), whatever `IMMICH_STORAGE_BACKEND` says, so objects left in the bucket after switching back to disk are removed too.

The `library/` folder is named after the user's storage label at the time of deletion, or their user ID when they have none. Files the user left under an earlier storage label are not removed. If another user's files are stored under the `library/` prefix in S3, Gallery skips that prefix and logs a warning. This happens when a storage label was changed without running the **Storage template migration** job, so the files stayed under the old label, and another user was later given that label. On disk, Gallery removes the library folder as Immich does, without this check, so run the **Storage template migration** job after changing a storage label.

If deleting an S3 prefix fails, Gallery logs a warning and carries on. It does not try again: the user is removed anyway, and the objects left under that prefix have to be deleted by hand. Backups are never removed, because they belong to the server rather than to a user.

Sidecar copy operations also respect the target asset's backend. Copying XMP metadata from one asset to another downloads the source sidecar to a temporary local file when needed, then writes the target sidecar either to disk or to the relative S3 key for that asset.
