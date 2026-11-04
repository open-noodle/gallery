import { BadRequestException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { Permission } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { checkAccess } from 'src/utils/access.js';

/**
 * Upstream's TagRead check on the timeline's `tagId` (the tag page), widened to every tag the tag explorer lists
 * (TagRepository.getAll): the caller's own tags and tags on assets shared with them through a space. The widening
 * stays here rather than in galleryAccessGrants, because a global TagRead grant would let TagService.create parent
 * a tag under another user's tag. The filter panel's `tagIds` are not checked: they carry partner and album tags,
 * and the bucket query confines them to assets the caller can see.
 */
export const requireTimelineTagAccess = async (access: AccessRepository, auth: AuthDto, tagId: string) => {
  const ids = new Set([tagId]);
  const owned = await checkAccess(access, { auth, permission: Permission.TagRead, ids });
  if (owned.has(tagId)) {
    return;
  }
  const viaSpace = auth.sharedLink ? new Set<string>() : await access.sharedSpace.checkTagAccess(auth.user.id, ids);
  if (viaSpace.has(tagId)) {
    return;
  }
  throw new BadRequestException(`Not found or no ${Permission.TagRead} access`);
};
