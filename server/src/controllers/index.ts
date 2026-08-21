import { ActivityController } from 'src/controllers/activity.controller.js';
import { AlbumController } from 'src/controllers/album.controller.js';
import { ApiKeyController } from 'src/controllers/api-key.controller.js';
import { AppController } from 'src/controllers/app.controller.js';
import { AssetFilesController } from 'src/controllers/asset-file.controller.js';
import { AssetMediaController } from 'src/controllers/asset-media.controller.js';
import { AssetController } from 'src/controllers/asset.controller.js';
import { AuthAdminController } from 'src/controllers/auth-admin.controller.js';
import { AuthController } from 'src/controllers/auth.controller.js';
// Option M: Gallery does not adopt upstream's cluster-groups FEATURE — cross-user recognition is
// answered by shared spaces + `face_identity`, and the fork relies on a person_group holding exactly
// one person (enforced by the unique index `person_personGroupId_key`). ClusterGroupController's
// request/accept flow is the ONLY way two users end up sharing a cluster group, so mounting it would
// be a runtime violation of that invariant waiting to happen. The controller and its service are
// carried verbatim but deliberately NOT registered.
//
// To reverse: restore the import and the array entry below, and drop `person_personGroupId_key`.
// import { ClusterGroupController } from 'src/controllers/cluster-group.controller.js';
import { ConfigAdminController } from 'src/controllers/config-admin.controller.js';
import { ConfigPublicController } from 'src/controllers/config-public.controller.js';
import { ConfigUserController } from 'src/controllers/config-user.controller.js';
import { DatabaseBackupController } from 'src/controllers/database-backup.controller.js';
import { DownloadController } from 'src/controllers/download.controller.js';
import { DuplicateController } from 'src/controllers/duplicate.controller.js';
import { FaceRepairAdminController } from 'src/controllers/face-repair-admin.controller.js';
import { FaceSuggestionController } from 'src/controllers/face-suggestion.controller.js';
import { FaceController } from 'src/controllers/face.controller.js';
import { GalleryMapController } from 'src/controllers/gallery-map.controller.js';
import { IntegrityAdminController } from 'src/controllers/integrity-admin.controller.js';
import { JobController } from 'src/controllers/job.controller.js';
import { LibraryManifestController } from 'src/controllers/library-manifest.controller.js';
import { LibraryController } from 'src/controllers/library.controller.js';
import { MaintenanceController } from 'src/controllers/maintenance.controller.js';
import { MapController } from 'src/controllers/map.controller.js';
import { MemoryController } from 'src/controllers/memory.controller.js';
import { NotificationAdminController } from 'src/controllers/notification-admin.controller.js';
import { NotificationController } from 'src/controllers/notification.controller.js';
import { OAuthController } from 'src/controllers/oauth.controller.js';
import { PartnerController } from 'src/controllers/partner.controller.js';
import { PersonController } from 'src/controllers/person.controller.js';
import { PluginController } from 'src/controllers/plugin.controller.js';
import { QueueController } from 'src/controllers/queue.controller.js';
import { SearchController } from 'src/controllers/search.controller.js';
import { ServerController } from 'src/controllers/server.controller.js';
import { SessionController } from 'src/controllers/session.controller.js';
import { SharedLinkController } from 'src/controllers/shared-link.controller.js';
import { StackController } from 'src/controllers/stack.controller.js';
import { SyncController } from 'src/controllers/sync.controller.js';
import { SystemConfigController } from 'src/controllers/system-config.controller.js';
import { SystemMetadataController } from 'src/controllers/system-metadata.controller.js';
import { TagController } from 'src/controllers/tag.controller.js';
import { TimelineController } from 'src/controllers/timeline.controller.js';
import { TrashController } from 'src/controllers/trash.controller.js';
import { UserAdminController } from 'src/controllers/user-admin.controller.js';
import { UserController } from 'src/controllers/user.controller.js';
import { VideoStreamController } from 'src/controllers/video-stream.controller.js';
import { ViewController } from 'src/controllers/view.controller.js';
import { WorkflowController } from 'src/controllers/workflow.controller.js';
import { SharedSpaceController } from 'src/controllers/shared-space.controller.js';
import { StorageMigrationController } from 'src/controllers/storage-migration.controller.js';
import { UserGroupController } from 'src/controllers/user-group.controller.js';
import { ClassificationController } from 'src/controllers/classification.controller.js';

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
