import { type AlbumResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { Settings } from 'luxon';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AlbumEditModal from './AlbumEditModal.svelte';

const handleUpdateAlbumMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/services/album.service', () => ({ handleUpdateAlbum: handleUpdateAlbumMock }));

const originalZone = Settings.defaultZone;

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

const createdAtInput = () => screen.getByTestId('album-edit-created-at') as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: 'Save' });

// `userEvent.type` is unreliable against `datetime-local`, which browsers and happy-dom
// treat as segmented rather than free text. Set the whole value at once — the same
// input+change pair AssetChangeDateModal.spec.ts:57-62 uses on this element.
const setDate = async (value: string) => {
  await fireEvent.input(createdAtInput(), { target: { value } });
  await fireEvent.change(createdAtInput(), { target: { value } });
};

beforeEach(() => {
  // 1996-06-15T12:30Z is 14:30 in Berlin summer time (+02:00). Pinning the zone here
  // rather than via TZ makes the local <-> UTC conversion observable under the
  // config's TZ: 'UTC'.
  Settings.defaultZone = 'Europe/Berlin';
  handleUpdateAlbumMock.mockResolvedValue(true);
});

// `FormModal` mounts a bits-ui dialog, which takes a body scroll lock and releases it on a
// 24ms timer rather than synchronously, so that a same-tick destroy/create keeps the lock
// (bits-ui/dist/internal/body-scroll-lock.svelte.js:75). If the file finishes inside that
// window, happy-dom has already torn the environment down when the timer fires and
// `resetBodyStyle` throws `document is not defined`. Vitest reports that as an *unhandled
// error*, not a test failure — so the run exits 1 while every test still passes, which is
// exactly how it surfaced in CI. Unmount and drain the timer before the file ends.
// `cleanup` is idempotent, so testing-library's own afterEach stays a no-op.
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
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
  it('labels the created date input', () => {
    render(AlbumEditModal, { props: { album: album(), onClose: vi.fn() } });

    expect(screen.getByLabelText('date_created')).toBe(createdAtInput());
  });

  it('pre-fills the created date in local time', () => {
    render(AlbumEditModal, { props: { album: album(), onClose: vi.fn() } });

    // `datetime-local` inputs normalize their value string per the WHATWG "valid normalized
    // local date and time string" algorithm: the seconds component is dropped when it (and any
    // fractional part) is zero. 1996-06-15T12:30:00.000Z is exactly 14:30:00.000 in Berlin summer
    // time, so seconds/ms are both zero here and the browser (and happy-dom, spec-compliantly)
    // renders "14:30" rather than "14:30:00.000". This is a display-string quirk, not a timezone
    // bug — the historical-offset assertion below is the real proof of correct zone handling.
    expect(createdAtInput().value).toBe('1996-06-15T14:30');
  });

  it('submits the edited date as an ISO string with the historical offset', async () => {
    const onClose = vi.fn();
    render(AlbumEditModal, { props: { album: album(), onClose } });

    await setDate('1996-06-15T09:00:00.000');
    await userEvent.click(saveButton());

    await waitFor(() => expect(handleUpdateAlbumMock).toHaveBeenCalled());
    const [, dto] = handleUpdateAlbumMock.mock.calls[0];
    expect(dto.createdAt).toBe('1996-06-15T09:00:00.000+02:00');
    expect(onClose).toHaveBeenCalled();
  });

  it('omits the created date when it was not touched', async () => {
    render(AlbumEditModal, { props: { album: album(), onClose: vi.fn() } });

    await userEvent.click(saveButton());

    await waitFor(() => expect(handleUpdateAlbumMock).toHaveBeenCalled());
    const [, dto] = handleUpdateAlbumMock.mock.calls[0];
    expect(dto).not.toHaveProperty('createdAt');
    expect(dto.albumName).toBe('Summer');
  });

  it('omits the created date when the input is cleared, and still saves the name', async () => {
    render(AlbumEditModal, { props: { album: album(), onClose: vi.fn() } });

    await setDate('');
    await userEvent.click(saveButton());

    await waitFor(() => expect(handleUpdateAlbumMock).toHaveBeenCalled());
    const [, dto] = handleUpdateAlbumMock.mock.calls[0];
    expect(dto).not.toHaveProperty('createdAt');
    expect(dto.albumName).toBe('Summer');
  });
});
