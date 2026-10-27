import 'dart:ui' as ui;

/// The wave front: a soft diagonal edge that travels from the top-left corner to the bottom-right one.
///
/// Use it as a `BlendMode.dstIn` mask. At [progress] 0 nothing has passed; at 1 the front has crossed
/// the whole box. With [reveal], what the front has passed is opaque (content wiping in); without it,
/// what lies ahead is opaque (something wiping away). [fadeOnly] (reduced motion) drops the travel and
/// fades the whole box instead.
ui.Shader galleryWaveShader(ui.Rect rect, double progress, {required bool reveal, bool fadeOnly = false}) {
  const edge = 0.35;
  const transparent = ui.Color(0x00000000);
  const opaque = ui.Color(0xFFFFFFFF);
  final (behind, ahead) = reveal ? (opaque, transparent) : (transparent, opaque);
  if (fadeOnly) {
    final color = ui.Color.lerp(ahead, behind, progress)!;
    return ui.Gradient.linear(rect.topLeft, rect.topRight, [color, color]);
  }
  final front = -edge + progress * (1 + edge);
  return ui.Gradient.linear(
    rect.topLeft,
    rect.bottomRight,
    [behind, ahead],
    [front.clamp(0.0, 1.0), (front + edge).clamp(0.0, 1.0)],
  );
}
