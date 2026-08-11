import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:immich_mobile/widgets/spaces/space_collage.dart';
import 'package:openapi/api.dart';

/// Edit a space's name, description and colour.
///
/// Naming and appearance are editor-level server-side, so this sheet is gated by
/// its callers (Slice 4), not by itself.
///
/// Takes an [onClose] callback rather than calling `Navigator.pop` directly: that
/// keeps the sheet independent of routing so it can be widget-tested by pumping it
/// alone, and mirrors the web `SpaceEditModal` shape. [SpaceEditSheet.show] supplies
/// the popping implementation.
class SpaceEditSheet extends ConsumerStatefulWidget {
  const SpaceEditSheet({super.key, required this.space, required this.onClose});

  final SharedSpaceResponseDto space;

  /// `true` when the space was saved, `null` when the user cancelled.
  final void Function(bool? saved) onClose;

  static Future<bool?> show(BuildContext context, SharedSpaceResponseDto space) {
    return showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) =>
          SpaceEditSheet(space: space, onClose: (saved) => Navigator.of(sheetContext).pop(saved)),
    );
  }

  @override
  ConsumerState<SpaceEditSheet> createState() => _SpaceEditSheetState();
}

class _SpaceEditSheetState extends ConsumerState<SpaceEditSheet> {
  late final TextEditingController _nameController;
  late final TextEditingController _descriptionController;
  late final FocusNode _nameFocusNode;
  late final String _originalDescription;
  late UserAvatarColor _color;

  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _originalDescription = widget.space.description.orElse(null) ?? '';
    _nameController = TextEditingController(text: widget.space.name)
      ..selection = TextSelection(baseOffset: 0, extentOffset: widget.space.name.length);
    _descriptionController = TextEditingController(text: _originalDescription);
    _color = widget.space.color.orElse(null) ?? UserAvatarColor.primary;
    _nameFocusNode = FocusNode();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _nameFocusNode.dispose();
    super.dispose();
  }

  bool get _canSave => _nameController.text.trim().isNotEmpty && !_isSaving;

  Future<void> _save() async {
    if (!_canSave) return;
    setState(() => _isSaving = true);

    final description = _descriptionController.text;
    try {
      await ref
          .read(sharedSpaceApiRepositoryProvider)
          .update(
            widget.space.id,
            name: _nameController.text,
            // Only send the description when it actually changed. A space created
            // without one stores null server-side, so always sending '' would clobber
            // it on a pure rename; but when the user DID clear it, '' must go through.
            description: description == _originalDescription ? null : description,
            color: _color,
          );
      if (!mounted) return;
      // Reset the in-flight guard even on success: the widget isn't guaranteed to be
      // unmounted synchronously by onClose (its production wiring pops the sheet, but
      // e.g. a bare pump in tests can keep this same State alive), and leaving save
      // disabled forever would be a real (if latent) bug on any caller that doesn't
      // immediately tear the sheet down.
      setState(() => _isSaving = false);
      ImmichToast.show(context: context, msg: context.t.spaces_edit_success, toastType: ToastType.success);
      widget.onClose(true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      // The sheet staying open is not, on its own, feedback: the user taps Save and sees
      // nothing change. A revoked role (403) has to say so. `ImmichToast` schedules a
      // 3s fluttertoast Timer outside the frame scheduler, so any widget test that
      // reaches this path must pump past it (see the test's `settleToast` helper) or
      // teardown reports a pending timer.
      ImmichToast.show(context: context, msg: context.t.errors.unable_to_update_space, toastType: ToastType.error);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: MediaQuery.of(context).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(context.t.spaces_edit, style: context.textTheme.titleMedium),
              const SizedBox(height: 16),
              TextField(
                key: const Key('space-edit-name'),
                controller: _nameController,
                focusNode: _nameFocusNode,
                autofocus: true,
                maxLength: 100,
                // The name arrives pre-selected so typing replaces it (the dominant rename
                // path). A later tap must not re-run that selection logic nor let the
                // framework's own tap-to-position gesture move the caret away from wherever
                // the user last left it -- select-once only.
                enableInteractiveSelection: false,
                decoration: InputDecoration(labelText: context.t.name),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 8),
              TextField(
                key: const Key('space-edit-description'),
                controller: _descriptionController,
                maxLength: 500,
                maxLines: 3,
                minLines: 1,
                decoration: InputDecoration(labelText: context.t.description),
              ),
              const SizedBox(height: 8),
              Text(context.t.color, style: context.textTheme.labelLarge),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [for (final color in UserAvatarColor.values) _swatch(color)]),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    key: const Key('space-edit-cancel'),
                    onPressed: _isSaving ? null : () => widget.onClose(null),
                    child: Text(context.t.cancel),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    key: const Key('space-edit-save'),
                    onPressed: _canSave ? _save : null,
                    child: Text(context.t.save),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _swatch(UserAvatarColor color) {
    final selected = color == _color;
    // The key identifies the tappable 48x48 region itself (so tap-target-size
    // assertions measure the real hit area), with the accessibility label on a
    // descendant -- callers that look up the swatch by key and then search its
    // descendants for the semantics label depend on that nesting order.
    return SizedBox(
      key: Key('space-edit-color-${color.toJson()}'),
      width: 48,
      height: 48,
      // Colour alone conveys nothing to a screen reader, so each swatch is labelled.
      child: Semantics(
        label: color.toJson(),
        selected: selected,
        button: true,
        child: InkWell(
          onTap: () => setState(() => _color = color),
          child: Center(
            child: Container(
              key: selected ? Key('space-edit-color-${color.toJson()}-selected') : null,
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: spaceGradientColors(color).first,
                border: selected ? Border.all(color: context.colorScheme.onSurface, width: 3) : null,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
