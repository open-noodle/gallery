import { createHash } from 'node:crypto';
import { getUploadError } from 'src/middleware/file-upload.interceptor.js';

describe('getUploadError', () => {
  const body = Buffer.from('hello world');
  const digest = createHash('sha1').update(body).digest();

  it('should accept a valid file', () => {
    expect(getUploadError(body.length, body, digest, digest.toString('base64'))).toBeUndefined();
    expect(getUploadError(body.length, body, digest)).toBeUndefined();
  });

  it('should reject a checksum mismatch', () => {
    expect(getUploadError(body.length, body, digest, Buffer.alloc(20).toString('base64'))).toBe('Checksum mismatch');
  });

  it('should reject an Exiv2 blob', () => {
    const exv = Buffer.from([0xff, 0x01, 0x45, 0x78, 0x69, 0x76, 0x32, 0x00]);
    expect(getUploadError(195, exv, createHash('sha1').update(exv).digest())).toBe('File is an Exiv2 metadata blob');
  });
});
