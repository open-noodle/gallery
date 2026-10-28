import { HttpException } from '@nestjs/common';
import z from 'zod';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { AlbumService } from 'src/services/album.service.js';
import { BaseService } from 'src/services/base.service.js';
import { SharedSpaceService } from 'src/services/shared-space.service.js';

export type GallerySkipReason = 'invalid-config' | 'no-access' | 'not-found' | 'unknown-method';
export type GalleryDispatchResult = { ok: true } | { ok: false; reason: GallerySkipReason };

const AddToSpaceArgs = z.object({
  assetId: z.uuidv4(),
  spaceIds: z.array(z.uuidv4()),
});

const AddToSpaceAlbumArgs = z.object({
  assetId: z.uuidv4(),
  spaceId: z.uuidv4(),
  albumName: z.string().trim().min(1),
});

const GALLERY_PLUGIN = 'gallery-core';

/**
 * Enabled gallery-core plugin ids, read once per process: keyed by the repository, a per-process singleton.
 * Upstream reads `enabled` only in getForLoad at boot, so a disabled gallery-core is never loaded and its
 * steps fall through to callMethod, which fails the run as it does for any unloaded plugin.
 */
const enabledGalleryPluginIds = new WeakMap<object, Promise<Set<string>>>();

type GalleryHandler = (auth: AuthDto, args: unknown) => Promise<GalleryDispatchResult>;

/** Returned by `runGuarded` when an expected, user-fixable failure was swallowed. */
export const SKIPPED = Symbol('skipped');

/**
 * Fork-owned dispatcher for every Gallery workflow step.
 *
 * Reached from upstream's workflow execute loop through `runStep`. Constructed with `BaseService.create`, so it is
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
    addToSpaceAlbum: (auth, args) => this.handleAddToSpaceAlbum(auth, args),
  };

  get methodNames(): string[] {
    return Object.keys(this.handlers);
  }

  /**
   * Runs a `gallery-core` workflow step in TypeScript and returns true; returns false for any other
   * plugin's step, which upstream's execute loop then sends to WASM. The plugin's own exports are
   * no-ops with no custom host import, so a stock Immich server can load it (OD-18).
   */
  async runStep(
    step: { pluginId: string; methodName: string; config: object | null },
    authUserId: string,
    data: unknown,
  ): Promise<boolean> {
    if (!Object.hasOwn(this.handlers, step.methodName)) {
      return false;
    }

    let pluginIds = enabledGalleryPluginIds.get(this.pluginRepository);
    if (!pluginIds) {
      pluginIds = this.pluginRepository
        .getForLoad()
        .then((plugins) => new Set(plugins.filter(({ name }) => name === GALLERY_PLUGIN).map(({ id }) => id)));
      // A failed read is retried on the next step rather than cached for the life of the process.
      pluginIds.catch(() => enabledGalleryPluginIds.delete(this.pluginRepository));
      enabledGalleryPluginIds.set(this.pluginRepository, pluginIds);
    }

    const enabledIds = await pluginIds;
    if (!enabledIds.has(step.pluginId)) {
      return false;
    }

    const assetId = (data as { asset?: { id?: string } } | undefined)?.asset?.id;
    await this.dispatch({ user: { id: authUserId } } as AuthDto, step.methodName, { ...step.config, assetId });
    return true;
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
    const parsed = AddToSpaceArgs.safeParse(args);
    if (!parsed.success) {
      this.logger.warn(`addToSpace: invalid config — ${parsed.error.message}`);
      return { ok: false, reason: 'invalid-config' };
    }

    const { assetId, spaceIds } = parsed.data;
    const { sharedSpace } = this.collaborators();
    let skipped = false;

    // Per-space isolation: one denied space must not stop the others (spec §7).
    for (const spaceId of new Set(spaceIds)) {
      const result = await this.runGuarded(`addToSpace(${spaceId})`, () =>
        sharedSpace.addAssets(auth, spaceId, { assetIds: [assetId] }),
      );

      skipped ||= result === SKIPPED;
    }

    return skipped ? { ok: false, reason: 'no-access' } : { ok: true };
  }

  private async handleAddToSpaceAlbum(auth: AuthDto, args: unknown): Promise<GalleryDispatchResult> {
    const parsed = AddToSpaceAlbumArgs.safeParse(args);
    if (!parsed.success) {
      this.logger.warn(`addToSpaceAlbum: invalid config — ${parsed.error.message}`);
      return { ok: false, reason: 'invalid-config' };
    }

    const { assetId, spaceId, albumName } = parsed.data;
    const { album } = this.collaborators();

    const outcome = await this.runGuarded(`addToSpaceAlbum(${spaceId})`, async () => {
      const albumId = await this.resolveSpaceAlbum(auth, spaceId, albumName);
      await album.addAssets(auth, albumId, { ids: [assetId] });
    });

    return outcome === SKIPPED ? { ok: false, reason: 'no-access' } : { ok: true };
  }

  /** Finds the named album among a space's linked albums, creating and linking it when absent. */
  private async resolveSpaceAlbum(auth: AuthDto, spaceId: string, albumName: string): Promise<string> {
    const { sharedSpace, album } = this.collaborators();
    const target = albumName.toLowerCase();

    const linkedAlbums = await sharedSpace.getLinkedAlbums(auth, spaceId);
    const matches = linkedAlbums
      .filter((candidate) => candidate.albumName.trim().toLowerCase() === target)
      // Oldest wins, tie-broken on id, so repeated runs converge on one album rather than fan out.
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

    const existing = matches[0];
    if (existing) {
      return existing.id;
    }

    const created = await album.create(auth, { albumName });

    try {
      await sharedSpace.linkAlbum(auth, spaceId, created.id);
    } catch (error) {
      // Compensate: this invocation created the album, so this invocation removes it. A
      // pre-existing album is never touched here, because this branch only runs after a create.
      await this.discardAlbum(auth, created.id);
      throw error;
    }

    return created.id;
  }

  /**
   * Best-effort cleanup of an album this invocation created. Swallows every failure: a throw here
   * would escape `runGuarded`'s HttpException filter and abandon the remaining workflow steps.
   */
  private async discardAlbum(auth: AuthDto, albumId: string): Promise<void> {
    try {
      await this.collaborators().album.delete(auth, albumId);
    } catch (error) {
      this.logger.error(`addToSpaceAlbum: failed to clean up orphan album ${albumId}`, error);
    }
  }
}
