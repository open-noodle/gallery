import { coerce, gte } from 'semver';

/**
 * Server-side counterpart to the mobile app's `ServerCapability`
 * (`mobile/lib/domain/models/server_capability.model.dart`), pointing the other way: that enum lets
 * the app ask "is the server new enough for this feature", this one lets the server ask "is the
 * connecting app new enough to be sent this".
 *
 * It exists because server and mobile release independently (see the Releases section of
 * CLAUDE.md), so a server can always be newer than an installed app, and the generated Dart models
 * are not tolerant of values they predate: an unrecognized enum string makes the generated
 * `fromJson` return null, and the resulting exception fails the whole sync batch rather than the
 * one entity. A failed batch is never acknowledged, so the client retries it forever - a single
 * new-shaped record can wedge an old app's sync permanently. Withholding such records from clients
 * that cannot parse them is the only fix available for apps that are already installed.
 *
 * Each value is the **first mobile release that ships support for the feature**, same convention as
 * `ServerCapability.minVersion`. Note that getting this wrong is not symmetric: setting it too high
 * means a capable app temporarily misses some records, while setting it too low means an incapable
 * app gets wedged, so prefer the higher value when a release number is still uncertain.
 */
export enum ClientCapability {
  /**
   * The `adjust` asset-edit action (exposure/contrast/saturation/invert).
   *
   * v5.6.0 is the newest tagged release, and the v5.7.0 release candidates were cut before this
   * feature existed - the prerelease-aware comparison below already places `5.7.0-rc.N` below
   * `5.7.0`, so those builds are excluded. **If the Adjust tool does not make the v5.7.0 cut, this
   * must be raised to the release it does ship in**, or every v5.7.0 app hits the sync-wedging
   * crash this gate exists to prevent.
   */
  AdjustEdits = '5.7.0',
}

/**
 * Whether a client reporting `appVersion` can be relied on to understand `capability`.
 *
 * `appVersion` comes from the `User-Agent` on the current request (see `getAppVersionFromUA`), so
 * it is null for anything that is not a Gallery/Immich mobile build - a browser, the CLI, a
 * third-party script - and may also be null for a mobile session that predates the `appVersion`
 * session column, or unparseable for a custom build.
 *
 * Unknown always means **not supported**. The cost of that default is asymmetric: a client wrongly
 * treated as old just doesn't receive some records over this one channel, while a client wrongly
 * treated as new can be wedged permanently. Non-mobile clients lose nothing in practice, because
 * the delta sync stream (`POST /sync/stream`) is only consumed by the mobile app - the web app
 * reads edits from the REST API and the `AssetEditReadyV2` websocket event instead.
 */
export const clientSupports = (appVersion: string | null | undefined, capability: ClientCapability): boolean => {
  if (!appVersion) {
    return false;
  }

  const version = coerce(appVersion, { includePrerelease: true });

  return version ? gte(version, capability) : false;
};
