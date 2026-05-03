/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { installMessageListener } from './messaging';

const sw = globalThis as unknown as ServiceWorkerGlobalScope;

const handleActivate = (event: ExtendableEvent) => {
  event.waitUntil(sw.clients.claim());
};

const handleInstall = (event: ExtendableEvent) => {
  event.waitUntil(sw.skipWaiting());
};

<<<<<<< HEAD
const handleFetch = (event: FetchEvent): void => {
  if (event.request.method !== 'GET') {
    return;
  }

  // Cache requests for thumbnails
  const url = new URL(event.request.url);
  if (url.origin === globalThis.location.origin && ASSET_REQUEST_REGEX.test(url.pathname)) {
    event.respondWith(handleAssetFetch(event.request));
    return;
  }
};

||||||| parent of 1b7caaca12 (feat: support direct S3 media delivery (#502))
const handleFetch = (event: FetchEvent): void => {
  if (event.request.method !== 'GET') {
    return;
  }

  // Cache requests for thumbnails
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && ASSET_REQUEST_REGEX.test(url.pathname)) {
    event.respondWith(handleAssetFetch(event.request));
    return;
  }
};

=======
>>>>>>> 1b7caaca12 (feat: support direct S3 media delivery (#502))
sw.addEventListener('install', handleInstall, { passive: true });
sw.addEventListener('activate', handleActivate, { passive: true });
installMessageListener();
