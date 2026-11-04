import { Test } from 'supertest';

/**
 * The e2e API suite talks to the server as a Gallery client, as the web, mobile and CLI apps do: every
 * supertest request sends `x-gallery-app` unless it sets its own value, and `utils.initSdk` sets it on the SDK.
 * A request that calls `.unset('x-gallery-app')` stays a stock Immich client (see stock-client.e2e-spec.ts).
 * `src/utils.ts` imports this module, so every spec and the Playwright suites load the patch.
 */
export const GALLERY_APP_HEADER = 'x-gallery-app';

const patched = Symbol.for('gallery-e2e-client');
const proto = Test.prototype;

// The vitest suites do not isolate spec files, so the module can be evaluated more than once per process.
if (!Object.hasOwn(proto, patched)) {
  Object.defineProperty(proto, patched, { value: true });
  const stockClients = new WeakSet<Test>();
  const { end, unset } = proto;

  proto.unset = function (this: Test, field: string) {
    if (field.toLowerCase() === GALLERY_APP_HEADER) {
      stockClients.add(this);
    }
    return unset.call(this, field);
  };

  proto.end = function (this: Test, callback) {
    if (!stockClients.has(this) && this.get(GALLERY_APP_HEADER) === undefined) {
      this.set(GALLERY_APP_HEADER, 'e2e');
    }
    return end.call(this, callback);
  };
}
