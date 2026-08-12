import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import FaceCrop from '$lib/components/faces-page/face-crop.svelte';

const face = {
  assetId: 'asset-1',
  imageWidth: 1000,
  imageHeight: 1000,
  boundingBoxX1: 0,
  boundingBoxX2: 250,
  boundingBoxY1: 0,
  boundingBoxY2: 250,
};

describe('FaceCrop', () => {
  it('renders a labelled image element backed by the asset media URL and crop transform', () => {
    render(FaceCrop, { props: { face, label: 'Suggested face' } });
    const el = screen.getByRole('img', { name: 'Suggested face' });
    const style = el.getAttribute('style') ?? '';
    // getFaceCropTransform with bw=bh=0.25 → 400% / 0% 0%
    expect(style).toContain('background-size: 400% 400%');
    expect(style).toContain('background-position: 0% 0%');
    // asset media URL (NOT a person thumbnail) — assert the asset id is in the url
    expect(style).toContain('asset-1');
    expect(style).toContain('background-image');
  });
});
