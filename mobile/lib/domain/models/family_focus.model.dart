// Gallery-fork: family relationships, mobile slice 13 (person page focus card). Read-only.
//
// Relations are server-sourced and never synced to Drift (see `FamilyApiRepository`), so this
// file holds only the plain data shapes the provider and the focus-card widget share.
//
// IMPORTANT — this is deliberately NOT built by fetching `GET /family/unions` and joining
// participants on a raw `identityId` client-side. That was the first design for this slice and
// was corrected mid-implementation: a client that can pair a family-graph identity id with a
// `PersonResponseDto` id can correlate an "anonymous" (redacted) participant across requests it
// shouldn't be able to resolve at all, and the mobile person/thumbnail endpoints have their own
// authorization model that a raw family-graph id was never checked against. The corrected
// contract is `GET /family/people/{personId}/relations`, which returns already-resolved,
// already-authorized `PersonResponseDto`-shaped people (or `null` + an opaque `anonymousSlot`
// for one the viewer cannot resolve) with a `relation` already derived relative to
// `{personId}` — never the viewer's own root. See `FamilyApiRepository.getFocus`.

/// Whether a family relation is a resolvable person or an unresolvable seat the viewer may not
/// see (A5). The `anonymous` variant carries no [personId] at all — not an optional field left
/// null by convention, but structurally absent, so there is nothing here for a UI bug to leak.
enum FamilyRelationKind { known, anonymous }

/// One member of a [FamilyFocus] — a parent, partner or child of the person whose page this is.
final class FamilyRelationEntry {
  // `personId` is required non-nullable here on purpose (a "known" entry always has one); the
  // field itself is nullable because `.anonymous` has none, so `this.personId` would widen this
  // constructor's parameter to `String?` too — hence the explicit initializer below instead of
  // an initializing formal.
  const FamilyRelationEntry.known({
    required String personId,
    required this.name,
    this.thumbnailPath,
    required this.relation,
  }) : kind = FamilyRelationKind.known,
       // ignore: prefer_initializing_formals
       personId = personId,
       anonymousSlot = null;

  const FamilyRelationEntry.anonymous({required this.relation, this.anonymousSlot})
    : kind = FamilyRelationKind.anonymous,
      personId = null,
      name = null,
      thumbnailPath = null;

  final FamilyRelationKind kind;

  /// Same id space as `DriftPerson.id` / `PersonResponseDto.id`. Null for an anonymous entry —
  /// structurally, not just by convention (A5).
  final String? personId;
  final String? name;
  final String? thumbnailPath;

  /// An opaque, per-union index the server sends for an anonymous seat, carrying no identity
  /// information at all — safe to use as a Flutter list key so two anonymous seats in the same
  /// row don't collide, but never a value to display or to correlate against anything else.
  final int? anonymousSlot;

  /// This entry's relation to the person whose page this is ("parent", "partner", "child", or
  /// a more specific term the server may introduce later, e.g. "ex-partner") — derived
  /// server-side, relative to the page's subject, NOT to the viewer. Also what buckets an entry
  /// into the parents/partners/children row (`buildFamilyFocus`).
  final String relation;

  bool get isAnonymous => kind == FamilyRelationKind.anonymous;

  @override
  String toString() =>
      'FamilyRelationEntry(kind: $kind, personId: $personId, name: $name, relation: $relation, anonymousSlot: $anonymousSlot)';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is FamilyRelationEntry &&
          other.kind == kind &&
          other.personId == personId &&
          other.name == name &&
          other.thumbnailPath == thumbnailPath &&
          other.anonymousSlot == anonymousSlot &&
          other.relation == relation);

  @override
  int get hashCode => Object.hash(kind, personId, name, thumbnailPath, anonymousSlot, relation);
}

/// The parents/partners/children of one person, as derived from `GET
/// /family/people/{personId}/relations`. Every list may legitimately be empty ("nothing
/// recorded yet") — a different state from `FamilyFocusUnavailable`
/// (`family_api.repository.dart`), which means "the viewer isn't allowed to see this at all"
/// (A12).
final class FamilyFocus {
  const FamilyFocus({required this.parents, required this.partners, required this.children});

  final List<FamilyRelationEntry> parents;
  final List<FamilyRelationEntry> partners;
  final List<FamilyRelationEntry> children;

  bool get isEmpty => parents.isEmpty && partners.isEmpty && children.isEmpty;
}

/// Buckets the flat `relations` list from `GET /family/people/{personId}/relations` into
/// parents/partners/children rows for the focus card.
///
/// Bucketing is on the literal `relation` string: `'parent'` and `'child'` are their own rows;
/// everything else (`'partner'`, and any more specific direct-relation term the endpoint may
/// introduce later, e.g. `'ex-partner'`) lands in the middle "partner" row, since every relation
/// this endpoint can return for `{personId}` is, by construction, one hop away — a co-partner,
/// a parent, or a child — and the only hop that isn't a parent or a child is a partner of some
/// kind. Pure and synchronous: no network, no repository.
FamilyFocus buildFamilyFocus(List<FamilyRelationEntry> relations) {
  final parents = <FamilyRelationEntry>[];
  final partners = <FamilyRelationEntry>[];
  final children = <FamilyRelationEntry>[];

  for (final entry in relations) {
    switch (entry.relation) {
      case 'parent':
        parents.add(entry);
      case 'child':
        children.add(entry);
      default:
        partners.add(entry);
    }
  }

  return FamilyFocus(parents: parents, partners: partners, children: children);
}
