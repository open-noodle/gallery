import {
  versionCapturedAt,
  versionPopupBox,
  versionTime,
  versionZoneLabel,
} from '#lib/gallery/versions/asset-versions.ts';
import { AssetVersionKind } from '@immich/sdk';
import { DateTime, FixedOffsetZone } from 'luxon';

vi.mock('#lib/managers/auth-manager.svelte.ts', () => ({ authManager: { params: {} } }));

// The info panel is 360 px wide and sits at the right edge of the window.
const PANEL_WIDTH = 360;
const panelIn = (windowWidth: number) => ({ left: windowWidth - PANEL_WIDTH, right: windowWidth });
const fullHd = { width: 1920, height: 1080 };
const thumbnail = { top: 500, height: 80 };
const landscape = { width: 3, height: 2 };
const portrait = { width: 2, height: 3 };

describe('versionPopupBox', () => {
  it('puts the picture left of the panel, 700 px wide and level with the thumbnail', () => {
    expect(versionPopupBox(thumbnail, panelIn(1920), landscape, fullHd)).toEqual({
      // 12 px off the panel's edge at 1560
      left: 848,
      width: 700,
      height: 467,
      // centred on the thumbnail's middle at 540
      top: 307,
    });
  });

  it('makes the picture smaller in a narrower window', () => {
    const widthIn = (windowWidth: number) =>
      versionPopupBox(thumbnail, panelIn(windowWidth), landscape, { width: windowWidth, height: 1080 })?.width;

    expect(widthIn(1084)).toBe(700);
    expect(widthIn(900)).toBe(516);
    expect(widthIn(700)).toBe(316);
    expect(versionPopupBox(thumbnail, panelIn(900), landscape, { width: 900, height: 1080 })).toMatchObject({
      left: 12,
      height: 344,
    });
  });

  it('shows no picture when less than 200 px is free beside the panel', () => {
    const boxIn = (windowWidth: number) =>
      versionPopupBox(thumbnail, panelIn(windowWidth), landscape, { width: windowWidth, height: 1080 });

    expect(boxIn(584)?.width).toBe(200);
    expect(boxIn(583)).toBeUndefined();
    // a phone: the panel fills the window
    expect(boxIn(360)).toBeUndefined();
  });

  it('fits a tall picture into the height of the window', () => {
    expect(versionPopupBox(thumbnail, panelIn(1920), portrait, { width: 1920, height: 900 })).toEqual({
      left: 964,
      width: 584,
      height: 876,
      top: 12,
    });
    // so low a window that the fitted picture is under 200 px wide
    expect(versionPopupBox(thumbnail, panelIn(1920), portrait, { width: 1920, height: 300 })).toBeUndefined();
  });

  it('keeps the picture inside the window for the first and the last thumbnail of a long list', () => {
    expect(versionPopupBox({ top: 0, height: 80 }, panelIn(1920), landscape, fullHd)?.top).toBe(12);
    // 1080 - 467 - 12
    expect(versionPopupBox({ top: 1040, height: 80 }, panelIn(1920), landscape, fullHd)?.top).toBe(601);
  });

  it('puts the picture right of the panel when the panel is on the left, as in a right-to-left language', () => {
    expect(versionPopupBox(thumbnail, { left: 0, right: PANEL_WIDTH }, landscape, fullHd)).toEqual({
      left: 372,
      width: 700,
      height: 467,
      top: 307,
    });
  });
});

describe('versionCapturedAt', () => {
  // the camera's clock is four hours behind UTC, as the photo's two times say
  const photo = { fileCreatedAt: '2026-11-01T19:47:34.000Z', localDateTime: '2026-11-01T15:47:34.000Z' };

  it("gives a version's time on the camera's clock, as the info panel shows the photo's", () => {
    const taken = versionCapturedAt({ fileCreatedAt: '2026-11-01T19:47:35.120Z' }, photo);
    expect(taken?.toFormat('yyyy-MM-dd HH:mm:ss')).toBe('2026-11-01 15:47:35');
  });

  it('keeps the date right across midnight', () => {
    const late = { fileCreatedAt: '2026-11-02T02:30:00.000Z', localDateTime: '2026-11-01T22:30:00.000Z' };
    expect(versionCapturedAt(late, late)?.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-11-01 22:30');
  });

  it('gives nothing for a time that cannot be read', () => {
    expect(versionCapturedAt({ fileCreatedAt: 'not a date' }, photo)).toBeUndefined();
  });
});

describe('versionTime', () => {
  const photo = { fileCreatedAt: '2026-11-01T19:47:34.000Z', localDateTime: '2026-11-01T15:47:34.000Z' };
  const file = { fileCreatedAt: '2026-11-01T19:47:34.000Z', fileModifiedAt: '2026-11-02T14:40:25.000Z' };

  it("shows an edit by when it was made, in the viewer's own time zone", () => {
    const time = versionTime({ ...file, kind: AssetVersionKind.Edit }, photo);
    expect(time?.toUTC().toISO()).toBe('2026-11-02T14:40:25.000Z');
    expect(time?.zoneName).toBe(DateTime.local().zoneName);
  });

  it("shows the camera's own file and the RAW by when they were taken, on the camera's clock", () => {
    for (const kind of [AssetVersionKind.Original, AssetVersionKind.Raw]) {
      expect(versionTime({ ...file, kind }, photo)?.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-11-01 15:47');
    }
  });

  it('falls back to when the photo was taken for an edit whose written time is missing or unreadable', () => {
    for (const fileModifiedAt of [undefined, 'not a date']) {
      const time = versionTime(
        { fileCreatedAt: file.fileCreatedAt, fileModifiedAt, kind: AssetVersionKind.Edit },
        photo,
      );
      expect(time?.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-11-01 15:47');
    }
  });
});

describe('versionZoneLabel', () => {
  const cameraClock = (minutes: number) =>
    DateTime.fromISO('2026-11-01T19:47:34.000Z', { zone: FixedOffsetZone.instance(minutes) });

  it("writes the camera's zone in its short form", () => {
    expect(versionZoneLabel(cameraClock(-240), true)).toBe('GMT-4');
    expect(versionZoneLabel(cameraClock(60), true)).toBe('GMT+1');
    expect(versionZoneLabel(cameraClock(330), true)).toBe('GMT+5:30');
    expect(versionZoneLabel(cameraClock(-210), true)).toBe('GMT-3:30');
    expect(versionZoneLabel(cameraClock(0), true)).toBe('GMT');
  });

  it("writes none for a time on the camera's clock when the photo records no zone", () => {
    expect(versionZoneLabel(cameraClock(0), false)).toBeUndefined();
    expect(versionZoneLabel(cameraClock(-240), false)).toBeUndefined();
  });

  it("always writes the viewer's own zone, which an edit's time is in", () => {
    expect(versionZoneLabel(DateTime.fromISO('2026-11-02T14:40:25.000Z'), false)).toMatch(
      /^GMT([+-]\d{1,2}(:\d\d)?)?$/,
    );
  });

  it("gives a camera file's time the photo's distance from UTC", () => {
    const photo = { fileCreatedAt: '2026-11-01T19:47:34.000Z', localDateTime: '2026-11-01T15:47:34.000Z' };
    const taken = versionCapturedAt({ fileCreatedAt: '2026-11-01T19:47:35.000Z' }, photo)!;
    expect(taken.offset).toBe(-240);
    expect(versionZoneLabel(taken, true)).toBe('GMT-4');
  });
});
