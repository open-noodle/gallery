import { ActivityController } from 'src/controllers/activity.controller';
import { AlbumController } from 'src/controllers/album.controller';
import { ApiKeyController } from 'src/controllers/api-key.controller';
import { AppController } from 'src/controllers/app.controller';
import { AssetFilesController } from 'src/controllers/asset-file.controller';
import { AssetMediaController } from 'src/controllers/asset-media.controller';
import { AssetController } from 'src/controllers/asset.controller';
import { AuthAdminController } from 'src/controllers/auth-admin.controller';
import { AuthController } from 'src/controllers/auth.controller';
import { ClassificationController } from 'src/controllers/classification.controller';
// Option M: Gallery does not adopt upstream's cluster-groups FEATURE — cross-user recognition is
// answered by shared spaces + `face_identity`, and the fork relies on a person_group holding exactly
// one person (enforced by the unique index `person_personGroupId_key`). ClusterGroupController's
// request/accept flow is the ONLY way two users end up sharing a cluster group, so mounting it would
// be a runtime violation of that invariant waiting to happen. The controller and its service are
// carried verbatim but deliberately NOT registered.
//
// To reverse: restore the import and the array entry below, and drop `person_personGroupId_key`.
// import { ClusterGroupController } from 'src/controllers/cluster-group.controller';
import { ConfigAdminController } from 'src/controllers/config-admin.controller';
import { ConfigPublicController } from 'src/controllers/config-public.controller';
import { ConfigUserController } from 'src/controllers/config-user.controller';
import { DatabaseBackupController } from 'src/controllers/database-backup.controller';
import { DownloadController } from 'src/controllers/download.controller';
import { DuplicateController } from 'src/controllers/duplicate.controller';
import { FaceRepairAdminController } from 'src/controllers/face-repair-admin.controller';
import { FaceSuggestionController } from 'src/controllers/face-suggestion.controller';
import { FaceController } from 'src/controllers/face.controller';
import { GalleryMapController } from 'src/controllers/gallery-map.controller';
import { IntegrityAdminController } from 'src/controllers/integrity-admin.controller';
import { JobController } from 'src/controllers/job.controller';
import { LibraryManifestController } from 'src/controllers/library-manifest.controller';
import { LibraryController } from 'src/controllers/library.controller';
import { MaintenanceController } from 'src/controllers/maintenance.controller';
import { MapController } from 'src/controllers/map.controller';
import { MemoryController } from 'src/controllers/memory.controller';
import { NotificationAdminController } from 'src/controllers/notification-admin.controller';
import { NotificationController } from 'src/controllers/notification.controller';
import { OAuthController } from 'src/controllers/oauth.controller';
import { PartnerController } from 'src/controllers/partner.controller';
import { PersonController } from 'src/controllers/person.controller';
import { PluginController } from 'src/controllers/plugin.controller';
import { QueueController } from 'src/controllers/queue.controller';
import { SearchController } from 'src/controllers/search.controller';
import { ServerController } from 'src/controllers/server.controller';
import { SessionController } from 'src/controllers/session.controller';
import { SharedLinkController } from 'src/controllers/shared-link.controller';
import { SharedSpaceController } from 'src/controllers/shared-space.controller';
import { StackController } from 'src/controllers/stack.controller';
import { StorageMigrationController } from 'src/controllers/storage-migration.controller';
import { SyncController } from 'src/controllers/sync.controller';
import { SystemConfigController } from 'src/controllers/system-config.controller';
import { SystemMetadataController } from 'src/controllers/system-metadata.controller';
import { TagController } from 'src/controllers/tag.controller';
import { TimelineController } from 'src/controllers/timeline.controller';
import { TrashController } from 'src/controllers/trash.controller';
import { UserAdminController } from 'src/controllers/user-admin.controller';
import { UserGroupController } from 'src/controllers/user-group.controller';
import { UserController } from 'src/controllers/user.controller';
import { VideoStreamController } from 'src/controllers/video-stream.controller';
import { ViewController } from 'src/controllers/view.controller';
import { WorkflowController } from 'src/controllers/workflow.controller';

export const controllers = [
  ApiKeyController,
  ActivityController,
  AlbumController,
  AppController,
  AssetController,
  AssetFilesController,
  AssetMediaController,
  AuthController,
  AuthAdminController,
  // ClusterGroupController — see the note at the top of this file; intentionally not mounted.
  ClassificationController,
  ConfigUserController,
  ConfigAdminController,
  ConfigPublicController,
  DatabaseBackupController,
  DownloadController,
  DuplicateController,
  FaceController,
  FaceRepairAdminController,
  FaceSuggestionController,
  GalleryMapController,
  IntegrityAdminController,
  JobController,
  LibraryManifestController,
  LibraryController,
  MaintenanceController,
  MapController,
  MemoryController,
  NotificationController,
  NotificationAdminController,
  OAuthController,
  PartnerController,
  PersonController,
  PluginController,
  QueueController,
  SearchController,
  ServerController,
  SessionController,
  SharedLinkController,
  SharedSpaceController,
  StackController,
  StorageMigrationController,
  SyncController,
  SystemConfigController,
  SystemMetadataController,
  TagController,
  TimelineController,
  TrashController,
  UserAdminController,
  UserGroupController,
  UserController,
  VideoStreamController,
  ViewController,
  WorkflowController,
];
