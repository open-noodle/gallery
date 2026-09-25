---
sidebar_position: 60
---

# Arch Linux (AUR) [Community]

Noodle Gallery is available for Arch-based distributions through the Arch User Repository (AUR).

:::info
The `noodle-gallery` package is a community package, not an official Noodle Gallery release. It ships the official Docker images and manages them with a systemd unit. See the [package page](https://aur.archlinux.org/packages/noodle-gallery) for updates and issues.
:::

## Requirements

Follow the [requirements page](/install/requirements). The package depends on [`docker`](https://archlinux.org/packages/extra/x86_64/docker/) and [`docker-compose`](https://archlinux.org/packages/extra/x86_64/docker-compose/), which are installed automatically.

## Install

Install with your favourite AUR helper, for example `paru` or `yay`:

```bash
paru -S noodle-gallery
```

The package provides:

- a Docker Compose stack using the official [`gallery-server`](https://github.com/open-noodle/gallery/pkgs/container/gallery-server) and [`gallery-ml`](https://github.com/open-noodle/gallery/pkgs/container/gallery-ml) images,
- a `noodle-gallery.service` systemd unit,
- configuration templates under `/usr/share/noodle-gallery`.

## Configure

On first install, a working configuration is generated at `/etc/noodle-gallery/.env` with a random `DB_PASSWORD`. Edit it if needed:

- `UPLOAD_LOCATION` — where your photos and videos are stored (`/var/lib/noodle-gallery/library` by default),
- `DB_DATA_LOCATION` — where the PostgreSQL data lives (SSD recommended),
- `IMMICH_VERSION` — pin the Gallery image version, e.g. `v5.7.0`,
- `TZ` — uncomment and set your timezone.

## Start

```bash
systemctl enable --now noodle-gallery
```

The web application and mobile app are available at `http://<machine-ip-address>:2283`.

## Upgrading

Upgrade the package and restart the stack:

```bash
paru -Syu
systemctl restart noodle-gallery
```

To move to a newer Gallery release, bump `IMMICH_VERSION` in `/etc/noodle-gallery/.env`. Database migrations run automatically on startup.

## Notes

- The stack is single-instance: it uses fixed container names (`immich_server`, `immich_postgres`, ...).
- Your library and database live under `/var/lib/noodle-gallery` and are kept on package removal.

:::tip
For common next steps, see [Post Install Steps](/install/post-install.mdx).
:::
