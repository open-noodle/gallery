import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import type { AlbumResponseDto } from '@immich/sdk';
import { Settings } from 'luxon';
import { tick } from 'svelte';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

// The modal saves through upstream's updateAlbumInfoMutation (immich-32668): assert on the SDK call.
const updateAlbumInfoMock = sdkMock.updateAlbumInfo;

const originalZone = Settings.defaultZone;

// Loaded after the sdk mock above: in browser mode a static import would link the modal's
// query module to the real SDK before the mock is registered.
let AlbumEditModal: typeof import('./AlbumEditModal.svelte').default;
beforeAll(async () => {
  const module = await import('./AlbumEditModal.svelte');
  AlbumEditModal = module.default;
});

// eslint-disable-next-line unicorn/no-unnecessary-parameters
const album = (o: Partial<AlbumResponseDto> = {}): AlbumResponseDto =>
  ({
    id: 'a1',
    albumName: 'Summer',
    description: 'Trip',
    createdAt: '1996-06-15T12:30:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    albumUsers: [],
    ...o,
  }) as never;

const createdAtInput = () => page.getByTestId('album-edit-created-at').element() as HTMLInputElement;
const saveButton = () => page.getByRole('button', { name: 'Save' });

// `userEvent.type` is unreliable against `datetime-local`, which browsers treat as
// segmented rather than free text. Set the whole value at once and fire the
// input+change pair a user edit produces.
const setDate = async (value: string) => {
  const input = createdAtInput();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
};

beforeEach(() => {
  // 1996-06-15T12:30Z is 14:30 in Berlin summer time (+02:00). Pinning the zone here
  // rather than via TZ makes the local <-> UTC conversion observable under the
  // config's TZ: 'UTC'.
  Settings.defaultZone = 'Europe/Berlin';
  updateAlbumInfoMock.mockReset();
  updateAlbumInfoMock.mockResolvedValue({ id: 'a1' } as never);
});

afterAll(() => {
  Settings.defaultZone = originalZone;
});

describe('AlbumEditModal', () => {
  // Regression: the date input was wrapped in `Field`, which publishes its label on context
  // for `@immich/ui` inputs to render. `DateInput` is a plain element and ignores that
  // context, so the input shipped with no visible label and no accessible name — nothing in
  // this file caught it, because every other assertion reaches the input by test id.
  // getByLabelText resolves through the `for`/`id` association, so it fails if either goes.
  it('labels the created date input', async () => {
    await render(AlbumEditModal, { props: { album: album(), onClose: vi.fn() } });

    expect(page.getByLabelText('date_created').element()).toBe(createdAtInput());
  });

  it('pre-fills the created date in local time', async () => {
    await render(AlbumEditModal, { props: { album: album(), onClose: vi.fn() } });

    // `datetime-local` inputs normalize their value string per the WHATWG "valid normalized
    // local date and time string" algorithm: the seconds component is dropped when it (and any
    // fractional part) is zero. 1996-06-15T12:30:00.000Z is exactly 14:30:00.000 in Berlin summer
    // time, so seconds/ms are both zero here and the browser renders "14:30" rather than "14:30:00.000". This is a display-string quirk, not a timezone
    // bug — the historical-offset assertion below is the real proof of correct zone handling.
    expect(createdAtInput().value).toBe('1996-06-15T14:30');
  });

  it('submits the edited date as an ISO string with the historical offset', async () => {
    const onClose = vi.fn();
    await render(AlbumEditModal, { props: { album: album(), onClose } });

    await setDate('1996-06-15T09:00:00.000');
    await userEvent.click(saveButton());

    await vi.waitFor(() => expect(updateAlbumInfoMock).toHaveBeenCalled());
    const [{ updateAlbumDto: dto }] = updateAlbumInfoMock.mock.calls[0];
    expect(dto.createdAt).toBe('1996-06-15T09:00:00.000+02:00');
    expect(onClose).toHaveBeenCalled();
  });

  it('omits the created date when it was not touched', async () => {
    await render(AlbumEditModal, { props: { album: album(), onClose: vi.fn() } });

    await userEvent.click(saveButton());

    await vi.waitFor(() => expect(updateAlbumInfoMock).toHaveBeenCalled());
    const [{ updateAlbumDto: dto }] = updateAlbumInfoMock.mock.calls[0];
    expect(dto).not.toHaveProperty('createdAt');
    expect(dto.albumName).toBe('Summer');
  });

  it('omits the created date when the input is cleared, and still saves the name', async () => {
    await render(AlbumEditModal, { props: { album: album(), onClose: vi.fn() } });

    await setDate('');
    await userEvent.click(saveButton());

    await vi.waitFor(() => expect(updateAlbumInfoMock).toHaveBeenCalled());
    const [{ updateAlbumDto: dto }] = updateAlbumInfoMock.mock.calls[0];
    expect(dto).not.toHaveProperty('createdAt');
    expect(dto.albumName).toBe('Summer');
  });
});
