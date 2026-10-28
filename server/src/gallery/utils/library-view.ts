import { BadRequestException } from '@nestjs/common';
import type { SelectQueryBuilder } from 'kysely';
import type { ViewerSurface } from 'src/utils/viewer-scope.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { LibraryView } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { sharedWithViewer, spaceAssetPathBranches } from 'src/utils/shared-space-album-scope.js';

export type LibraryViewOptions = { libraryView?: LibraryView };

/** #1038: the view narrows the caller's own photos: on the timeline, their own `userId` (album and space pages send none). */
export const checkLibraryView = (
  auth: AuthDto,
  surface: ViewerSurface,
  request: LibraryViewOptions & { userId?: string; withSharedSpaces?: boolean },
) => {
  if (!request.libraryView) {
    return;
  }
  if (auth.sharedLink || (surface === 'timeline' && request.userId !== auth.user.id)) {
    throw new BadRequestException('libraryView only applies to your own photos');
  }
  if (request.libraryView === LibraryView.Spaces && !request.withSharedSpaces) {
    throw new BadRequestException('libraryView=spaces requires withSharedSpaces');
  }
};

/**
 * #1038: `personal` keeps the caller's photos that reach none of their spaces, by any path; `spaces` keeps what reaches
 * them through a space on their timeline, their own photos included.
 */
export const withLibraryView = <O>(
  qb: SelectQueryBuilder<DB, 'asset', O>,
  options: LibraryViewOptions & { callerId?: string; timelineSpaceIds?: string[] },
) => {
  const { libraryView, callerId, timelineSpaceIds } = options;
  if (!libraryView) {
    return qb;
  }
  if (!callerId) {
    throw new Error('libraryView needs the caller');
  }

  if (libraryView === LibraryView.Spaces) {
    return qb.where((eb) =>
      sharedWithViewer(eb, {
        scope: { spaceIds: timelineSpaceIds ?? [] },
        albumTimelineGate: 'personal',
        viewerId: callerId,
      }),
    );
  }

  return qb.where('asset.ownerId', '=', callerId).where((eb) =>
    eb.not(
      eb.or(
        spaceAssetPathBranches(eb, {
          correlateAssetId: 'asset.id',
          correlateLibraryId: 'asset.libraryId',
          scope: { memberUserId: callerId },
          albumTimelineGate: 'none',
        }),
      ),
    ),
  );
};
