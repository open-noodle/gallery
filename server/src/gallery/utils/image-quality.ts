import sharp from 'sharp';

/**
Library Cleanup: an image's pixels flattened onto black and reduced to one grey byte each, with the long edge
shrunk to at most `size`, for sharpness and exposure scoring. Sharp's process-wide settings (concurrency, cache)
are the ones MediaRepository sets up.
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

/**
Person covers: one face cut from `input` and reduced to `size` × `size` grey bytes, flattened onto black, for
sharpness and exposure scoring. The box is in the coordinates of the `source` image face detection stored, and is
scaled to the decoded image as the face thumbnail crop is.
*/
export const readFaceGreyscalePixels = async (
  input: string,
  box: { x1: number; y1: number; x2: number; y2: number },
  source: { width: number; height: number },
  size: number,
): Promise<Buffer> => {
  const image = sharp(input, { failOn: 'error', autoOrient: true });
  const { autoOrient } = await image.metadata();
  const { width, height } = autoOrient;
  const scaleX = width / source.width;
  const scaleY = height / source.height;
  const left = Math.min(Math.max(Math.floor(box.x1 * scaleX), 0), width - 1);
  const top = Math.min(Math.max(Math.floor(box.y1 * scaleY), 0), height - 1);
  const right = Math.min(Math.max(Math.ceil(box.x2 * scaleX), left + 1), width);
  const bottom = Math.min(Math.max(Math.ceil(box.y2 * scaleY), top + 1), height);
  return image
    .extract({ left, top, width: right - left, height: bottom - top })
    .flatten({ background: '#000000' })
    .greyscale()
    .resize(size, size, { fit: 'fill' })
    .raw()
    .toBuffer();
};
