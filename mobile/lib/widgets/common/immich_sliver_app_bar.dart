import 'package:auto_route/auto_route.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/svg.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/models/server_info/server_info.model.dart';
import 'package:immich_mobile/providers/backup/backup.provider.dart';
import 'package:immich_mobile/providers/cast.provider.dart';
import 'package:immich_mobile/providers/infrastructure/readonly_mode.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:immich_mobile/providers/sync_status.provider.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/widgets/asset_viewer/cast_dialog.dart';
import 'package:immich_mobile/widgets/common/app_bar_dialog/app_bar_dialog.dart';
import 'package:immich_mobile/widgets/common/user_circle_avatar.dart';

class ImmichSliverAppBar extends ConsumerWidget {
  final List<Widget>? actions;
  final bool showUploadButton;
  final bool floating;
  final bool pinned;
  final bool snap;
  final Widget? title;
  final double? expandedHeight;

  const ImmichSliverAppBar({
    super.key,
    this.actions,
    this.showUploadButton = true,
    this.floating = true,
    this.pinned = false,
    this.snap = true,
    this.title,
    this.expandedHeight,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isCasting = ref.watch(castProvider.select((c) => c.isCasting));
    final isReadonlyModeEnabled = ref.watch(readonlyModeProvider);
    final isMultiSelectEnabled = ref.watch(multiSelectProvider.select((s) => s.isEnabled));

    return SliverIgnorePointer(
      ignoring: isMultiSelectEnabled,
      sliver: SliverAnimatedOpacity(
        duration: Durations.medium1,
        opacity: isMultiSelectEnabled ? 0 : 1,
        sliver: SliverAppBar(
          backgroundColor: context.colorScheme.surface,
          surfaceTintColor: context.colorScheme.surfaceTint,
          elevation: 0,
          scrolledUnderElevation: 1.0,
          floating: floating,
          pinned: pinned,
          snap: snap,
          expandedHeight: expandedHeight,
          shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(bottom: Radius.circular(5))),
          automaticallyImplyLeading: false,
          centerTitle: false,
          title: title ?? const _ImmichLogoWithText(),
          // Sync progress rides the bottom edge of the bar rather than the actions row (#1030):
          // an action that comes and goes changes how much width the title slot is offered, and
          // the logo — a BoxFit.contain SVG — silently resized to match. flexibleSpace sits
          // behind the toolbar, so the line costs the bar no height and no horizontal room.
          flexibleSpace: const _SyncProgressLine(),
          actions: [
            if (isCasting && !isReadonlyModeEnabled)
              IconButton(
                onPressed: () => showDialog(context: context, builder: (context) => const CastDialog()),
                icon: Icon(isCasting ? Icons.cast_connected_rounded : Icons.cast_rounded),
              ),
            ...?actions,
            if (showUploadButton && !isReadonlyModeEnabled) const _BackupIndicator(),
            const _ProfileIndicator(),
            const SizedBox(width: 8),
          ],
        ),
      ),
    );
  }
}

/// Height of the app-bar wordmark.
///
/// The artwork is 122x35, so this height asks for ~150 px of the title slot — and the slot is
/// only ever `barWidth - actionsWidth - 2 * titleSpacing` wide. `SvgPicture` fits with
/// `BoxFit.contain`, so anything the actions row takes beyond that budget comes straight out of
/// the logo (#1030). Keep the actions row at or below ~155 px on the busiest bar, or lower this.
const double _kLogoHeight = 43;

class _ImmichLogoWithText extends StatelessWidget {
  const _ImmichLogoWithText();

  @override
  Widget build(BuildContext context) => AnimatedOpacity(
    opacity: IconTheme.of(context).opacity ?? 1,
    duration: kThemeChangeDuration,
    child: SvgPicture.asset(
      context.isDarkTheme ? 'assets/immich-logo-inline-dark.svg' : 'assets/immich-logo-inline-light.svg',
      height: _kLogoHeight,
    ),
  );
}

class _ProfileIndicator extends ConsumerWidget {
  const _ProfileIndicator();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final bool versionWarningPresent = ref.watch(versionWarningPresentProvider(user));
    final serverInfoState = ref.watch(serverInfoProvider);

    const widgetSize = 32.0;

    // TODO: remove this when update Flutter version newer than 3.35.7
    final isIpad = defaultTargetPlatform == TargetPlatform.iOS && !context.isMobile;

    void toggleReadonlyMode() {
      final isReadonlyModeEnabled = ref.read(readonlyModeProvider);
      ref.read(readonlyModeProvider.notifier).toggleReadonlyMode();

      context.scaffoldMessenger.showSnackBar(
        SnackBar(
          duration: const Duration(seconds: 2),
          content: Text(
            isReadonlyModeEnabled ? context.t.readonly_mode_disabled : context.t.readonly_mode_enabled,
            style: context.textTheme.bodyLarge?.copyWith(color: context.primaryColor),
          ),
        ),
      );
    }

    return IconButton(
      onPressed: () => showDialog(
        context: context,
        useRootNavigator: false,
        barrierDismissible: !isIpad,
        builder: (ctx) => const ImmichAppBarDialog(),
      ),
      onLongPress: () => toggleReadonlyMode(),
      icon: Badge(
        label: _BadgeLabel(
          Icon(
            Icons.info,
            color: serverInfoState.versionStatus == VersionStatus.error
                ? context.colorScheme.error
                : context.primaryColor,
            size: widgetSize / 2 - 3,
            semanticLabel: context.t.new_version_available,
          ),
        ),
        backgroundColor: Colors.transparent,
        alignment: Alignment.bottomRight,
        isLabelVisible: versionWarningPresent,
        offset: const Offset(-2, -12),
        child: user == null
            ? const Icon(Icons.face_outlined, size: widgetSize)
            : Semantics(
                label: context.t.logged_in_as(user: user.name),
                child: AbsorbPointer(
                  child: Builder(
                    builder: (context) => UserCircleAvatar(
                      size: 34,
                      user: user,
                      opacity: IconTheme.of(context).opacity ?? 1,
                      hasBorder: true,
                    ),
                  ),
                ),
              ),
      ),
    );
  }
}

const double _kBadgeWidgetSize = 30.0;

class _BackupIndicator extends ConsumerWidget {
  const _BackupIndicator();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final backupEnabled = ref.watch(appConfigProvider.select((c) => c.backup.enabled));
    final hasError = ref.watch(backupProvider.select((state) => state.error != BackupError.none));
    final isUploading = ref.watch(backupProvider.select((state) => state.uploadItems.isNotEmpty));
    final indicatorIcon = _getBackupBadgeIcon(
      context,
      backupEnabled: backupEnabled,
      hasError: hasError,
      isUploading: isUploading,
    );

    return IconButton(
      onPressed: () => context.pushRoute(const BackupRoute()),
      icon: Badge(
        label: indicatorIcon,
        backgroundColor: Colors.transparent,
        alignment: Alignment.bottomRight,
        isLabelVisible: indicatorIcon != null,
        offset: const Offset(-2, -12),
        child: Icon(Icons.backup_rounded, size: _kBadgeWidgetSize, color: context.primaryColor),
      ),
    );
  }

  Widget? _getBackupBadgeIcon(
    BuildContext context, {
    required bool backupEnabled,
    required bool hasError,
    required bool isUploading,
  }) {
    final isDarkTheme = context.isDarkTheme;
    final iconColor = isDarkTheme ? Colors.white : Colors.black;

    if (!backupEnabled) {
      return _BadgeLabel(
        Icon(
          Icons.cloud_off_rounded,
          size: 9,
          color: iconColor,
          semanticLabel: context.t.backup_controller_page_backup,
        ),
      );
    }

    if (hasError) {
      return _BadgeLabel(
        Icon(
          Icons.warning_rounded,
          size: 12,
          color: context.colorScheme.error,
          semanticLabel: context.t.backup_controller_page_backup,
        ),
        backgroundColor: context.colorScheme.errorContainer,
      );
    }

    if (isUploading) {
      return _BadgeLabel(
        Container(
          padding: const EdgeInsets.all(3.5),
          child: Theme(
            data: context.themeData.copyWith(
              progressIndicatorTheme: context.themeData.progressIndicatorTheme.copyWith(year2023: true),
            ),
            child: CircularProgressIndicator(
              strokeWidth: 2,
              strokeCap: StrokeCap.round,
              valueColor: AlwaysStoppedAnimation<Color>(iconColor),
              semanticsLabel: context.t.backup_controller_page_backup,
            ),
          ),
        ),
      );
    }

    return _BadgeLabel(
      Icon(Icons.check_outlined, size: 9, color: iconColor, semanticLabel: context.t.backup_controller_page_backup),
    );
  }
}

class _BadgeLabel extends StatelessWidget {
  final Widget indicator;
  final Color? backgroundColor;

  const _BadgeLabel(this.indicator, {this.backgroundColor});

  @override
  Widget build(BuildContext context) {
    final opacity = IconTheme.of(context).opacity ?? 1;

    return Container(
      width: _kBadgeWidgetSize / 2,
      height: _kBadgeWidgetSize / 2,
      decoration: BoxDecoration(
        color: (backgroundColor ?? context.colorScheme.surfaceContainer).withValues(alpha: opacity),
        border: Border.all(color: context.colorScheme.outline.withValues(alpha: .3 * opacity)),
        borderRadius: BorderRadius.circular(_kBadgeWidgetSize / 2),
      ),
      child: indicator,
    );
  }
}

/// Sync progress as a hairline along the bottom edge of the app bar.
///
/// Replaces the rotating `Icons.sync` action that used to sit in the actions row. As an action
/// it occupied 40 px only while a sync was running, which moved the title slot's width under the
/// logo twice per sync and made it visibly grow and shrink (#1030). A line costs no horizontal
/// room at all, so nothing in the bar moves when a sync starts or finishes.
class _SyncProgressLine extends ConsumerWidget {
  const _SyncProgressLine();

  static const double _height = 3;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final syncStatus = ref.watch(syncStatusProvider);
    final isSyncing = syncStatus.isRemoteSyncing || syncStatus.isLocalSyncing;

    // The multi-select fade is handled by the bar's own SliverAnimatedOpacity, so the line
    // needs no opacity handling of its own — it simply is or is not there.
    return Align(
      alignment: Alignment.bottomCenter,
      child: SizedBox(
        height: _height,
        child: isSyncing
            ? LinearProgressIndicator(
                key: const Key('app-bar-sync-progress'),
                minHeight: _height,
                // Only the travelling segment paints; an idle bar shows nothing at all.
                backgroundColor: Colors.transparent,
                semanticsLabel: context.t.sync$,
              )
            : null,
      ),
    );
  }
}
