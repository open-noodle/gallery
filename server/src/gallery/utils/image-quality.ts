import sharp from 'sharp';

/**
 * Library Cleanup: an image's pixels flattened onto black and reduced to one grey byte each, with the long edge
 * shrunk to at most `size`, for sharpness and exposure scoring. Sharp's process-wide settings (concurrency, cache)
 * are the ones MediaRepository sets up.
 */
export const readGreyscalePixels = async (
  input: string,
  size: number,
): Promise<{ data: Buffer; width: number; height: number }> => {
  const { data, info } = await sharp(input, { failOn: 'error' })
    .flatten({ background: '#000000' })
    .greyscale()
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};
