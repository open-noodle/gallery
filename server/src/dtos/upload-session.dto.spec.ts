import { UploadSessionCreateDto } from 'src/dtos/upload-session.dto';

const valid = {
  filename: 'IMG_1234.jpg',
  size: 1024,
  fileCreatedAt: '2026-09-08T10:00:00.000Z',
  fileModifiedAt: '2026-09-08T10:00:00.000Z',
};

describe('UploadSessionCreateDto', () => {
  it('accepts a minimal valid body and parses dates to Date', () => {
    const parsed = UploadSessionCreateDto.schema.parse(valid);
    expect(parsed.filename).toBe('IMG_1234.jpg');
    expect(parsed.fileCreatedAt).toBeInstanceOf(Date);
  });

  // Spec §4.3 — the multipart schema would ACCEPT these; the JSON schema must not.
  it('rejects isFavorite as the string "false" (multipart form)', () => {
    expect(() => UploadSessionCreateDto.schema.parse({ ...valid, isFavorite: 'false' })).toThrow();
  });

  it('accepts isFavorite as a JSON boolean', () => {
    expect(UploadSessionCreateDto.schema.parse({ ...valid, isFavorite: false }).isFavorite).toBe(false);
  });

  it('rejects metadata as a JSON string (multipart form)', () => {
    expect(() => UploadSessionCreateDto.schema.parse({ ...valid, metadata: '[]' })).toThrow();
  });

  it('accepts metadata as a real array', () => {
    expect(UploadSessionCreateDto.schema.parse({ ...valid, metadata: [] }).metadata).toEqual([]);
  });

  // §8 row 3
  it.each([0, -1])('rejects size %s', (size) => {
    expect(() => UploadSessionCreateDto.schema.parse({ ...valid, size })).toThrow();
  });

  // §4.3 — filename is required here, unlike the multipart schema
  it('rejects a missing filename', () => {
    const { filename: _, ...withoutFilename } = valid;
    expect(() => UploadSessionCreateDto.schema.parse(withoutFilename)).toThrow();
  });

  // §8 row 8
  it('rejects a sidecar over 1 MiB', () => {
    expect(() => UploadSessionCreateDto.schema.parse({ ...valid, sidecar: 'x'.repeat(1_048_577) })).toThrow();
  });

  it('accepts a sidecar at exactly 1 MiB', () => {
    expect(() => UploadSessionCreateDto.schema.parse({ ...valid, sidecar: 'x'.repeat(1_048_576) })).not.toThrow();
  });
});
