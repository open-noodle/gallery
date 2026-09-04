/// Bottom-navigation preferences.
///
/// [showSpaces] defaults to TRUE: Spaces occupies the middle nav slot unless the
/// user turns it off, in which case Albums takes it back. Albums remains
/// reachable either way from the Library tab.
class NavConfig {
  final bool showSpaces;

  const NavConfig({this.showSpaces = true});

  NavConfig copyWith({bool? showSpaces}) => NavConfig(showSpaces: showSpaces ?? this.showSpaces);

  @override
  bool operator ==(Object other) => identical(this, other) || (other is NavConfig && other.showSpaces == showSpaces);

  @override
  int get hashCode => showSpaces.hashCode;

  @override
  String toString() => 'NavConfig(showSpaces: $showSpaces)';
}
