import { HttpException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import { AlbumService } from 'src/services/album.service';
import { BaseService } from 'src/services/base.service';
import { SharedSpaceService } from 'src/services/shared-space.service';

export type GallerySkipReason = 'invalid-config' | 'no-access' | 'not-found' | 'unknown-method';
export type GalleryDispatchResult = { ok: true } | { ok: false; reason: GallerySkipReason };

type GalleryHandler = (auth: AuthDto, args: unknown) => Promise<GalleryDispatchResult>;

/** Returned by `runGuarded` when an expected, user-fixable failure was swallowed. */
export const SKIPPED = Symbol('skipped');

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

  /**
   * Runs collaborator work, swallowing user-fixable failures.
   *
   * Anything derived from HttpException is a condition the user can fix (not a member, no
   * contribution rights, space deleted). Those must not escape: a throw here unwinds into
   * upstream's `execute()` catch, which abandons every remaining step of the workflow.
   * Everything else is a bug and propagates.
   */
  protected async runGuarded<T>(label: string, work: () => Promise<T>): Promise<T | typeof SKIPPED> {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof HttpException)) {
        throw error;
      }

      this.logger.warn(`${label} skipped: ${error}`);
      return SKIPPED;
    }
  }

  private readonly handlers: Record<string, GalleryHandler> = {
    addToSpace: (auth, args) => this.handleAddToSpace(auth, args),
  };

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

  private async handleAddToSpace(auth: AuthDto, args: unknown): Promise<GalleryDispatchResult> {
    const { spaceIds, assetId } = args as { spaceIds: string[]; assetId: string };
    const { sharedSpace } = this.collaborators();

    const result = await this.runGuarded('addToSpace', () =>
      sharedSpace.addAssets(auth, spaceIds[0], { assetIds: [assetId] }),
    );

    return result === SKIPPED ? { ok: false, reason: 'no-access' } : { ok: true };
  }
}
