import { FamilyParticipantRole, type PersonResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
// Must be imported BEFORE the component below — importing `sdk.mock` is what calls
// `vi.mock('@immich/sdk', ...)`, and that has to register before the component's own static
// imports of `createUnion`/`setMyRoot`/`searchPerson` resolve.
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import FamilyLinkDialog from '$lib/components/family/FamilyLinkDialog.svelte';

const person = (id: string, name: string) =>
  ({ id, name, thumbnailPath: '', isHidden: false }) as unknown as PersonResponseDto;

const ANNA = person('person-anna', 'Anna');
const BEN = person('person-ben', 'Ben');

const renderDialog = (props: { onClose?: (created: boolean) => void } = {}) =>
  render(FamilyLinkDialog, { onClose: props.onClose ?? (() => {}) });

const pickPerson = async (name: string) => {
  const option = await screen.findByRole('button', { name: new RegExp(name) });
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
    renderDialog();

    expect(await screen.findByTestId('family-link-step-self')).toBeInTheDocument();
    await pickPerson('Anna');

    await waitFor(() =>
      expect(sdkMock.setMyRoot).toHaveBeenCalledWith({ familyMyRootUpdateDto: { personId: ANNA.id } }),
    );
  });

  it('skips the identity step when a root is already set', async () => {
    sdkMock.getMyRoot.mockResolvedValue({ rootIdentityId: 'identity-anna', access: 'contribute' } as never);
    renderDialog();

    expect(await screen.findByTestId('family-link-step-first')).toBeInTheDocument();
    expect(screen.queryByTestId('family-link-step-self')).not.toBeInTheDocument();
    expect(sdkMock.setMyRoot).not.toHaveBeenCalled();
  });

  it('creates a partner union from two person ids', async () => {
    sdkMock.getMyRoot.mockResolvedValue({ rootIdentityId: 'identity-anna', access: 'contribute' } as never);
    renderDialog();

    await pickPerson('Anna');
    await pickPerson('Ben');
    await userEvent.click(await screen.findByTestId(`family-link-relation-${FamilyParticipantRole.Partner}`));
    await userEvent.click(screen.getByTestId('family-link-create'));

    await waitFor(() =>
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
    renderDialog();

    await pickPerson('Anna');
    await pickPerson('Ben');
    await userEvent.click(await screen.findByTestId('family-link-relation-child'));
    await userEvent.click(screen.getByTestId('family-link-create'));

    await waitFor(() =>
      expect(sdkMock.createUnion).toHaveBeenCalledWith({
        familyUnionCreateDto: { partnerPersonIds: [ANNA.id], childPersonIds: [BEN.id] },
      }),
    );
  });

  it("records the second person as the first's parent", async () => {
    sdkMock.getMyRoot.mockResolvedValue({ rootIdentityId: 'identity-anna', access: 'contribute' } as never);
    renderDialog();

    await pickPerson('Anna');
    await pickPerson('Ben');
    await userEvent.click(await screen.findByTestId('family-link-relation-parent'));
    await userEvent.click(screen.getByTestId('family-link-create'));

    await waitFor(() =>
      expect(sdkMock.createUnion).toHaveBeenCalledWith({
        familyUnionCreateDto: { partnerPersonIds: [BEN.id], childPersonIds: [ANNA.id] },
      }),
    );
  });

  it('surfaces a failure instead of closing as if it had worked', async () => {
    const onClose = vi.fn();
    sdkMock.createUnion.mockRejectedValue(new Error('400'));
    renderDialog({ onClose });

    await pickPerson('Anna');
    await pickPerson('Ben');
    await userEvent.click(await screen.findByTestId(`family-link-relation-${FamilyParticipantRole.Partner}`));
    await userEvent.click(screen.getByTestId('family-link-create'));

    expect(await screen.findByTestId('family-link-error')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
