// Shared visibility helpers for mobile timeline queries.
//
// Mirrors the main-timeline filter in merged_asset.drift: an asset is visible
// to a viewer if it's owned by one of the viewer's timeline users (self +
// partners with inTimeline=true), OR if it's linked to a shared space whose
// member row for the viewer has showInTimeline=true (directly via
// shared_space_asset, or transitively via shared_space_library).
//
// Two functions, one per Drift access mode:
//   * buildViewerVisibilityJoins — for .watch() bucket queries. Returns
//     real LEFT OUTER JOINs so Drift's readsFrom set tracks the tables
//     (isInQuery subqueries silently break .watch() reactivity).
//   * viewerVisibilityPredicate — for .get() asset-list and marker queries.
//     Returns an Expression<bool> composed from isInQuery subqueries. No
//     reactivity concern, and isInQuery naturally deduplicates.
//
// See docs/plans/2026-04-12-mobile-timeline-space-visibility-design.md for
// the full rationale and the .drift-SQL fallback plan.

import 'package:drift/drift.dart';
import 'package:immich_mobile/infrastructure/entities/remote_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_member.entity.drift.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';

typedef ViewerVisibilityJoinSpec = ({
  List<Join> joins,
  $SharedSpaceMemberEntityTable assetMember,
  $SharedSpaceMemberEntityTable libraryMember,
});

/// Builds the four LEFT OUTER JOINs needed to evaluate shared-space visibility
/// against an asset row, plus the two aliased `shared_space_member` tables the
/// caller uses to write the WHERE predicate.
///
/// Use for `.watch()` bucket queries where Drift reactivity must track the
/// shared_space_* tables. Caller merges the returned `joins` into its own
/// `.join([...existing, ...viz.joins])` call and adds
/// `viz.assetMember.userId.isNotNull() | viz.libraryMember.userId.isNotNull()`
/// to its WHERE predicate (OR-ed with `rae.ownerId.isIn(userIds)`).
ViewerVisibilityJoinSpec buildViewerVisibilityJoins(
  Drift db,
  $RemoteAssetEntityTable assetTable,
  String currentUserId,
) {
  final assetMember = db.alias(db.sharedSpaceMemberEntity, 'ssm_asset');
  final libraryMember = db.alias(db.sharedSpaceMemberEntity, 'ssm_lib');

  final joins = <Join>[
    leftOuterJoin(
      db.sharedSpaceAssetEntity,
      db.sharedSpaceAssetEntity.assetId.equalsExp(assetTable.id),
      useColumns: false,
    ),
    leftOuterJoin(
      assetMember,
      assetMember.spaceId.equalsExp(db.sharedSpaceAssetEntity.spaceId) &
          assetMember.userId.equals(currentUserId) &
          assetMember.showInTimeline.equals(true),
      useColumns: false,
    ),
    leftOuterJoin(
      db.sharedSpaceLibraryEntity,
      db.sharedSpaceLibraryEntity.libraryId.equalsExp(assetTable.libraryId),
      useColumns: false,
    ),
    leftOuterJoin(
      libraryMember,
      libraryMember.spaceId.equalsExp(db.sharedSpaceLibraryEntity.spaceId) &
          libraryMember.userId.equals(currentUserId) &
          libraryMember.showInTimeline.equals(true),
      useColumns: false,
    ),
  ];

  return (joins: joins, assetMember: assetMember, libraryMember: libraryMember);
}

/// Returns an `Expression<bool>` matching assets visible to the viewer:
/// `ownerId IN userIds`, OR the asset is linked to a shared space (direct or
/// via library) whose member row for `currentUserId` has `showInTimeline=true`.
///
/// Use for `.get()` asset-list and marker queries where Drift reactivity is
/// irrelevant (one-shot futures). `isInQuery` naturally deduplicates.
Expression<bool> viewerVisibilityPredicate(
  Drift db,
  $RemoteAssetEntityTable assetTable,
  List<String> userIds,
  String currentUserId,
) {
  final inSpaceAsset = assetTable.id.isInQuery(
    db.sharedSpaceAssetEntity.selectOnly()
      ..addColumns([db.sharedSpaceAssetEntity.assetId])
      ..join([
        innerJoin(
          db.sharedSpaceMemberEntity,
          db.sharedSpaceMemberEntity.spaceId.equalsExp(db.sharedSpaceAssetEntity.spaceId) &
              db.sharedSpaceMemberEntity.userId.equals(currentUserId) &
              db.sharedSpaceMemberEntity.showInTimeline.equals(true),
          useColumns: false,
        ),
      ]),
  );

  final inSpaceLibrary = assetTable.libraryId.isInQuery(
    db.sharedSpaceLibraryEntity.selectOnly()
      ..addColumns([db.sharedSpaceLibraryEntity.libraryId])
      ..join([
        innerJoin(
          db.sharedSpaceMemberEntity,
          db.sharedSpaceMemberEntity.spaceId.equalsExp(db.sharedSpaceLibraryEntity.spaceId) &
              db.sharedSpaceMemberEntity.userId.equals(currentUserId) &
              db.sharedSpaceMemberEntity.showInTimeline.equals(true),
          useColumns: false,
        ),
      ]),
  );

  return assetTable.ownerId.isIn(userIds) | inSpaceAsset | inSpaceLibrary;
}
