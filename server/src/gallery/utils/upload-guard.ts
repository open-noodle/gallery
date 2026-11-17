import type { IncomingHttpHeaders } from 'node:http';
import type { Readable } from 'node:stream';
import { ImmichHeader } from 'src/enum.js';
import { fromChecksum, fromMaybeArray } from 'src/utils/request.js';

// `\xff\x01Exiv`: an Exiv2 `.exv` metadata blob (EXIF only, no image data). No media format the server
// accepts starts like that: JPEG starts `ff d8`, MP4/MOV/HEIC carry `ftyp`/`moov` near the start.
const EXIV2_MAGIC = Buffer.from([0xff, 0x01, 0x45, 0x78, 0x69, 0x76]);

/** Collects the first bytes of an upload stream, alongside the interceptor's own `data` listener. */
export function watchUploadHead(stream: Readable): () => Buffer {
  let head = Buffer.alloc(0);
  const onData = (chunk: Buffer) => {
    head = Buffer.concat([head, chunk]).subarray(0, EXIV2_MAGIC.length);
    if (head.length >= EXIV2_MAGIC.length) {
      stream.off('data', onData);
    }
  };
  stream.on('data', onData);
  return () => head;
}

/**
Why a non-empty upload is rejected, or undefined to accept it: an Exiv2 blob, or bytes whose SHA-1 differs from
the `x-immich-checksum` header the client sent. Uploads without the header skip the checksum check.
*/
export function getUploadError(head: Buffer, digest: Buffer | undefined, headers: IncomingHttpHeaders) {
  if (head.subarray(0, EXIV2_MAGIC.length).equals(EXIV2_MAGIC)) {
    return 'File is an Exiv2 metadata blob';
  }
  const checksum = fromMaybeArray(headers[ImmichHeader.Checksum]);
  if (digest && checksum && !digest.equals(fromChecksum(checksum))) {
    return 'Checksum mismatch';
  }
}
