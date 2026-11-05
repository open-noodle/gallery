import { getAlbumStack, getAssetInfo, type AssetResponseDto, type StackResponseDto } from '@immich/sdk';
import { page } from '$app/state';
import { albumStackPreferences } from '$lib/gallery/stack/album-stack-preferences.svelte';

/**
 * The album the asset viewer is open in. The album page hands the viewer its album; the space album page does not
 * (that would turn on album activity and cover actions there), so its route's `albumId` stands in.
 */
export const viewerAlbumId = (album?: { id: string }): string | undefined => album?.id ?? page.params.albumId;

/**
 * The ids the stack strip may show, when the "only this album's photos" setting is on inside an album; otherwise
 * `undefined`, the whole stack. A failed lookup also shows the whole stack.
 */
export const loadAlbumStackStripIds = async (stackId: string, albumId: string | undefined) => {
  if (!albumId || !albumStackPreferences.stripInAlbum) {
    return;
  }
  try {
    const { assets } = await getAlbumStack({ id: albumId, stackId });
    return new Set(assets.map(({ id }) => id));
  } catch {
    return;
  }
};

/**
 * The photo that stands for `asset`'s stack in the album once `asset` has left it (remove from album in the viewer): the
 * server's pick among the stack-mates the album still holds, the primary first, then the earliest. The viewer moves
 * there rather than to the album's next photo. `undefined` when `asset` has no stack, the album holds no other member,
 * or a lookup fails (the stack is another user's).
 */
export const albumStackSuccessor = async (albumId: string, asset: AssetResponseDto) => {
  try {
    // A photo picked in the stack strip comes from `GET /stacks/{id}`, whose assets carry no `stack`.
    const { stack } = asset.stack ? asset : await getAssetInfo({ id: asset.id });
    if (!stack) {
      return;
    }
    const { assets, primaryAssetId } = await getAlbumStack({ id: albumId, stackId: stack.id });
    const rest = assets.filter(({ id }) => id !== asset.id);
    return (
      rest.find(({ id }) => id === primaryAssetId) ??
      [...rest].sort((a, b) => a.fileCreatedAt.localeCompare(b.fileCreatedAt) || a.id.localeCompare(b.id))[0]
    );
  } catch {
    return;
  }
};

/**
 * What the viewer's stack strip shows: the stack narrowed to `ids`, or none below two photos. The stack itself stays
 * whole, because the stack actions (unstack, keep this and delete others, …) act on every member.
 */
export const stackStrip = (stack: StackResponseDto | undefined, ids: Set<string> | undefined) => {
  if (!stack || !ids) {
    return stack;
  }
  const assets = stack.assets.filter(({ id }) => ids.has(id));
  return assets.length > 1 ? { ...stack, assets } : undefined;
};
