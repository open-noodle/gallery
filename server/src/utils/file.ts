import { HttpException, NotFoundException, StreamableFile } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { access, constants } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { CacheControl } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { ImmichReadStream } from 'src/repositories/storage.repository';
import { isConnectionAborted } from 'src/utils/misc';

export function getFileNameWithoutExtension(path: string): string {
  return basename(path, getFilenameExtension(path));
}

export function getFilenameExtension(path: string) {
  const extension = extname(path);
  if (!extension && path.startsWith('.') && !path.includes('.', 1)) {
    return path;
  }
  return extension;
}

export function getLivePhotoMotionFilename(stillName: string, motionName: string) {
  return getFileNameWithoutExtension(stillName) + getFilenameExtension(motionName);
}

export type ContentDisposition = 'inline' | 'attachment';

export const getContentDispositionHeader = (disposition: ContentDisposition, fileName: string): string => {
  return `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

export class ImmichFileResponse {
  public readonly path!: string;
  public readonly contentType!: string;
  public readonly cacheControl!: CacheControl;
  public readonly fileName?: string;
  public readonly disposition?: ContentDisposition;

  constructor(response: ImmichFileResponse) {
    Object.assign(this, response);
  }
}

export class ImmichRedirectResponse {
  public readonly url!: string;
  public readonly cacheControl!: CacheControl;

  constructor(response: ImmichRedirectResponse) {
    Object.assign(this, response);
  }
}

export class ImmichStreamResponse {
  public readonly stream!: Readable;
  public readonly contentType!: string;
  public readonly length?: number;
  public readonly cacheControl!: CacheControl;
  public readonly fileName?: string;
  public readonly disposition?: ContentDisposition;

  constructor(response: ImmichStreamResponse) {
    Object.assign(this, response);
  }
}

export type ImmichMediaResponse = ImmichFileResponse | ImmichRedirectResponse | ImmichStreamResponse;

type SendFile = Parameters<Response['sendFile']>;
type SendFileOptions = SendFile[1];

const cacheControlHeaders: Record<CacheControl, string | null> = {
  [CacheControl.PrivateWithCache]:
    'private, max-age=86400, no-transform, stale-while-revalidate=2592000, stale-if-error=2592000',
  [CacheControl.PrivateWithoutCache]: 'private, no-cache, no-transform',
  [CacheControl.None]: null, // falsy value to prevent adding Cache-Control header
};

export const sendFile = async (
  res: Response,
  next: NextFunction,
  handler: () => Promise<ImmichMediaResponse> | ImmichMediaResponse,
  logger: LoggingRepository,
): Promise<void> => {
  // promisified version of 'res.sendFile' for cleaner async handling
  const _sendFile = (path: string, options: SendFileOptions) =>
    promisify<string, SendFileOptions>(res.sendFile).bind(res)(path, options);

  try {
    const file = await handler();

    if (file instanceof ImmichRedirectResponse) {
      let parsed: URL;
      try {
        parsed = new URL(file.url);
      } catch {
        throw new HttpException('Invalid redirect URL', 500);
      }

      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new HttpException('Invalid redirect URL protocol', 500);
      }

      const cacheControlHeader = cacheControlHeaders[file.cacheControl];
      if (cacheControlHeader) {
        res.set('Cache-Control', cacheControlHeader);
      }
      res.redirect(file.url);
      return;
    }

    if (file instanceof ImmichStreamResponse) {
      const cacheControlHeader = cacheControlHeaders[file.cacheControl];
      if (cacheControlHeader) {
        res.set('Cache-Control', cacheControlHeader);
      }
      res.header('Content-Type', file.contentType);
      if (file.length !== undefined) {
        res.header('Content-Length', String(file.length));
      }
      if (file.fileName) {
        res.header('Content-Disposition', getContentDispositionHeader(file.disposition ?? 'inline', file.fileName));
      }
      file.stream.pipe(res);
      return;
    }

    // ImmichFileResponse — existing behavior
    const resolvedPath = resolve(file.path);
    if (resolvedPath !== file.path) {
      throw new HttpException('Invalid file path', 400);
    }
    await access(resolvedPath, constants.R_OK);

    const cacheControlHeader = cacheControlHeaders[file.cacheControl];
    if (cacheControlHeader) {
      res.set('Cache-Control', cacheControlHeader);
    }

    res.header('Content-Type', file.contentType);
    if (file.fileName) {
      res.header('Content-Disposition', getContentDispositionHeader(file.disposition ?? 'inline', file.fileName));
    }

    return await _sendFile(resolvedPath, { root: '/', dotfiles: 'allow' });
  } catch (error: Error | any) {
    // ignore client-closed connection
    if (isConnectionAborted(error) || res.headersSent) {
      return;
    }

    // gallery-fork: preserve HttpException status codes. Upstream #28843 masks
    // every sendFile error as 404, but the fork's shared-space access matrix
    // relies on 401 < 403 < 404 ordering for files served via sendFile (e.g.
    // person thumbnails), so a ForbiddenException must stay 403, not become 404.
    if (error instanceof HttpException) {
      return next(error);
    }

    // mask internal errors as 404 (upstream #28843)
    logger.error(`Unable to send file: ${error}`, error.stack);
    next(new NotFoundException());
  }
};

export const asStreamableFile = ({ stream, type, disposition, length }: ImmichReadStream) => {
  return new StreamableFile(stream, { type, disposition, length });
};
