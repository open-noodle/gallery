import { getClientServerVersion, isGalleryClient, stockClientRoom } from 'src/gallery/client-version.js';

vitest.mock('node:fs', () => ({
  readFileSync: () => JSON.stringify({ version: '5.4.0', immichVersion: '3.3.1' }),
}));

describe(isGalleryClient.name, () => {
  it.each([
    ['the x-gallery-app header', { 'x-gallery-app': '5.4.0', 'user-agent': 'Mozilla/5.0' }],
    ['a Gallery android app', { 'user-agent': 'immich-android/5.4.0' }],
    ['a Gallery ios app', { 'user-agent': 'immich-ios/5.0.0' }],
    ['a Gallery app debug build', { 'user-agent': 'immich-android/6.1.2-DEBUG' }],
  ])('treats %s as Gallery', (_, headers) => {
    expect(isGalleryClient(headers)).toBe(true);
  });

  it.each([
    ['a stock android app', { 'user-agent': 'immich-android/3.3.1' }],
    ['a stock ios app newer than the base', { 'user-agent': 'immich-ios/4.9.0' }],
    ['a legacy stock app', { 'user-agent': 'Immich_Android_2.7.5' }],
    ['the Gallery app before it stamps a version', { 'user-agent': 'immich-android/1.0.0' }],
    ['a browser without the header', { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0' }],
    ['a third-party tool', { 'user-agent': 'immich-kiosk/5.0.0' }],
    ['a request without a user agent', {}],
    ['an empty header', { 'x-gallery-app': '' }],
  ])('treats %s as stock', (_, headers) => {
    expect(isGalleryClient(headers)).toBe(false);
  });

  it('accepts the header from the socket.io handshake auth payload', () => {
    expect(isGalleryClient({ 'user-agent': 'Mozilla/5.0' }, { 'x-gallery-app': '5.4.0' })).toBe(true);
    expect(isGalleryClient({ 'user-agent': 'Mozilla/5.0' }, {})).toBe(false);
  });
});

describe(getClientServerVersion.name, () => {
  it('reports the Gallery version to Gallery clients', () => {
    expect(getClientServerVersion({ 'x-gallery-app': '5.4.0' }).version).toBe('5.4.0');
  });

  it('reports the upstream base version to stock clients', () => {
    expect(getClientServerVersion({ 'user-agent': 'immich-android/3.3.1' }).version).toBe('3.3.1');
  });
});

describe(stockClientRoom.name, () => {
  it('scopes the stock room to a user or session', () => {
    expect(stockClientRoom('user-1')).toBe('stock-immich-client:user-1');
    expect(stockClientRoom()).toBe('stock-immich-client');
  });
});
