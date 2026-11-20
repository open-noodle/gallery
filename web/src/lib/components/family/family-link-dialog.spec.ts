import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import type { PersonResponseDto } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent, type Locator } from 'vitest/browser';

// The browser links every static import before any module body runs, so a static import of the
// component or of a value from @immich/sdk would load the real SDK before sdk.mock.ts registers its vi.mock. Loading it after that
// registration gives it the mocked module.
const { FamilyParticipantRole } = await import('@immich/sdk');
const { default: FamilyLinkDialog } = await import('#lib/components/family/FamilyLinkDialog.svelte');

const findOne = async (locator: Locator) => {
  await expect.element(locator).toBeInTheDocument();
  return locator.element() as HTMLElement;
};

const person = (id: string, name: string) =>
  ({ id, name, thumbnailPath: '', isHidden: false }) as unknown as PersonResponseDto;

const ANNA = person('person-anna', 'Anna');
const BEN = person('person-ben', 'Ben');

const renderDialog = (props: { onClose?: (created: boolean) => void } = {}) =>
  render(FamilyLinkDialog, { onClose: props.onClose ?? (() => {}) });

const pickPerson = async (name: string) => {
  const option = await findOne(page.getByRole('button', { name: new RegExp(name) }));
  await userEvent.click(option);
};

describe('FamilyLinkDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getAllPeople.mockResolvedValue({ people: [ANNA, BEN] } as never);
    sdkMock.searchPerson.mockResolvedValue([ANNA, BEN] as never);
    sdkMock.setMyRoot.mockResolvedValue(undefined as never);
    sdkMock.getMyRoot.mockResolvedValue({ rootIdentityId: null, access: 'contribute' } as never);
    sdkMock.createUnion.mockResolvedValue({ id: 'union-1' } as never);
  });

  // The whole reason step one exists: without a root nobody's labels read "your aunt", they read
  // a bare name, and there is no other UI anywhere that nominates you.
  it('asks who you are first when no root is set, and records it', async () => {
    await renderDialog();

    expect(await findOne(page.getByTestId('family-link-step-self'))).toBeInTheDocument();
    await pickPerson('Anna');

    await vi.waitFor(() =>
      expect(sdkMock.setMyRoot).toHaveBeenCalledWith({ familyMyRootUpdateDto: { personId: ANNA.id } }),
    );
  });

  it('skips the identity step when a root is already set', async () => {
    sdkMock.getMyRoot.mockResolvedValue({ rootIdentityId: 'identity-anna', access: 'contribute' } as never);
    await renderDialog();

    expect(await findOne(page.getByTestId('family-link-step-first'))).toBeInTheDocument();
    expect(page.getByTestId('family-link-step-self').query()).not.toBeInTheDocument();
    expect(sdkMock.setMyRoot).not.toHaveBeenCalled();
  });

  it('creates a partner union from two person ids', async () => {
    sdkMock.getMyRoot.mockResolvedValue({ rootIdentityId: 'identity-anna', access: 'contribute' } as never);
    await renderDialog();

    await pickPerson('Anna');
    await pickPerson('Ben');
    await userEvent.click(await findOne(page.getByTestId(`family-link-relation-${FamilyParticipantRole.Partner}`)));
    await userEvent.click(page.getByTestId('family-link-create').element());

    await vi.waitFor(() =>
      expect(sdkMock.createUnion).toHaveBeenCalledWith({
        familyUnionCreateDto: { partnerPersonIds: [ANNA.id, BEN.id] },
      }),
    );
  });

  // Direction is the easy thing to get backwards, so it is asserted explicitly in both
  // directions rather than once: "Ben is Anna's child" and "Ben is Anna's parent" must not
  // produce the same union.
  it("records the second person as the first's child", async () => {
    sdkMock.getMyRoot.mockResolvedValue({ rootIdentityId: 'identity-anna', access: 'contribute' } as never);
    await renderDialog();

    await pickPerson('Anna');
    await pickPerson('Ben');
    await userEvent.click(await findOne(page.getByTestId('family-link-relation-child')));
    await userEvent.click(page.getByTestId('family-link-create').element());

    await vi.waitFor(() =>
      expect(sdkMock.createUnion).toHaveBeenCalledWith({
        familyUnionCreateDto: { partnerPersonIds: [ANNA.id], childPersonIds: [BEN.id] },
      }),
    );
  });

  it("records the second person as the first's parent", async () => {
    sdkMock.getMyRoot.mockResolvedValue({ rootIdentityId: 'identity-anna', access: 'contribute' } as never);
    await renderDialog();

    await pickPerson('Anna');
    await pickPerson('Ben');
    await userEvent.click(await findOne(page.getByTestId('family-link-relation-parent')));
    await userEvent.click(page.getByTestId('family-link-create').element());

    await vi.waitFor(() =>
      expect(sdkMock.createUnion).toHaveBeenCalledWith({
        familyUnionCreateDto: { partnerPersonIds: [BEN.id], childPersonIds: [ANNA.id] },
      }),
    );
  });

  it('surfaces a failure instead of closing as if it had worked', async () => {
    const onClose = vi.fn();
    sdkMock.createUnion.mockRejectedValue(new Error('400'));
    await renderDialog({ onClose });

    await pickPerson('Anna');
    await pickPerson('Ben');
    await userEvent.click(await findOne(page.getByTestId(`family-link-relation-${FamilyParticipantRole.Partner}`)));
    await userEvent.click(page.getByTestId('family-link-create').element());

    expect(await findOne(page.getByTestId('family-link-error'))).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
