package app.alextran.immich.camerabubble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.PixelFormat
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.database.ContentObserver
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.MediaStore
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.dynamicanimation.animation.FlingAnimation
import androidx.dynamicanimation.animation.FloatValueHolder
import androidx.dynamicanimation.animation.SpringAnimation
import androidx.dynamicanimation.animation.SpringForce
import app.alextran.immich.MainActivity
import app.alextran.immich.R
import kotlin.math.abs

private const val TAG = "CameraBubble"
private const val CHANNEL_ID = "immich_camera_bubble"
private const val NOTIFICATION_ID = 0xCA9
private const val IDLE_FADE_MS = 4_000L
private const val PEEK_MS = 1_600L      // how long the pill stays expanded on camera open
private const val PREFS = "camera_bubble"

/** Gutter so the count badge, which overhangs the 52dp art, is not clipped by the window bounds. */
private const val BUBBLE_PAD_DP = 8
private const val BUBBLE_DP = 52

/**
 * Hosts the bubble window. Only the setting stops it, since that also clears the selection.
 * A foreground service, so the system does not kill it and strand the overlay.
 */
class CameraBubbleOverlayService : Service() {

  companion object {
    const val EXTRA_TARGETS_JSON = "targets_json"
    const val EXTRA_SELECTED = "selected"
    const val EXTRA_TITLE = "notification_title"
    const val EXTRA_BODY = "notification_body"
    const val ACTION_UPDATE = "app.alextran.immich.camerabubble.UPDATE"

    /**
     * Sent by the drawer as it closes. Shows the bubble if the camera is still open; otherwise
     * trusts the camera's reopening for a moment, since UsageStats still names the drawer.
     */
    const val ACTION_SHOW = "app.alextran.immich.camerabubble.SHOW"

    fun showIntent(context: Context): Intent =
      Intent(context, CameraBubbleOverlayService::class.java).apply { action = ACTION_SHOW }

    /** Start without a payload, rehydrating from prefs. Sent after a reboot or an app update. */
    const val ACTION_RESTORE = "app.alextran.immich.camerabubble.RESTORE"

    fun restoreIntent(context: Context): Intent =
      Intent(context, CameraBubbleOverlayService::class.java).apply { action = ACTION_RESTORE }

    /** Whether the setting is on. Only the setting writes it; the restore receiver reads it. */
    fun setEnabled(context: Context, enabled: Boolean) =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("enabled", enabled).apply()

    fun isEnabled(context: Context): Boolean =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("enabled", false)

    @Volatile
    var isRunning: Boolean = false
      private set
  }

  private lateinit var windowManager: WindowManager
  private lateinit var host: OverlayViewHost

  private var bubbleView: ComposeView? = null

  private lateinit var bubbleParams: WindowManager.LayoutParams

  private val handler = Handler(Looper.getMainLooper())
  private var idleRunnable: Runnable? = null

  // Compose state, read by the bubble composable.
  private var targets by mutableStateOf<List<OverlayTarget>>(emptyList())
  private var selectedIds by mutableStateOf<Set<String>>(emptySet())
  private var notificationTitle = ""
  private var notificationBody = ""
  private var isIdle by mutableStateOf(false)
  private var dockedRight by mutableStateOf(true)
  /// Window x is measured from the right edge (Gravity.END), so a peek grows leftwards on its own.
  private var anchoredRight = false

  private var isPeeking by mutableStateOf(false)
  private var pulseTick by mutableStateOf(0)

  private var springX: SpringAnimation? = null
  private var springY: SpringAnimation? = null
  private var flingY: FlingAnimation? = null
  private var mediaObserver: ContentObserver? = null
  private var lastPulseUptime = 0L

  private var backCameraIds: Set<String> = emptySet()
  private var cameraPackages: Set<String> = emptySet()
  private var heldCameraId: String? = null
  private var cameraCallback: CameraManager.AvailabilityCallback? = null
  private var trustCameraUntil = 0L
  /// Any back camera in use, recorded before the camera-app filter.
  private var openCameraId: String? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    host = OverlayViewHost(this)
    host.onStart()
    isRunning = true
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_UPDATE) {
      applyPayload(intent)
      return START_STICKY
    }

    if (intent?.action == ACTION_SHOW) {
      handler.post {
        val open = openCameraId
        if (open != null) {
          heldCameraId = open
          showBubble()
        } else {
          trustCameraUntil = android.os.SystemClock.uptimeMillis() + 3_000L
        }
      }
      return START_STICKY
    }

    // Sticky restarts (null intent) and restores carry no payload: rehydrate, don't come back empty.
    if (intent == null || intent.action == ACTION_RESTORE) restoreConfig() else applyPayload(intent)
    startForegroundCompat()

    startCameraWatch()
    return START_STICKY
  }

  private fun applyPayload(intent: Intent?) {
    intent?.getStringExtra(EXTRA_TARGETS_JSON)?.let { targets = decodeTargets(it) }
    intent?.getStringArrayExtra(EXTRA_SELECTED)?.let { selectedIds = it.toSet() }
    intent?.getStringExtra(EXTRA_TITLE)?.let { notificationTitle = it }
    intent?.getStringExtra(EXTRA_BODY)?.let { notificationBody = it }
    persistConfig()
  }

  private fun prefs() = getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun persistConfig() {
    prefs().edit()
      .putString("targets", encodeTargets(targets))
      .putStringSet("selected", selectedIds)
      .putString("notificationTitle", notificationTitle)
      .putString("notificationBody", notificationBody)
      .apply()
  }

  private fun restoreConfig() {
    val p = prefs()
    targets = decodeTargets(p.getString("targets", "[]") ?: "[]")
    selectedIds = p.getStringSet("selected", emptySet())?.toSet() ?: emptySet()
    notificationTitle = p.getString("notificationTitle", "") ?: ""
    notificationBody = p.getString("notificationBody", "") ?: ""
    Log.i(TAG, "restored after restart: ${targets.size} targets, ${selectedIds.size} selected")
  }

  // ---------------------------------------------------------------- notification

  private fun startForegroundCompat() {
    // A channel name must not be blank; the app label covers a start that predates the title.
    val title = notificationTitle.ifBlank { applicationInfo.loadLabel(packageManager).toString() }
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    nm.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, title, NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) },
    )

    val open = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    val notification: Notification = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(notificationBody)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentIntent(open)
      .setOngoing(true)
      .build()

    // The special-use type exists from API 34; passing it earlier throws.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  // ---------------------------------------------------------------- camera watch

  /**
   * "Is this a camera app?" — two filters, cheapest first. Back-camera-only already excludes face
   * unlock and video calls. The package filter is skipped without usage access (fail-open).
   */
  private fun startCameraWatch() {
    // Once per service: every start command lands here, and each would stack another callback.
    if (cameraCallback != null) return
    val cm = getSystemService(Context.CAMERA_SERVICE) as CameraManager

    backCameraIds = cm.cameraIdList.filter { id ->
      cm.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING) ==
        CameraCharacteristics.LENS_FACING_BACK
    }.toSet()

    // Every camera app declares STILL_IMAGE_CAMERA, so there is no hardcoded list of apps.
    cameraPackages = packageManager
      .queryIntentActivities(Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA), 0)
      .mapTo(mutableSetOf()) { it.activityInfo.packageName }

    Log.i(TAG, "watching ${backCameraIds.size} back cameras, ${cameraPackages.size} camera apps")

    val callback = object : CameraManager.AvailabilityCallback() {
      override fun onCameraUnavailable(cameraId: String) {
        if (cameraId !in backCameraIds) return
        openCameraId = cameraId
        val trusted = android.os.SystemClock.uptimeMillis() < trustCameraUntil
        if (!trusted && !ForegroundApp.looksLikeCamera(this@CameraBubbleOverlayService, cameraPackages)) return
        heldCameraId = cameraId
        handler.post { showBubble() }
      }

      override fun onCameraAvailable(cameraId: String) {
        if (cameraId == openCameraId) openCameraId = null
        if (cameraId != heldCameraId) return
        heldCameraId = null
        handler.post { hideBubble() }
      }
    }
    cameraCallback = callback
    cm.registerAvailabilityCallback(callback, handler)
  }

  // ---------------------------------------------------------------- windows

  private fun overlayType(): Int = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY

  private fun showBubble() {
    if (bubbleView != null) return

    // The window is torn down whenever the camera closes, the drawer included: reopen where it was.
    val last = if (::bubbleParams.isInitialized) bubbleParams else null
    bubbleParams = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      overlayType(),
      // NOT_FOCUSABLE keeps the camera's shutter responsive while the bubble is up.
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = last?.gravity ?: (Gravity.TOP or Gravity.START)
      x = last?.x ?: (resources.displayMetrics.widthPixels - dp(BUBBLE_DP + 6) - dp(BUBBLE_PAD_DP))
      y = last?.y ?: (resources.displayMetrics.heightPixels / 3)
    }
    // First show: the default spot is the right edge.
    if (last == null) anchorRight()

    val view = ComposeView(this).apply {
      host.attach(this)
      setContent {
        CameraBubble(
          selected = targets.filter { it.id in selectedIds },
          idle = isIdle,
          peeking = isPeeking,
          pulseTick = pulseTick,
          mirrored = dockedRight,
        )
      }
      setOnTouchListener(BubbleTouchListener())
    }

    bubbleView = view
    windowManager.addView(view, bubbleParams)
    scheduleIdle()
    startMediaWatch()

    // "You still have something selected." Silent when nothing is, or it becomes noise.
    if (selectedIds.isNotEmpty()) {
      isPeeking = true
      vibrate(HapticKind.TICK)
      // One timer, reset by each peek: a stale one would cut the next peek short.
      handler.removeCallbacks(endPeek)
      handler.postDelayed(endPeek, PEEK_MS)
    }
  }

  private val endPeek = Runnable { isPeeking = false }

  /** Measure x from the right edge: Android then grows the window leftwards for the peek. */
  private fun anchorRight() {
    if (anchoredRight) return
    bubbleParams.x = resources.displayMetrics.widthPixels - bubbleParams.x - dp(BUBBLE_DP + BUBBLE_PAD_DP * 2)
    bubbleParams.gravity = Gravity.TOP or Gravity.END
    anchoredRight = true
  }

  private fun hideBubble() {
    stopMediaWatch()
    isPeeking = false
    springX?.cancel()
    springY?.cancel()
    flingY?.cancel()
    bubbleView?.let { runCatching { windowManager.removeView(it) } }
    bubbleView = null
    cancelIdle()
  }

  // ---------------------------------------------------------------- shutter feedback

  /** The shutter press is invisible to an overlay, the saved photo is not: pulse and buzz on it. */
  private fun startMediaWatch() {
    if (mediaObserver != null) return
    val observer = object : ContentObserver(handler) {
      override fun onChange(selfChange: Boolean, uri: android.net.Uri?) {
        if (selectedIds.isEmpty()) return
        val now = android.os.SystemClock.uptimeMillis()
        // MediaStore fires several times per capture (pending insert, then finished file).
        if (now - lastPulseUptime < 1_500L) return
        lastPulseUptime = now
        pulseTick += 1
        vibrate(HapticKind.CONFIRM)
      }
    }
    mediaObserver = observer
    runCatching {
      contentResolver.registerContentObserver(
        MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true, observer,
      )
    }
  }

  private fun stopMediaWatch() {
    mediaObserver?.let { runCatching { contentResolver.unregisterContentObserver(it) } }
    mediaObserver = null
  }

  private enum class HapticKind { TICK, CONFIRM }

  private fun vibrate(kind: HapticKind) {
    val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? android.os.VibratorManager)?.defaultVibrator
    } else {
      @Suppress("DEPRECATION") getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    } ?: return

    val effect = when (kind) {
      HapticKind.TICK -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK)
      HapticKind.CONFIRM -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)
    }
    runCatching { vibrator.vibrate(effect) }
  }

  /** Opens the drawer: a translucent activity in its own task, so the app's navigation is untouched. */
  private fun openPicker() {
    // Always hidden while the drawer is open; the drawer shows it again as it closes.
    hideBubble()
    runCatching { startActivity(CameraBubblePickerActivity.intent(this)) }
      .onFailure { Log.w(TAG, "could not open the picker", it) }
  }

  // ---------------------------------------------------------------- touch

  /** Tap vs drag by slop, not timing: a slow deliberate tap on a viewfinder is common. */
  private inner class BubbleTouchListener : View.OnTouchListener {
    private var startX = 0
    private var startY = 0
    private var touchX = 0f
    private var touchY = 0f
    private var moved = false
    private val slop = dp(8)
    private var tracker: android.view.VelocityTracker? = null

    override fun onTouch(v: View, event: MotionEvent): Boolean {
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          // Grabbing mid-flight must stop the spring, or finger and animation fight.
          springX?.cancel()
          springY?.cancel()
          flingY?.cancel()
          tracker?.recycle()
          tracker = android.view.VelocityTracker.obtain()
          tracker?.addMovement(event)
          startX = bubbleParams.x
          startY = bubbleParams.y
          touchX = event.rawX
          touchY = event.rawY
          moved = false
          isIdle = false
          isPeeking = false
          cancelIdle()
          return true
        }

        MotionEvent.ACTION_MOVE -> {
          tracker?.addMovement(event)
          val dx = (event.rawX - touchX).toInt()
          val dy = (event.rawY - touchY).toInt()
          if (!moved && (abs(dx) > slop || abs(dy) > slop)) {
            moved = true
            // Only a drag needs left-edge coordinates; a tap must leave the anchoring alone.
            if (anchoredRight) {
              bubbleParams.x = resources.displayMetrics.widthPixels - bubbleParams.x - v.width
              bubbleParams.gravity = Gravity.TOP or Gravity.START
              anchoredRight = false
            }
            startX = bubbleParams.x - dx
          }
          if (moved) {
            bubbleParams.x = startX + dx
            bubbleParams.y = startY + dy
            runCatching { windowManager.updateViewLayout(v, bubbleParams) }
          }
          return true
        }

        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          if (!moved) {
            openPicker()
            return true
          }

          tracker?.addMovement(event)
          tracker?.computeCurrentVelocity(1000)
          val vx = tracker?.xVelocity ?: 0f
          val vy = tracker?.yVelocity ?: 0f
          tracker?.recycle()
          tracker = null
          settleToEdge(v, vx, vy)
          scheduleIdle()
          return true
        }
      }
      return false
    }
  }

  /**
   * X springs to an edge, Y coasts with friction. Springing both makes the bubble overshoot
   * vertically and come back, an L-shaped detour.
   */
  private fun settleToEdge(v: View, velocityX: Float, velocityY: Float) {
    val metrics = resources.displayMetrics
    val pad = dp(BUBBLE_PAD_DP)
    val span = dp(BUBBLE_DP + BUBBLE_PAD_DP * 2)
    val centerX = bubbleParams.x + span / 2
    val centerY = bubbleParams.y + span / 2

    val leftX = dp(6) - pad
    val rightX = metrics.widthPixels - dp(BUBBLE_DP + 6) - pad
    val topY = dp(24) - pad
    val maxY = metrics.heightPixels - dp(BUBBLE_DP + 120) - pad

    val vx = velocityX.coerceIn(-8000f, 8000f)
    val vy = velocityY.coerceIn(-8000f, 8000f)

    val distTop = centerY - dp(24)
    val distSide = minOf(centerX, metrics.widthPixels - centerX)
    val goTop = distTop < distSide && distTop < metrics.heightPixels / 4

    springX?.cancel()
    springY?.cancel()
    flingY?.cancel()

    val targetX = when {
      goTop -> (centerX - span / 2).coerceIn(leftX, rightX)
      centerX < metrics.widthPixels / 2 -> leftX
      else -> rightX
    }
    dockedRight = targetX + span / 2 > metrics.widthPixels / 2

    springX = SpringAnimation(FloatValueHolder(bubbleParams.x.toFloat())).apply {
      spring = SpringForce(targetX.toFloat())
        .setDampingRatio(SpringForce.DAMPING_RATIO_NO_BOUNCY)
        .setStiffness(500f)
      setStartVelocity(vx)
      addUpdateListener { _, value, _ ->
        bubbleParams.x = value.toInt()
        runCatching { windowManager.updateViewLayout(v, bubbleParams) }
      }
      // Also when cancelled (a tap or a hide mid-slide): any spot on the right half anchors right.
      addEndListener { _, _, _, _ ->
        if (dockedRight) {
          anchorRight()
          runCatching { windowManager.updateViewLayout(v, bubbleParams) }
        }
      }
      start()
    }

    if (goTop) {
      springY = SpringAnimation(FloatValueHolder(bubbleParams.y.toFloat())).apply {
        spring = SpringForce(topY.toFloat())
          .setDampingRatio(SpringForce.DAMPING_RATIO_NO_BOUNCY)
          .setStiffness(500f)
        setStartVelocity(vy)
        addUpdateListener { _, value, _ ->
          bubbleParams.y = value.toInt()
          runCatching { windowManager.updateViewLayout(v, bubbleParams) }
        }
        start()
      }
    } else {
      flingY = FlingAnimation(FloatValueHolder(bubbleParams.y.toFloat())).apply {
        setStartVelocity(vy)
        setFriction(1.6f)
        setMinValue(topY.toFloat())
        setMaxValue(maxY.toFloat())
        addUpdateListener { _, value, _ ->
          bubbleParams.y = value.toInt()
          runCatching { windowManager.updateViewLayout(v, bubbleParams) }
        }
        start()
      }
    }
  }

  // ---------------------------------------------------------------- timers

  private fun scheduleIdle() {
    cancelIdle()
    val r = Runnable { isIdle = true }
    idleRunnable = r
    handler.postDelayed(r, IDLE_FADE_MS)
  }

  private fun cancelIdle() {
    idleRunnable?.let { handler.removeCallbacks(it) }
    idleRunnable = null
  }

  override fun onDestroy() {
    // First, so the camera service cannot call into a destroyed service and re-add a window.
    cameraCallback?.let { (getSystemService(Context.CAMERA_SERVICE) as CameraManager).unregisterAvailabilityCallback(it) }
    cameraCallback = null
    isRunning = false
    handler.removeCallbacksAndMessages(null)
    springX?.cancel()
    springY?.cancel()
    flingY?.cancel()
    stopMediaWatch()
    hideBubble()
    host.destroy()
    super.onDestroy()
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}

/** Resolves the foreground package, when the user has granted usage access. */
object ForegroundApp {
  fun looksLikeCamera(context: Context, cameraPackages: Set<String>): Boolean {
    if (cameraPackages.isEmpty()) return true
    val pkg = current(context) ?: return true // fail open: no usage access, camera id filter only
    return pkg in cameraPackages
  }

  private fun current(context: Context): String? {
    val usage = context.getSystemService(Context.USAGE_STATS_SERVICE) as? android.app.usage.UsageStatsManager
      ?: return null
    val now = System.currentTimeMillis()
    val events = runCatching { usage.queryEvents(now - 10_000, now) }.getOrNull() ?: return null
    val event = android.app.usage.UsageEvents.Event()
    var last: String? = null
    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      if (event.eventType == android.app.usage.UsageEvents.Event.MOVE_TO_FOREGROUND) {
        last = event.packageName
      }
    }
    return last
  }
}

/** Minimal JSON for the target list, shared with the plugin so both sides cannot drift. */
internal fun encodeTargets(targets: List<OverlayTarget>): String {
  val array = org.json.JSONArray()
  for (target in targets) {
    array.put(
      org.json.JSONObject()
        .put("id", target.id)
        .put("name", target.name)
        .put("colorHex", target.colorHex),
    )
  }
  return array.toString()
}

internal fun decodeTargets(json: String): List<OverlayTarget> = runCatching {
  val array = org.json.JSONArray(json)
  (0 until array.length()).map { i ->
    val o = array.getJSONObject(i)
    OverlayTarget(
      id = o.getString("id"),
      name = o.getString("name"),
      colorHex = o.optString("colorHex", "#6A4C93"),
    )
  }
}.getOrElse { emptyList() }
