/** The red channel of an RGBA image of the depth map: the map is greyscale, 255 = nearest. */
export const depthFromRgba = (rgba: Uint8ClampedArray) => {
  const depth = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < depth.length; i++) {
    depth[i] = rgba[i * 4];
  }
  return depth;
};

/**
 * The still plane: the mean depth of the foreground, split from the background with Otsu's threshold, as the server
 * computes it. Keeping the subject still and moving the background behind it is the Apple look, and it moves the
 * stretching at the subject's edges into the background, where it is least visible. 0..1.
 */
export const subjectDepth = (depth: Uint8Array) => {
  const histogram = new Float64Array(256);
  for (const value of depth) {
    histogram[value]++;
  }
  const total = depth.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i];
  }

  let best = 0;
  let threshold = 127;
  let backgroundCount = 0;
  let backgroundSum = 0;
  for (let i = 0; i < 256; i++) {
    backgroundCount += histogram[i];
    backgroundSum += i * histogram[i];
    const foregroundCount = total - backgroundCount;
    if (backgroundCount === 0 || foregroundCount === 0) {
      continue;
    }
    const gap = backgroundSum / backgroundCount - (sum - backgroundSum) / foregroundCount;
    const between = backgroundCount * foregroundCount * gap * gap;
    if (between <= best) {
      continue;
    }
    best = between;
    threshold = i;
  }

  let count = 0;
  let foreground = 0;
  for (let i = threshold + 1; i < 256; i++) {
    count += histogram[i];
    foreground += i * histogram[i];
  }
  return count > 0 ? foreground / count / 255 : sum / total / 255;
};

/**
 * Separable max filter: near (bright) edges grow outwards by `radius` pixels, so the shader never samples a sliver of
 * the subject at a background depth and smears it across the background.
 */
export const dilate = (depth: Uint8Array, width: number, height: number, radius: number) => {
  if (radius <= 0) {
    return depth;
  }
  const rows = new Uint8Array(depth.length);
  const out = new Uint8Array(depth.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let max = 0;
      for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius); k++) {
        max = Math.max(max, depth[row + k]);
      }
      rows[row + x] = max;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let max = 0;
      for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius); k++) {
        max = Math.max(max, rows[k * width + x]);
      }
      out[y * width + x] = max;
    }
  }
  return out;
};

/** Fit a `width`×`height` image inside a box, keeping its aspect. */
export const contain = (width: number, height: number, boxWidth: number, boxHeight: number) => {
  const scale = Math.min(boxWidth / width, boxHeight / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

/**
 * A damped spring stepped by `dt` seconds, so the scene eases after the pointer instead of jumping to it. Slightly
 * underdamped, which reads as a physical object.
 */
export const stepSpring = (
  state: { position: number; velocity: number },
  target: number,
  dt: number,
  stiffness = 60,
  dampingRatio = 0.9,
) => {
  const damping = 2 * Math.sqrt(stiffness) * dampingRatio;
  state.velocity += ((target - state.position) * stiffness - state.velocity * damping) * dt;
  state.position += state.velocity * dt;
};
