package app.alextran.immich.camerabubble

import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import app.alextran.immich.core.ImmichPlugin
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding

/** Flutter-facing half: permissions and the service lifecycle. */
class CameraBubblePlugin(private val context: Context) : ImmichPlugin(), CameraBubbleHostApi, ActivityAware {

  private var activity: android.app.Activity? = null

  override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
    super.onAttachedToEngine(binding)
    CameraBubbleHostApi.setUp(binding.binaryMessenger, this)
  }

  override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
    CameraBubbleHostApi.setUp(binding.binaryMessenger, null)
    super.onDetachedFromEngine(binding)
  }

  // ---------------------------------------------------------------- permissions

  override fun isOverlayPermissionGranted(): Boolean = Settings.canDrawOverlays(context)

  override fun requestOverlayPermission() {
    val intent = Intent(
      Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
      Uri.parse("package:${context.packageName}"),
    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
  }

  override fun isUsageAccessGranted(): Boolean {
    val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        Process.myUid(),
        context.packageName,
      )
    } else {
      @Suppress("DEPRECATION")
      appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  override fun requestUsageAccess() {
    context.startActivity(
      Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
  }

  // ---------------------------------------------------------------- lifecycle

  override fun start(
    targets: List<OverlayTarget>,
    selectedIds: List<String>,
    notificationTitle: String,
    notificationBody: String,
    callback: (Result<Unit>) -> Unit,
  ) {
    if (!isOverlayPermissionGranted()) {
      callback(Result.failure(IllegalStateException("Draw-over-other-apps permission not granted")))
      return
    }

    val intent = Intent(context, CameraBubbleOverlayService::class.java).apply {
      putExtra(CameraBubbleOverlayService.EXTRA_TARGETS_JSON, encodeTargets(targets))
      putExtra(CameraBubbleOverlayService.EXTRA_SELECTED, selectedIds.toTypedArray())
      putExtra(CameraBubbleOverlayService.EXTRA_TITLE, notificationTitle)
      putExtra(CameraBubbleOverlayService.EXTRA_BODY, notificationBody)
    }
    // startForegroundService: the service calls startForeground() at once, and this is only
    // reached from a visible activity — what Android 15's background-start rule requires.
    CameraBubbleOverlayService.setEnabled(context, true)
    context.startForegroundService(intent)
    callback(Result.success(Unit))
  }

  override fun stop() {
    CameraBubbleOverlayService.setEnabled(context, false)
    context.stopService(Intent(context, CameraBubbleOverlayService::class.java))
  }

  override fun update(targets: List<OverlayTarget>, selectedIds: List<String>) {
    if (!CameraBubbleOverlayService.isRunning) return
    val intent = Intent(context, CameraBubbleOverlayService::class.java).apply {
      action = CameraBubbleOverlayService.ACTION_UPDATE
      putExtra(CameraBubbleOverlayService.EXTRA_TARGETS_JSON, encodeTargets(targets))
      putExtra(CameraBubbleOverlayService.EXTRA_SELECTED, selectedIds.toTypedArray())
    }
    context.startService(intent)
  }

  override fun isRunning(): Boolean = CameraBubbleOverlayService.isRunning

  /**
   * Dismiss the drawer, returning to the camera. `finish()` rather than `moveTaskToBack()`: the
   * drawer has its own task and engine, so there is nothing to keep alive.
   */
  override fun closePicker() {
    activity?.finish()
  }

  override fun onAttachedToActivity(binding: ActivityPluginBinding) {
    activity = binding.activity
  }

  override fun onDetachedFromActivityForConfigChanges() {
    activity = null
  }

  override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) {
    activity = binding.activity
  }

  override fun onDetachedFromActivity() {
    activity = null
  }
}
