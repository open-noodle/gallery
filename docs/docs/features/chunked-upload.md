# Chunked / Resumable Upload

Gallery uploads large files in smaller pieces instead of sending the whole file in one request. This means a reverse proxy's body-size limit no longer caps the size of asset you can upload, and a network hiccup only costs you the current chunk, not the whole file.

## The Problem It Solves

Uploading an asset as a single request has two downsides:

- **Reverse-proxy body limits.** Managed proxies such as Cloudflare Tunnel cap request bodies at 100 MB, and self-hosted proxies need a `client_max_body_size` (or equivalent) large enough for your biggest file — see [Reverse Proxy](/administration/reverse-proxy).
- **No resumption.** If the connection drops at 95% of a multi-gigabyte video, the whole transfer is lost and has to restart from the beginning. This is especially common when backing up from mobile over a cellular connection.

Chunked upload splits a large file into fixed-size pieces and uploads them one at a time. Only the current chunk needs to fit under a proxy's body-size limit, and only the current chunk needs to be retried if a chunk fails.

## How It Works

Chunked upload is fully automatic — there is nothing to turn on and nothing to configure:

- Files **larger than 32 MiB** are uploaded in 32 MiB chunks.
- Files **at or under 32 MiB** continue to upload as a single request, exactly as before.
- If a chunk fails partway (a dropped connection, a proxy timeout), only that chunk is retried — the chunks already uploaded are not resent.
- Your storage quota is checked before the upload starts, so an over-quota upload is rejected up front instead of after the whole file has transferred.

:::info
The 32 MiB chunk size is a fixed value, not an admin setting.
:::

## Supported Clients

| Client                        | Support |
| ----------------------------- | ------- |
| Web                           | Yes     |
| CLI (`@immich/cli`)           | Yes     |
| Mobile app, in-app upload     | Yes     |
| Mobile app, background backup | Yes     |

A server that predates this feature is detected automatically, and clients fall back to a single request for the whole file, the same way uploads worked before.

## Limitation: Resumption Is Within-Session Only

:::note
Chunked upload protects an in-progress transfer from network drops and proxy timeouts, but it does not persist a paused upload across app restarts. If you close the browser tab, quit the app, or the upload is otherwise interrupted before it finishes, that file starts over from the beginning the next time it is uploaded. There is no resume UI and no way to pick a partially-uploaded file back up later — an abandoned upload is simply cleaned up on the server after a while.
:::

## Reverse Proxy Configuration

Because only one chunk is ever in flight per file, your reverse proxy's body-size limit only needs to comfortably exceed one chunk (32 MiB) plus a little overhead — it no longer needs to be sized for your largest file. See [Reverse Proxy](/administration/reverse-proxy) for an example.
