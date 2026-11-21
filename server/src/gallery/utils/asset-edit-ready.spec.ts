import { assetEditJobData } from 'src/gallery/utils/asset-edit-ready.js';
import { JobService } from 'src/services/job.service.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { newTestService } from 'test/utils.js';

describe(assetEditJobData.name, () => {
  it('keeps owner jobs compatible with old workers', async () => {
    const { mocks } = newTestService(JobService);
    const auth = AuthFactory.create();
    const id = newUuid();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([id]));
    await expect(assetEditJobData(mocks.access, auth, id)).resolves.toEqual({ id });
  });

  it('records the authenticated non-owner, never a request-supplied recipient', async () => {
    const { mocks } = newTestService(JobService);
    const auth = AuthFactory.create();
    const id = newUuid();
    await expect(assetEditJobData(mocks.access, auth, id)).resolves.toEqual({ id, initiatorId: auth.user.id });
  });

  it('does not turn shared-link authentication into a user-room subscription', async () => {
    const { mocks } = newTestService(JobService);
    const auth = AuthFactory.from().sharedLink().build();
    const id = newUuid();
    await expect(assetEditJobData(mocks.access, auth, id)).resolves.toEqual({ id });
    expect(mocks.access.asset.checkOwnerAccess).not.toHaveBeenCalled();
  });
});
