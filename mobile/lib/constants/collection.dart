/// Maximum asset ids accepted by `POST /shared-spaces/{id}/assets` in one request.
///
/// Mirrors `SharedSpaceAssetAddSchema` (`server/src/dtos/shared-space.dto.ts`) and
/// web's `MAX_SPACE_ASSETS_PER_REQUEST`. Inclusive: 50000 is allowed, 50001 is not.
const int kMaxSpaceAssetsPerRequest = 50000;
