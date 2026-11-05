import 'package:openapi/api.dart' show LibraryView;

/// #1038: which photos the Photos tab shows. Stored by name; `both` is no view.
enum LibraryViewMode {
  both,
  personal,
  spaces;

  /// The `:library_view` value of the main timeline queries and the search request's view: null for both.
  String? get queryValue => this == both ? null : name;

  LibraryView? get apiValue => LibraryView.fromJson(queryValue);
}
