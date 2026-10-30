<script lang="ts">
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';
  import { prefersReducedMotion } from '$lib/gallery/motion/tokens';
  import { contain, depthFromRgba, dilate, stepSpring, subjectDepth } from '$lib/gallery/spatial/depth';
  import { getDepthMapUrl, spatialSceneState } from '$lib/gallery/spatial/spatial-scene.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, type AssetResponseDto } from '@immich/sdk';
  import { toastManager } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  // Spatial Scene (specs/2026-10-29-spatial-scene-design.md, "Web viewer"): the preview and its depth map drawn by one
  // WebGL2 shader. Each output pixel marches from the nearest depth back and takes the first surface its ray meets, so
  // the subject covers the background as the view moves (screen-space parallax occlusion mapping).

  type Props = { asset: AssetResponseDto };
  let { asset }: Props = $props();

  /** Largest shift, as a share of the image: small enough that the stretched background stays hard to notice. */
  const AMPLITUDE = 0.03;
  /** Pixels the near edges grow by before upload (see `dilate`). */
  const DILATE = 3;
  /** Seconds without input before the scene starts swaying on its own. */
  const IDLE_AFTER = 2.5;
  /** Degrees of device tilt that reach the edge of the movement. */
  const TILT_RANGE = 20;

  const VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = vec2(aPosition.x * 0.5 + 0.5, 0.5 - aPosition.y * 0.5);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

  const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 color;
uniform sampler2D uImage;
uniform sampler2D uDepth;
uniform vec2 uOffset;
uniform float uFocus;
uniform float uZoom;
const int STEPS = 40;
void main() {
  vec2 base = (vUv - 0.5) / uZoom + 0.5;
  float layer = 1.0 / float(STEPS);
  vec2 previousUv = base - uOffset * (1.0 - uFocus);
  float previousGap = texture(uDepth, previousUv).r - 1.0;
  vec2 uv = previousUv;
  for (int i = 1; i <= STEPS; i++) {
    float z = 1.0 - float(i) * layer;
    uv = base - uOffset * (z - uFocus);
    float gap = texture(uDepth, uv).r - z;
    if (gap >= 0.0) {
      uv = mix(previousUv, uv, previousGap / (previousGap - gap));
      break;
    }
    previousUv = uv;
    previousGap = gap;
  }
  color = texture(uImage, clamp(uv, 0.0, 1.0));
}`;

  let container = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let loading = $state(true);

  const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.addEventListener('load', () => resolve(image));
      image.addEventListener('error', () => reject(new Error(`Could not load ${src}`)));
      image.src = src;
    });

  const compile = (gl: WebGL2RenderingContext, type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
    }
    return shader;
  };

  const createTexture = (gl: WebGL2RenderingContext, unit: number) => {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  };

  onMount(() => {
    const gl = canvas?.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
    if (!gl || !canvas || !container) {
      spatialSceneState.hide();
      return;
    }

    let frame = 0;
    let disposed = false;
    let image: HTMLImageElement | undefined;
    let focus = 0.5;
    let lastInput = -Infinity;
    const target = { x: 0, y: 0 };
    const x = { position: 0, velocity: 0 };
    const y = { position: 0, velocity: 0 };
    let tiltBase: { beta: number; gamma: number } | undefined;

    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uOffset = gl.getUniformLocation(program, 'uOffset');
    const uFocus = gl.getUniformLocation(program, 'uFocus');
    const uZoom = gl.getUniformLocation(program, 'uZoom');
    gl.uniform1i(gl.getUniformLocation(program, 'uImage'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'uDepth'), 1);
    const imageTexture = createTexture(gl, 0);
    const depthTexture = createTexture(gl, 1);

    const resize = () => {
      if (!image || !canvas || !container) {
        return;
      }
      const size = contain(image.naturalWidth, image.naturalHeight, container.clientWidth, container.clientHeight);
      const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
      canvas.width = Math.round(size.width * ratio);
      canvas.height = Math.round(size.height * ratio);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas!.getBoundingClientRect();
      if (!rect.width) {
        return;
      }
      target.x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2));
      target.y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2));
      lastInput = performance.now();
    };
    const onPointerLeave = () => {
      target.x = 0;
      target.y = 0;
      lastInput = performance.now();
    };
    const onTilt = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null) {
        return;
      }
      tiltBase ??= { beta: event.beta, gamma: event.gamma };
      target.x = Math.max(-1, Math.min(1, (event.gamma - tiltBase.gamma) / TILT_RANGE));
      target.y = Math.max(-1, Math.min(1, (event.beta - tiltBase.beta) / TILT_RANGE));
      lastInput = performance.now();
    };
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerleave', onPointerLeave);
    addEventListener('deviceorientation', onTilt);

    let previous = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      if (!prefersReducedMotion() && now - lastInput > IDLE_AFTER * 1000) {
        const seconds = now / 1000;
        target.x = Math.sin(seconds * 0.55) * 0.75;
        target.y = Math.sin(seconds * 0.8 + 1.2) * 0.35;
      }
      stepSpring(x, target.x, dt);
      stepSpring(y, target.y, dt);
      const aspect = canvas!.width / canvas!.height || 1;
      gl.uniform2f(uOffset, x.position * AMPLITUDE, y.position * AMPLITUDE * aspect);
      gl.uniform1f(uFocus, focus);
      // zoom in just enough that the shifted edges never show past the frame
      gl.uniform1f(uZoom, 1 + 2.2 * AMPLITUDE * Math.max(focus, 1 - focus));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      frame = requestAnimationFrame(draw);
    };

    const load = async () => {
      try {
        const [preview, depthImage] = await Promise.all([
          loadImage(getAssetMediaUrl({ id: asset.id, size: AssetMediaSize.Preview, cacheKey: asset.thumbhash })),
          loadImage(getDepthMapUrl(asset)),
        ]);
        if (disposed) {
          return;
        }
        const scratch = document.createElement('canvas');
        scratch.width = depthImage.naturalWidth;
        scratch.height = depthImage.naturalHeight;
        const context = scratch.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(depthImage, 0, 0);
        const raw = depthFromRgba(context.getImageData(0, 0, scratch.width, scratch.height).data);
        focus = subjectDepth(raw);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, imageTexture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, preview);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, depthTexture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        const depth = dilate(raw, scratch.width, scratch.height, DILATE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, scratch.width, scratch.height, 0, gl.RED, gl.UNSIGNED_BYTE, depth);

        image = preview;
        resize();
        loading = false;
        frame = requestAnimationFrame(draw);
      } catch {
        if (!disposed) {
          toastManager.danger($t('spatial_scene_unavailable'));
          spatialSceneState.hide();
        }
      }
    };
    void load();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      container?.removeEventListener('pointermove', onPointerMove);
      container?.removeEventListener('pointerleave', onPointerLeave);
      removeEventListener('deviceorientation', onTilt);
      gl.deleteTexture(imageTexture);
      gl.deleteTexture(depthTexture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  });
</script>

<div
  bind:this={container}
  transition:fade={{ duration: 150 }}
  class="flex size-full touch-none place-content-center place-items-center select-none"
  data-testid="spatial-scene-viewer"
>
  {#if loading}
    <div class="absolute">
      <LoadingSpinner />
    </div>
  {/if}
  <canvas bind:this={canvas} aria-label={$t('spatial_scene')} class:invisible={loading}></canvas>
</div>
