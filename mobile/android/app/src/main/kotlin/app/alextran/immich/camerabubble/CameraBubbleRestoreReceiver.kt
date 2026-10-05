package app.alextran.immich.camerabubble

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.util.Log

/**
 * Brings the bubble back after a reboot or an app update. Both kill the service silently, and
 * the open session then kept routing photos with no bubble on screen to say so.
 */
class CameraBubbleRestoreReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    if (!CameraBubbleOverlayService.isEnabled(context) || !Settings.canDrawOverlays(context)) return

    // Both broadcasts are exempt from the background foreground-service start restriction.
    runCatching { context.startForegroundService(CameraBubbleOverlayService.restoreIntent(context)) }
      .onFailure { Log.w("CameraBubble", "could not restore the bubble", it) }
  }
}
