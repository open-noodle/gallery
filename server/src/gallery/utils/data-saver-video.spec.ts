import { VideoCodec } from 'src/enum.js';
import type { DataSaverVideoConfig } from 'src/gallery/dtos/data-saver-video.dto.js';
import { dataSaverSettings, isDataSaverCopyNeeded, parseBitrate } from 'src/gallery/utils/data-saver-video.js';

const config: DataSaverVideoConfig = {
  enabled: true,
  targetVideoCodec: VideoCodec.Hevc,
  targetResolution: '720',
  maxBitrate: '1500k',
};

describe('dataSaverSettings', () => {
  it('names what a copy was made with, ignoring the unit case', () => {
    expect(dataSaverSettings({ ...config, maxBitrate: '1500K' })).toBe('hevc:720:1500k');
  });
});

describe('parseBitrate', () => {
  it.each([
    ['1500k', 1_500_000],
    ['2M', 2_000_000],
    ['800000', 800_000],
    ['fast', 0],
  ])('reads %s as %d bit/s', (bitrate, expected) => {
    expect(parseBitrate(bitrate)).toBe(expected);
  });
});

describe('isDataSaverCopyNeeded', () => {
  it('needs a copy of a video larger than the target', () => {
    expect(isDataSaverCopyNeeded(config, { width: 1920, height: 1080, bitrate: 1_000_000 })).toBe(true);
  });

  it('needs a copy of a small video over the cap and its headroom', () => {
    expect(isDataSaverCopyNeeded(config, { width: 1280, height: 720, bitrate: 1_900_000 })).toBe(true);
  });

  it('needs no copy of a small video within the headroom', () => {
    expect(isDataSaverCopyNeeded(config, { width: 1280, height: 720, bitrate: 1_875_000 })).toBe(false);
  });

  it('measures the short side, so a portrait video is judged like a landscape one', () => {
    expect(isDataSaverCopyNeeded(config, { width: 720, height: 1280, bitrate: 1_000_000 })).toBe(false);
  });

  it('falls back to the container bitrate, and treats an unknown one as too high', () => {
    expect(isDataSaverCopyNeeded(config, { width: 640, height: 360, bitrate: 0 }, { bitrate: 900_000 })).toBe(false);
    expect(isDataSaverCopyNeeded(config, { width: 640, height: 360, bitrate: 0 })).toBe(true);
  });
});
