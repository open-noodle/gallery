import 'dart:async';

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/locales.dart';
import 'package:immich_mobile/data/store.dart';
import 'package:immich_mobile/domain/services/camera_bubble.service.dart';
import 'package:immich_mobile/generated/codegen_loader.g.dart';
import 'package:immich_mobile/platform/camera_bubble_api.g.dart';
import 'package:immich_mobile/presentation/widgets/camera_bubble/camera_bubble_picker.widget.dart';
import 'package:immich_mobile/utils/bootstrap.dart';
import 'package:immich_mobile/utils/cache/widgets_binding.dart';

/// The picker's Flutter app, run in its own engine by `CameraBubblePickerActivity`.
///
/// Deliberately not `main()`: booting the real app would give the picker a second router and
/// navigator, entangled with the main app's back stack.
///
/// The entrypoint itself lives in `main.dart`. AOT drops libraries nothing references, so a
/// `vm:entry-point` function in an unimported file is never compiled at all.
Future<void> runCameraBubblePicker() async {
  try {
    ImmichWidgetsBinding();
    await EasyLocalization.ensureInitialized();

    // Short-lived and write-only; the app's engine has its own listening Store.
    final (dataController, apiService) = await Bootstrap.initDomain(
      disableStoreWatching: true,
      shouldBufferLogs: false,
    );

    runApp(
      // `ensureInitialized()` only prepares the plugin; without this widget every `.t()` falls
      // through to its raw key.
      EasyLocalization(
        supportedLocales: locales.values.toList(),
        path: translationsPath,
        useFallbackTranslations: true,
        fallbackLocale: locales.values.first,
        assetLoader: const CodegenLoader(),
        child: ProviderScope(
          overrides: Store.overrideWith(dataController: dataController, apiService: apiService),
          child: const _CameraBubblePickerApp(),
        ),
      ),
    );
  } catch (error, stack) {
    // Log loudly: otherwise a failure is just an empty window.
    // ignore: avoid_print
    print('CAMERA_BUBBLE picker failed to start: $error\n$stack');
    runApp(const _PickerFailed());
  }
}

class _CameraBubblePickerApp extends ConsumerWidget {
  const _CameraBubblePickerApp();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      localizationsDelegates: context.localizationDelegates,
      supportedLocales: context.supportedLocales,
      locale: context.locale,
      theme: ThemeData.dark(useMaterial3: true).copyWith(scaffoldBackgroundColor: Colors.transparent),
      home: const _PickerHost(),
    );
  }
}

class _PickerHost extends ConsumerStatefulWidget {
  const _PickerHost();

  @override
  ConsumerState<_PickerHost> createState() => _PickerHostState();
}

class _PickerHostState extends ConsumerState<_PickerHost> {
  final _host = CameraBubbleHostApi();

  Future<void> _dismiss(List<CameraBubbleTarget>? chosen) async {
    if (chosen != null) {
      // Straight to the shared store, then pushed so the bubble updates before this closes.
      await CameraBubbleSessions.replaceSelection(chosen);
      await _host.update(
        chosen.map(CameraBubbleSessions.asOverlayTarget).toList(),
        chosen.map((t) => t.encoded).toList(),
      );
    }
    await _host.closePicker();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Stack(
        children: [
          // The scrim. Tapping it dismisses, like any bottom sheet.
          Positioned.fill(
            child: GestureDetector(onTap: () => _dismiss(null), behavior: HitTestBehavior.opaque),
          ),
          DraggableScrollableSheet(
            initialChildSize: 0.7,
            minChildSize: 0.35,
            maxChildSize: 0.95,
            // Snap, so a half-hearted drag settles somewhere deliberate.
            snap: true,
            snapSizes: const [0.35, 0.7, 0.95],
            builder: (context, scrollController) => Material(
              color: Theme.of(context).colorScheme.surface,
              shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
              clipBehavior: Clip.antiAlias,
              child: CameraBubblePicker(
                initial: CameraBubbleSessions.currentSelection(),
                onDone: _dismiss,
                scrollController: scrollController,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PickerFailed extends StatefulWidget {
  const _PickerFailed();

  @override
  State<_PickerFailed> createState() => _PickerFailedState();
}

class _PickerFailedState extends State<_PickerFailed> {
  @override
  void initState() {
    super.initState();
    // initState, not build: build can run more than once.
    unawaited(CameraBubbleHostApi().closePicker());
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
