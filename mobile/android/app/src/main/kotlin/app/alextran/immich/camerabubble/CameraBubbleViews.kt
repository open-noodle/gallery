package app.alextran.immich.camerabubble

import app.alextran.immich.R
import java.text.BreakIterator

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.animation.core.Animatable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Immich's dark primary is the only accent.
private val Accent = Color(0xFFACCBFA)
private val OnAccent = Color(0xFF0B1B3A)
private val GlassBubble = Color(0xAD16171E)
private val Hairline = Color(0x24FFFFFF)
private val OnGlass = Color(0xFFFFFFFF)

fun parseTargetColor(hex: String): Color = try {
  Color(android.graphics.Color.parseColor(if (hex.startsWith("#")) hex else "#$hex"))
} catch (_: IllegalArgumentException) {
  Color(0xFF6A4C93)
}

/**
 * The first *grapheme cluster*, not the first `Char`. A flag emoji is a pair of regional
 * indicators — four UTF-16 units — so `take(1)` sliced a lone surrogate and drew tofu.
 */
private fun String.firstGrapheme(): String {
  val text = trim()
  if (text.isEmpty()) return ""
  val breaks = BreakIterator.getCharacterInstance()
  breaks.setText(text)
  val end = breaks.next()
  return if (end == BreakIterator.DONE) text else text.substring(0, end)
}

/** A target's stand-in avatar: coloured disc, first character. */
@Composable
private fun TargetAvatar(target: OverlayTarget, size: Int, ringed: Boolean, flare: Float = 0f) {
  Box(
    modifier = Modifier
      .size(size.dp)
      .clip(CircleShape)
      .background(parseTargetColor(target.colorHex))
      // `flare` runs 1 -> 0 once per captured photo: visible in peripheral vision, covers nothing.
      .then(
        if (ringed) Modifier.border((2 + 3 * flare).dp, Accent.copy(alpha = 0.55f + 0.45f * (1f - flare)), CircleShape)
        else Modifier,
      ),
    contentAlignment = Alignment.Center,
  ) {
    Text(
      text = target.name.firstGrapheme().uppercase(),
      color = OnGlass,
      fontSize = (size * 0.42).sp,
      fontWeight = FontWeight.Medium,
    )
  }
}

/**
 * The bubble: shows what is selected and when a photo lands; tapping it opens the drawer.
 *
 * @param peeking briefly expands into a pill naming the targets.
 * @param mirrored docked on the right: the pill grows leftwards, names before the disc.
 * @param pulseTick increments once per captured photo; the ring flares on each change.
 */
@Composable
fun CameraBubble(
  selected: List<OverlayTarget>,
  idle: Boolean,
  peeking: Boolean = false,
  pulseTick: Int = 0,
  mirrored: Boolean = false,
) {
  val alpha by animateFloatAsState(
    targetValue = if (idle && !peeking) 0.62f else 1f,
    animationSpec = spring(stiffness = Spring.StiffnessLow),
    label = "bubbleAlpha",
  )

  val pulse = remember { Animatable(0f) }
  LaunchedEffect(pulseTick) {
    if (pulseTick == 0) return@LaunchedEffect
    pulse.snapTo(1f)
    pulse.animateTo(0f, animationSpec = spring(stiffness = Spring.StiffnessMediumLow))
  }

  Box(
    // Gutter so the badge can sit outside the disc.
    modifier = Modifier.padding(8.dp),
  ) {
    CompositionLocalProvider(LocalLayoutDirection provides if (mirrored) LayoutDirection.Rtl else LayoutDirection.Ltr) {
      Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
          .alpha(alpha)
          .height(52.dp)
          // background(color, shape), NOT clip(shape).background(color): `clip` clips children,
          // and the badge sits outside the inscribed circle.
          .background(GlassBubble, CircleShape)
          .border(1.dp, Hairline, CircleShape)
          .animateContentSize(animationSpec = spring(dampingRatio = 0.75f, stiffness = Spring.StiffnessMediumLow))
          .padding(horizontal = if (peeking && selected.isNotEmpty()) 6.dp else 0.dp)
          .width(if (peeking && selected.isNotEmpty()) androidx.compose.ui.unit.Dp.Unspecified else 52.dp),
        horizontalArrangement = if (peeking && selected.isNotEmpty()) Arrangement.Start else Arrangement.Center,
      ) {
        Box(modifier = Modifier.size(52.dp), contentAlignment = Alignment.Center) {
          when {
            selected.isEmpty() -> AppMark()
            selected.size == 1 -> TargetAvatar(selected[0], 32, ringed = true, flare = pulse.value)
            // 26dp overlapped by 9 = 43dp across, inside the 52dp disc.
            else -> Row(verticalAlignment = Alignment.CenterVertically) {
              TargetAvatar(selected[1], 26, ringed = true, flare = pulse.value)
              Box(
                modifier = Modifier
                  .offset(x = (-9).dp)
                  .size(31.dp)
                  .background(Color(0xFF16171E), CircleShape),
                contentAlignment = Alignment.Center,
              ) {
                TargetAvatar(selected[0], 26, ringed = true, flare = pulse.value)
              }
            }
          }
        }

        if (peeking && selected.isNotEmpty()) {
          Text(
            text = selected.joinToString(", ") { it.name },
            color = OnGlass,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 2.dp, end = 10.dp).widthIn(max = 180.dp),
          )
        }
      }
    }

    // Sibling of the disc, so the badge rides on the rim rather than floating inside it.
    if (selected.size > 1 && !peeking) {
      Box(
        modifier = Modifier
          .align(Alignment.TopEnd)
          .offset(x = 4.dp, y = (-4).dp)
          .size(18.dp)
          .background(Accent, CircleShape)
          .border(2.dp, Color(0xFF16171E), CircleShape),
        contentAlignment = Alignment.Center,
      ) {
        Text("${selected.size}", color = OnAccent, fontSize = 10.sp, fontWeight = FontWeight.Bold)
      }
    }
  }
}

/**
 * The app's mark, shown when nothing is selected.
 *
 * Rasterised by hand: on API 26+ `ic_launcher` resolves to an `<adaptive-icon>`, which Compose's
 * `painterResource` cannot draw — it throws and takes the overlay down with it.
 */
@Composable
private fun AppMark() {
  val context = LocalContext.current
  val density = LocalDensity.current
  val icon = remember(context) {
    val px = with(density) { 30.dp.roundToPx() }.coerceAtLeast(1)
    runCatching {
      val drawable = context.getDrawable(R.mipmap.ic_launcher) ?: return@runCatching null
      val bitmap = android.graphics.Bitmap.createBitmap(px, px, android.graphics.Bitmap.Config.ARGB_8888)
      drawable.setBounds(0, 0, px, px)
      drawable.draw(android.graphics.Canvas(bitmap))
      bitmap.asImageBitmap()
    }.getOrNull()
  }

  if (icon == null) {
    // Stay visible and tappable even if the icon cannot be rendered.
    Box(modifier = Modifier.size(26.dp).clip(CircleShape).background(Accent.copy(alpha = 0.35f)))
  } else {
    Image(bitmap = icon, contentDescription = null, modifier = Modifier.size(30.dp).clip(CircleShape))
  }
}
