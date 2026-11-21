package app.alextran.immich.camerabubble

import android.content.Context
import android.view.View
import androidx.compose.ui.platform.ComposeView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner

/**
 * Compose outside an Activity.
 *
 * A [ComposeView] needs lifecycle, view-model-store and saved-state owners on its view tree.
 * A view added straight to WindowManager has none, so composition silently never happens.
 */
class OverlayViewHost(context: Context) : LifecycleOwner, ViewModelStoreOwner, SavedStateRegistryOwner {

  private val lifecycleRegistry = LifecycleRegistry(this)
  private val savedStateRegistryController = SavedStateRegistryController.create(this)
  private val store = ViewModelStore()

  override val lifecycle: Lifecycle get() = lifecycleRegistry
  override val viewModelStore: ViewModelStore get() = store
  override val savedStateRegistry: SavedStateRegistry get() = savedStateRegistryController.savedStateRegistry

  init {
    savedStateRegistryController.performRestore(null)
    lifecycleRegistry.currentState = Lifecycle.State.INITIALIZED
  }

  /** Wire this host onto a view before handing it to WindowManager. */
  fun attach(view: View) {
    view.setViewTreeLifecycleOwner(this)
    view.setViewTreeViewModelStoreOwner(this)
    view.setViewTreeSavedStateRegistryOwner(this)
  }

  fun onStart() {
    lifecycleRegistry.currentState = Lifecycle.State.RESUMED
  }

  fun destroy() {
    lifecycleRegistry.currentState = Lifecycle.State.DESTROYED
    store.clear()
  }
}
