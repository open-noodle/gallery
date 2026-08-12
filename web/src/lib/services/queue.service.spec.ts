import { JobName } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import { formatSampledJobTypeCount, getQueueJobTypeLabel } from '$lib/services/queue.service';

describe('queue service', () => {
  it('labels shared-space face matching jobs separately from facial recognition', () => {
    expect(getQueueJobTypeLabel(JobName.SharedSpaceFaceMatchPage)).toBe('Shared space face matching');
    expect(getQueueJobTypeLabel(JobName.SharedSpacePersonDedup)).toBe('Shared space people dedup');
    expect(getQueueJobTypeLabel(JobName.FacialRecognition)).toBe('Facial recognition');
  });

  it('labels face suggestion maintenance jobs by scope', () => {
    expect(getQueueJobTypeLabel(JobName.FaceSuggestionMaintenance)).toBe('Face suggestion maintenance');
    expect(getQueueJobTypeLabel(JobName.PersonSuggestionScanQueueAll)).toBe('Personal face suggestion scan');
    expect(getQueueJobTypeLabel(JobName.PersonSuggestionScan)).toBe('Personal face suggestion scan');
    expect(getQueueJobTypeLabel(JobName.SpacePersonSuggestionScanQueueAll)).toBe('Shared-space face suggestion scan');
    expect(getQueueJobTypeLabel(JobName.SpacePersonSuggestionScan)).toBe('Shared-space face suggestion scan');
  });

  it('formats sampled job type counts as capped values above the sampling limit', () => {
    const formatNumber = (count: number) => count.toLocaleString('de-DE');

    expect(formatSampledJobTypeCount(999, formatNumber)).toBe('999');
    expect(formatSampledJobTypeCount(1000, formatNumber)).toBe('1.000');
    expect(formatSampledJobTypeCount(1001, formatNumber)).toBe('1.000+');
  });
});
