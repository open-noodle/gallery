import { AuthDto } from 'src/dtos/auth.dto';
import { AlbumService } from 'src/services/album.service';
import { BaseService } from 'src/services/base.service';
import { SharedSpaceService } from 'src/services/shared-space.service';

export type GallerySkipReason = 'invalid-config' | 'no-access' | 'not-found' | 'unknown-method';
export type GalleryDispatchResult = { ok: true } | { ok: false; reason: GallerySkipReason };

type GalleryHandler = (auth: AuthDto, args: unknown) => Promise<GalleryDispatchResult>;

/**
 * Fork-owned dispatcher for every Gallery workflow step.
 *
 * Reached from upstream's `gallery` host function. Constructed with `BaseService.create`, so it is
 * deliberately NOT registered in `services/index.ts` — it has no controller, jobs or events.
 */
export class GalleryWorkflowHostService extends BaseService {
  private services?: { sharedSpace: SharedSpaceService; album: AlbumService };

  /**
   * The single seam that makes this service unit-testable. `newTestService` injects repositories,
   * while `BaseService.create` builds real services from them — so without this, a test could not
   * observe collaborator calls at all. Specs subclass and override it. Memoised so a step does not
   * rebuild both services on every dispatch.
   */
  protected collaborators(): { sharedSpace: SharedSpaceService; album: AlbumService } {
    this.services ??= {
      sharedSpace: BaseService.create(SharedSpaceService, this),
      album: BaseService.create(AlbumService, this),
    };

    return this.services;
  }

  private readonly handlers: Record<string, GalleryHandler> = {};

  get methodNames(): string[] {
    return Object.keys(this.handlers);
  }

  async dispatch(auth: AuthDto, method: string, args: unknown): Promise<GalleryDispatchResult> {
    if (!Object.hasOwn(this.handlers, method)) {
      this.logger.warn(`Unknown gallery workflow method: ${method}`);
      return { ok: false, reason: 'unknown-method' };
    }

    const handler = this.handlers[method];
    return handler(auth, args);
  }
}
