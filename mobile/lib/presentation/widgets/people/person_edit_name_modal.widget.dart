import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/utils/debug_print.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';

class PersonNameEditForm extends ConsumerStatefulWidget {
  final Person person;

  const PersonNameEditForm({super.key, required this.person});

  @override
  ConsumerState<PersonNameEditForm> createState() => _PersonNameEditFormState();
}

class _PersonNameEditFormState extends ConsumerState<PersonNameEditForm> {
  late TextEditingController _formController;

  @override
  void initState() {
    super.initState();
    _formController = TextEditingController(text: widget.person.name);
  }

  Future<void> onEdit(String newName) async {
    try {
      final result = await ref.read(peopleServiceProvider).updateName(widget.person, newName);
      if (result != 0 && mounted) {
        // A Drift stream can never observe a server-side edit — a space-person rename writes
        // nothing locally — so the server-backed list must still be invalidated by hand.
        ref.invalidate(driftGetAllPeopleWithSharedSpacesProvider);
        context.pop<String>(newName);
      }
    } catch (error) {
      dPrint(() => 'Error updating name: $error');

      if (!mounted) {
        return;
      }

      ImmichToast.show(
        context: context,
        msg: context.t.scaffold_body_error_occurred,
        gravity: ToastGravity.BOTTOM,
        toastType: ToastType.error,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(context.t.edit_name, style: const TextStyle(fontWeight: FontWeight.bold)),
      content: SingleChildScrollView(
        child: TextFormField(
          controller: _formController,
          textCapitalization: TextCapitalization.words,
          autofocus: true,
          decoration: InputDecoration(hintText: context.t.name, border: const OutlineInputBorder()),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => context.pop(null),
          child: Text(
            context.t.cancel,
            style: TextStyle(color: Colors.red[300], fontWeight: FontWeight.bold),
          ),
        ),
        TextButton(
          onPressed: () => onEdit(_formController.text),
          child: Text(
            context.t.save,
            style: TextStyle(color: context.primaryColor, fontWeight: FontWeight.bold),
          ),
        ),
      ],
    );
  }
}
