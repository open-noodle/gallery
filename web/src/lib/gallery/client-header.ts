import { version } from '../../../package.json';

/** Tells the server this is a Gallery client, so it reports the Gallery version (server/src/gallery/client-version.ts). */
export const galleryAppHeader = { 'x-gallery-app': version };
