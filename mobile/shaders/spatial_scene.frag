// Spatial Scene (specs/2026-10-29-spatial-scene-design.md): the web viewer's fragment shader
// (web/src/lib/gallery/spatial/SpatialSceneViewer.svelte) in Flutter's runtime-effect GLSL. Each output pixel marches
// from the nearest depth back and takes the first surface its ray meets, so the subject covers the background as the
// view moves (screen-space parallax occlusion mapping).
#version 460 core
#include <flutter/runtime_effect.glsl>

precision highp float;

// Float uniforms, in the order SpatialScenePainter sets them.
uniform vec2 uSize;
uniform vec2 uOffset;
uniform float uFocus;
uniform float uZoom;

uniform sampler2D uImage;
uniform sampler2D uDepth;

out vec4 fragColor;

const int STEPS = 40;

float depthAt(vec2 uv) {
  return texture(uDepth, clamp(uv, 0.0, 1.0)).r;
}

void main() {
  vec2 vUv = FlutterFragCoord().xy / uSize;
  vec2 base = (vUv - 0.5) / uZoom + 0.5;
  float layer = 1.0 / float(STEPS);
  vec2 previousUv = base - uOffset * (1.0 - uFocus);
  float previousGap = depthAt(previousUv) - 1.0;
  vec2 uv = previousUv;
  for (int i = 1; i <= STEPS; i++) {
    float z = 1.0 - float(i) * layer;
    uv = base - uOffset * (z - uFocus);
    float gap = depthAt(uv) - z;
    if (gap >= 0.0) {
      uv = mix(previousUv, uv, previousGap / (previousGap - gap));
      break;
    }
    previousUv = uv;
    previousGap = gap;
  }
  fragColor = texture(uImage, clamp(uv, 0.0, 1.0));
}
