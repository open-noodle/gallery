---
sidebar_position: 3
---

# Logging in on the mobile app

Hosted Gallery uses the same Noodle-branded mobile app documented in
[Mobile App](/features/mobile-app.mdx) — you just point it at the server we host for
you instead of a self-hosted one. This page covers the one part that's different: how a
hosted-Gallery customer signs in.

## Download the app

- [App Store](https://apps.apple.com/il/app/noodle-gallery/id6761776289)
- [Google Play Store](https://play.google.com/store/apps/details?id=de.opennoodle.gallery)

## Add your server

When the app asks for a server, enter your Gallery's address:

```
https://<your-subdomain>.noodlegallery.de
```

You'll find your exact address in the "Your gallery is open" email we sent you, and on
your **Account** page in the dashboard.

## Sign in

Hosted Gallery accounts don't have a separate Gallery username or password — signing in
goes through your Noodle account instead, the same one you use at
[app.noodlegallery.de](https://app.noodlegallery.de). After you enter your server
address, the app takes you to our sign-in page at `auth.noodlegallery.de`. Log in there
with your account email and password, and you're taken back into the app, signed in.

## Back up your photos

Once you're signed in, backup, album sync, and everything else in the app works exactly
as described in [Mobile App](/features/mobile-app.mdx) — that page covers turning on
backup, syncing only selected photos, and freeing up space on your device.

## Trouble logging in?

- Double-check the server address — it must be your own `<uid>.noodlegallery.de`
  address, not `noodlegallery.de` or `app.noodlegallery.de`.
- Make sure the mobile app is up to date; an old app version can fail to sign in against
  a newer server.
- Check [status.opennoodle.de](https://status.opennoodle.de) to see whether sign-in is
  having a known issue before troubleshooting further.
