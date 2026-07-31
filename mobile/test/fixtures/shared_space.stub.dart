import 'package:openapi/api.dart';

abstract final class SharedSpaceMemberStub {
  const SharedSpaceMemberStub._();

  static final owner = SharedSpaceMemberResponseDto(
    userId: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
    role: SharedSpaceRole.owner,
    joinedAt: '2024-01-01T00:00:00Z',
    sharePersonMetadata: true,
    showInTimeline: true,
    avatarColor: const Optional.present('green'),
    contributionCount: const Optional.present(42),
    profileChangedAt: const Optional.present('2024-01-01T00:00:00Z'),
  );

  static final editor = SharedSpaceMemberResponseDto(
    userId: 'user-2',
    name: 'Bob',
    email: 'bob@example.com',
    role: SharedSpaceRole.editor,
    joinedAt: '2024-02-01T00:00:00Z',
    sharePersonMetadata: true,
    showInTimeline: true,
    avatarColor: const Optional.present('red'),
    contributionCount: const Optional.present(15),
    profileChangedAt: const Optional.present('2024-02-01T00:00:00Z'),
  );

  static final viewer = SharedSpaceMemberResponseDto(
    userId: 'user-3',
    name: 'Charlie',
    email: 'charlie@example.com',
    role: SharedSpaceRole.viewer,
    joinedAt: '2024-03-01T00:00:00Z',
    sharePersonMetadata: true,
    showInTimeline: false,
    avatarColor: const Optional.present('blue'),
    contributionCount: const Optional.present(0),
    profileChangedAt: const Optional.present('2024-03-01T00:00:00Z'),
  );
}

abstract final class SharedSpaceStub {
  const SharedSpaceStub._();

  static final space1 = SharedSpaceResponseDto(
    id: 'space-1',
    name: 'Family Photos',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-15T00:00:00Z',
    createdById: 'user-1',
    description: const Optional.present('Shared family photo collection'),
    color: const Optional.present(UserAvatarColor.blue),
    assetCount: const Optional.present(150),
    memberCount: const Optional.present(3),
    faceRecognitionEnabled: const Optional.present(true),
  );

  static final space2 = SharedSpaceResponseDto(
    id: 'space-2',
    name: 'Travel 2024',
    createdAt: '2024-06-01T00:00:00Z',
    updatedAt: '2024-06-10T00:00:00Z',
    createdById: 'user-2',
    color: const Optional.present(UserAvatarColor.green),
    assetCount: const Optional.present(42),
    memberCount: const Optional.present(2),
    faceRecognitionEnabled: const Optional.present(false),
  );

  static final spaceWithMembers = SharedSpaceResponseDto(
    id: 'space-3',
    name: 'Team Project',
    createdAt: '2024-03-01T00:00:00Z',
    updatedAt: '2024-03-20T00:00:00Z',
    createdById: 'user-1',
    description: const Optional.present('Team collaboration space'),
    color: const Optional.present(UserAvatarColor.purple),
    assetCount: const Optional.present(300),
    memberCount: const Optional.present(3),
    members: Optional.present([
      SharedSpaceMemberStub.owner,
      SharedSpaceMemberStub.editor,
      SharedSpaceMemberStub.viewer,
    ]),
    faceRecognitionEnabled: const Optional.present(true),
    thumbnailAssetId: const Optional.present('asset-thumbnail-1'),
    thumbnailCropY: const Optional.present(50),
    lastActivityAt: const Optional.present('2024-03-20T12:00:00Z'),
    lastContributor: Optional.present(SharedSpaceResponseDtoLastContributor(id: 'user-2', name: 'Bob')),
    recentAssetIds: const Optional.present(['asset-1', 'asset-2', 'asset-3', 'asset-4']),
    recentAssetThumbhashes: const Optional.present(['hash-1', 'hash-2', 'hash-3', 'hash-4']),
    newAssetCount: const Optional.present(5),
  );

  static final emptySpace = SharedSpaceResponseDto(
    id: 'space-empty',
    name: 'Empty Space',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    createdById: 'user-1',
    assetCount: const Optional.present(0),
    memberCount: const Optional.present(1),
  );
}
