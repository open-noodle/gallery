import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { UploadFieldName } from 'src/dtos/asset-media.dto.js';
import { FileUploadInterceptor } from 'src/middleware/file-upload.interceptor.js';

// The fork's upload guard (`src/gallery/utils/upload-guard.ts`) through the real interceptor's multer storage
// handler. Controller specs override FileUploadInterceptor, so they cannot reach it.
describe(`${FileUploadInterceptor.name} upload guard`, () => {
  const sha1 = (body: Buffer) => createHash('sha1').update(body).digest('hex');
  const exiv2 = Buffer.concat([Buffer.from([0xff, 0x01]), Buffer.from('Exiv2'), Buffer.alloc(188)]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

  const upload = (chunks: Buffer[], headers: Record<string, string> = {}) => {
    const onUploadError = vi.fn().mockResolvedValue(undefined);
    const assetService = { getUploadFolder: () => '/upload', getUploadFilename: () => 'file.jpg', onUploadError };
    const storage = { createWriteStream: () => new Writable({ write: (_chunk, _encoding, done) => done() }) };
    const logger = { setContext: () => {} };
    const sut = new FileUploadInterceptor({} as never, assetService as never, storage as never, logger as never);

    const request = Object.assign(new EventEmitter(), { headers, user: { auth: {} }, body: {} });
    const file = {
      fieldname: UploadFieldName.ASSET_DATA,
      originalname: 'IMG_0001.jpg',
      stream: Readable.from(chunks),
    };

    type Result = {
      error: Error | null;
      info?: { size?: number; checksum?: Buffer };
      onUploadError: typeof onUploadError;
    };
    return new Promise<Result>((resolve) => {
      (sut as any).handleFile(request, file, (error: Error | null, info?: { size?: number; checksum?: Buffer }) =>
        resolve({ error, info, onUploadError }),
      );
    });
  };

  it('rejects an Exiv2 blob split across tiny chunks, even with a matching checksum', async () => {
    const chunks = [exiv2.subarray(0, 1), exiv2.subarray(1, 3), exiv2.subarray(3)];
    const { error, onUploadError } = await upload(chunks, { 'x-immich-checksum': sha1(exiv2) });
    expect(error?.message).toBe('File is an Exiv2 metadata blob');
    // The bytes are already on disk: Immich's failed-upload cleanup deletes them.
    expect(onUploadError).toHaveBeenCalledOnce();
  });

  it('rejects bytes whose SHA-1 differs from x-immich-checksum', async () => {
    const { error, onUploadError } = await upload([jpeg], { 'x-immich-checksum': sha1(Buffer.from('other')) });
    expect(error?.message).toBe('Checksum mismatch');
    expect(onUploadError).toHaveBeenCalledOnce();
  });

  it('accepts a JPEG with and without a matching checksum, returning its hash', async () => {
    const cases: Record<string, string>[] = [{ 'x-immich-checksum': sha1(jpeg) }, {}];
    for (const headers of cases) {
      const { error, info, onUploadError } = await upload([jpeg], headers);
      expect(error).toBeNull();
      expect(onUploadError).not.toHaveBeenCalled();
      expect(info?.size).toBe(jpeg.length);
      expect(info?.checksum?.toString('hex')).toBe(sha1(jpeg));
    }
  });

  it('still rejects an empty file first', async () => {
    const { error } = await upload([]);
    expect(error?.message).toBe('File is empty');
  });
});
