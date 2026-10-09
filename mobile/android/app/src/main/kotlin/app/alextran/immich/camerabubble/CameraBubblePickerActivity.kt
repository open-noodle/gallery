package app.alextran.immich.camerabubble

import android.content.Context
import android.content.Intent
import app.alextran.immich.MainActivity
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.android.FlutterActivityLaunchConfigs.BackgroundMode
import io.flutter.embedding.engine.FlutterEngine

/**
 * The picker drawer: Flutter widgets over the camera, in their own activity and engine.
 *
 * Three properties, each bought by a declaration here or in the manifest:
 *  - not the app: `taskAffinity=""` keeps it out of MainActivity's back stack;
 *  - camera stays visible: translucent theme + TRANSPARENT background mode;
 *  - no shared navigator: its own entrypoint runs a minimal app with no router.
 */
class CameraBubblePickerActivity : FlutterActivity() {

  companion object {
    fun intent(context: Context): Intent =
      Intent(context, CameraBubblePickerActivity::class.java).apply {
        // NEW_TASK because the launcher is a Service and has no task of its own; NO_ANIMATION so
        // the drawer's own slide-up is the only motion the user sees.
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
      }
  }

  override fun getBackgroundMode(): BackgroundMode = BackgroundMode.transparent

  override fun onDestroy() {
    // However the drawer closes (Done, the scrim, back), the bubble comes back.
    runCatching { startService(CameraBubbleOverlayService.showIntent(this)) }
    super.onDestroy()
  }

  override fun getDartEntrypointFunctionName(): String = "cameraBubblePickerMain"

  override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
    super.configureFlutterEngine(flutterEngine)
    // The same plugin set as the app, not a subset: bootstrap needs the NetworkApi channel and
    // thumbnails need the image channels. Registering a plugin only wires its channel.
    MainActivity.registerPlugins(applicationContext, flutterEngine)
  }

}
