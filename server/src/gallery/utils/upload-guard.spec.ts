import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { getUploadError, watchUploadHead } from 'src/gallery/utils/upload-guard.js';

const sha1 = (body: Buffer) => createHash('sha1').update(body).digest();

describe('getUploadError', () => {
  const body = Buffer.from('hello world');
  const digest = sha1(body);

  it('accepts a file whose checksum matches the header, hex or base64', () => {
    expect(getUploadError(body, digest, { 'x-immich-checksum': digest.toString('hex') })).toBeUndefined();
    expect(getUploadError(body, digest, { 'x-immich-checksum': digest.toString('base64') })).toBeUndefined();
  });

  it('accepts a file without the checksum header', () => {
    expect(getUploadError(body, digest, {})).toBeUndefined();
  });

  it('skips the checksum check for an unhashed field (sidecar)', () => {
    expect(getUploadError(body, undefined, { 'x-immich-checksum': 'a'.repeat(40) })).toBeUndefined();
  });

  it('rejects a checksum mismatch', () => {
    expect(getUploadError(body, digest, { 'x-immich-checksum': Buffer.alloc(20).toString('base64') })).toBe(
      'Checksum mismatch',
    );
  });

  it('rejects an Exiv2 blob even when its checksum matches', () => {
    const exv = Buffer.from([0xff, 0x01, 0x45, 0x78, 0x69, 0x76, 0x32, 0x00]);
    expect(getUploadError(exv, sha1(exv), { 'x-immich-checksum': sha1(exv).toString('hex') })).toBe(
      'File is an Exiv2 metadata blob',
    );
  });

  it('accepts a JPEG', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(getUploadError(jpeg, sha1(jpeg), {})).toBeUndefined();
  });
});

describe('watchUploadHead', () => {
  it('collects the first six bytes across chunks shorter than the magic', async () => {
    const stream = new PassThrough();
    const head = watchUploadHead(stream);
    stream.on('data', () => {});

    for (const chunk of [[0xff], [0x01, 0x45], [0x78, 0x69, 0x76, 0x32, 0x00]]) {
      stream.write(Buffer.from(chunk));
    }
    stream.end();
    await new Promise((resolve) => stream.on('end', resolve));

    expect(head()).toEqual(Buffer.from([0xff, 0x01, 0x45, 0x78, 0x69, 0x76]));
  });
});
