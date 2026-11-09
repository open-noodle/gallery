import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/services/local_auth.service.dart';
import 'package:immich_mobile/utils/debug_print.dart';

class AppLockState {
  final bool isLocked;
  final bool isAuthenticating;

  const AppLockState({
    this.isLocked = false,
    this.isAuthenticating = false,
  });

  AppLockState copyWith({
    bool? isLocked,
    bool? isAuthenticating,
  }) {
    return AppLockState(
      isLocked: isLocked ?? this.isLocked,
      isAuthenticating: isAuthenticating ?? this.isAuthenticating,
    );
  }
}

class AppLockNotifier extends StateNotifier<AppLockState> {
  final Ref _ref;
  DateTime? _pausedAt;

  AppLockNotifier(this._ref) : super(const AppLockState()) {
    // On cold start, if App Lock is enabled, start locked
    final isEnabled = Store.get(StoreKey.appLockEnabled, false);
    if (isEnabled) {
      state = state.copyWith(isLocked: true);
    }
  }

  bool get isAppLockEnabled => Store.get(StoreKey.appLockEnabled, false);
  int get timeoutSeconds => Store.get(StoreKey.appLockTimeout, 0);

  void handleAppPaused() {
    if (!isAppLockEnabled || state.isAuthenticating) {
      return;
    }
    _pausedAt = DateTime.now();
  }

  void handleAppResumed() {
    final pausedAt = _pausedAt;
    _pausedAt = null;

    if (!isAppLockEnabled) {
      if (state.isLocked) {
        state = state.copyWith(isLocked: false);
      }
      return;
    }

    if (pausedAt != null) {
      final elapsed = DateTime.now().difference(pausedAt).inSeconds;
      if (elapsed >= timeoutSeconds) {
        state = state.copyWith(isLocked: true);
      }
    }

    if (state.isLocked && !state.isAuthenticating) {
      unawaited(authenticate());
    }
  }

  Future<bool> authenticate([String? reason]) async {
    if (state.isAuthenticating) {
      return false;
    }
    state = state.copyWith(isAuthenticating: true);
    try {
      final localAuth = _ref.read(localAuthServiceProvider);
      final bool authenticated = await localAuth.authenticate(reason);
      if (authenticated) {
        _pausedAt = null;
        state = state.copyWith(
          isLocked: false,
          isAuthenticating: false,
        );
        return true;
      }
    } catch (e) {
      dPrint(() => "AppLock authentication error: $e");
    } finally {
      state = state.copyWith(isAuthenticating: false);
    }
    return false;
  }

  void unlock() {
    _pausedAt = null;
    state = state.copyWith(isLocked: false);
  }
}

final appLockProvider = StateNotifierProvider<AppLockNotifier, AppLockState>((ref) {
  return AppLockNotifier(ref);
});
