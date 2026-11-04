import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { galleryConfigPaths } from 'src/gallery/dtos/config.dto.js';
import { SystemConfigService } from 'src/services/system-config.service.js';

type ConfigNode = Record<string, unknown>;

const isNode = (value: unknown): value is ConfigNode => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Fills every Gallery setting an upstream-shaped config body leaves out with its stored value, in place. A setting
 * the body sends is kept as sent, and a path whose parent is missing is left alone for validation to report.
 */
export const withStoredGallerySettings = (body: unknown, stored: unknown) => {
  for (const path of galleryConfigPaths) {
    const keys = path.split('.');
    const key = keys.pop()!;
    let target: unknown = body;
    let source: unknown = stored;
    for (const parent of keys) {
      target = isNode(target) ? target[parent] : undefined;
      source = isNode(source) ? source[parent] : undefined;
    }
    if (isNode(target) && target[key] === undefined && isNode(source) && source[key] !== undefined) {
      target[key] = source[key];
    }
  }
  return body;
};

/**
 * Lets `PUT /system-config` and `PUT /admin/config` accept an upstream-shaped body (a stock admin tool, a
 * config-as-code script). Runs before validation, so the Gallery sections stay required in the schema and a
 * missing one keeps its stored value; a schema default would reset it on every such PUT instead.
 */
@Injectable()
export class UpstreamConfigBodyInterceptor implements NestInterceptor {
  constructor(private service: SystemConfigService) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();
    if (isNode(request.body)) {
      withStoredGallerySettings(request.body, await this.service.getAdminConfig());
    }
    return next.handle();
  }
}
