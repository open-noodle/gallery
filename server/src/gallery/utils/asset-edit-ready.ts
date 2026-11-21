import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Permission } from 'src/enum.js';
import type { IAssetEditJob } from 'src/gallery/types.js';
import type { AccessRepository } from 'src/repositories/access.repository.js';
import type { AssetRepository } from 'src/repositories/asset.repository.js';
import type { UserRepository } from 'src/repositories/user.repository.js';
import type { ClientEventMap, WebsocketRepository } from 'src/repositories/websocket.repository.js';
import { checkAccess } from 'src/utils/access.js';

export const assetEditJobData = async (
  access: { asset: Pick<AccessRepository['asset'], 'checkOwnerAccess'> },
  auth: AuthDto,
  id: string,
): Promise<IAssetEditJob> => {
  if (auth.sharedLink) {
    return { id };
  }
  const owned = await access.asset.checkOwnerAccess(auth.user.id, new Set([id]), auth.session?.hasElevatedPermission);
  return owned.has(id) ? { id } : { id, initiatorId: auth.user.id };
};

type Dependencies = {
  access: AccessRepository;
  asset: AssetRepository;
  user: UserRepository;
  websocket: WebsocketRepository;
};

/** Keep the owner's event, then notify only the initiating Gallery user if they can still read the asset. */
export const sendAssetEditReady = async (
  deps: Dependencies,
  job: IAssetEditJob,
  data: ClientEventMap['AssetEditReadyV2'][0],
): Promise<void> => {
  deps.websocket.clientSend('AssetEditReadyV2', data.asset.ownerId, data);
  if (!job.initiatorId || job.initiatorId === data.asset.ownerId) {
    return;
  }

  const user = await deps.user.get(job.initiatorId, {});
  if (!user) {
    return;
  }
  const allowed = await checkAccess(deps.access, {
    auth: { user },
    permission: Permission.AssetRead,
    ids: [data.asset.id],
  });
  if (!allowed.has(data.asset.id)) {
    return;
  }

  // Reuse the viewer projection, including their own favorite and a trimmed video's duration.
  const [asset] = await deps.asset.getByIds([data.asset.id], user.id);
  if (!asset) {
    return;
  }
  deps.websocket.clientSendByClient('AssetEditReadyV2', user.id, [
    {
      ...data,
      asset: { ...data.asset, isFavorite: !!asset.isFavoriteForUser, duration: asset.duration },
    },
  ]);
};
