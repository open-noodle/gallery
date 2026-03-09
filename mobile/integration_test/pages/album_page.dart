import 'package:flutter/material.dart';
import 'package:patrol/patrol.dart';

/// Page object for album-related screens.
class AlbumPage {
  final PatrolIntegrationTester $;

  const AlbumPage(this.$);

  /// Create a new album from the albums tab.
  Future<void> createAlbum(String name) async {
    await $(Icons.add_rounded).tap();
    await $(TextField).first.enterText(name);
    await $('Create').tap();
    await $.pump(const Duration(seconds: 2));
  }

  /// Open an album by name.
  Future<void> openAlbum(String name) async {
    await $(name).tap();
    await $.pump(const Duration(seconds: 1));
  }

  /// Delete the currently open album.
  Future<void> deleteCurrentAlbum() async {
    await $(Icons.more_vert).tap();
    await $('Delete album').tap();
    await $('Delete').tap();
    await $.pump(const Duration(seconds: 1));
  }
}
