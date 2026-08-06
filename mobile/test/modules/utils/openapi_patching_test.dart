import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:openapi/api.dart';
import 'package:immich_mobile/utils/openapi_patching.dart';

void main() {
  group('Test OpenApi Patching', () {
    test('upgradeDto', () {
      dynamic value;
      String targetType;

      targetType = 'UserPreferencesResponseDto';
      value = jsonDecode("""
{
  "download": {
    "archiveSize": 4294967296,
    "includeEmbeddedVideos": false
  }
}
""");

      upgradeDto(value, targetType);
      expect(value['tags'], TagsResponse(enabled: false, sidebarWeb: false).toJson());
      expect(value['download']['includeEmbeddedVideos'], false);
    });

    test('addDefault', () {
      dynamic value = jsonDecode("""
{
  "download": {
    "archiveSize": 4294967296,
    "includeEmbeddedVideos": false
  }
}
""");
      String keys = 'download.unknownKey';
      dynamic defaultValue = 69420;

      addDefault(value, keys, defaultValue);
      expect(value['download']['unknownKey'], 69420);

      keys = 'alpha.beta';
      defaultValue = 'gamma';
      addDefault(value, keys, defaultValue);
      expect(value['alpha']['beta'], 'gamma');
    });

    test('addDefault with null', () {
      dynamic value = jsonDecode("""
{
  "download": {
    "archiveSize": 4294967296,
    "includeEmbeddedVideos": false
  }
}
""");
      expect(value['download']['unknownKey'], isNull);
    });

    test('agent tool response DTOs deserialize all status variants', () {
      final toolCall = {
        'id': '00000000-0000-4000-8000-000000000001',
        'sessionId': '00000000-0000-4000-8000-000000000002',
        'toolName': 'searchAssets',
        'status': 'pending_approval',
        'approvalDecision': null,
        'requestSummary': 'Search assets',
        'responseSummary': null,
        'dataClass': 'metadata',
        'assetCount': 0,
        'albumCount': 0,
        'startedAt': '2026-05-15T10:00:00.000Z',
        'completedAt': null,
        'error': null,
      };

      final approvalRequired = AgentSearchAssetsToolResponseDto.fromJson({
        'status': 'approval-required',
        'toolCall': toolCall,
      });
      expect(approvalRequired, isNotNull);
      expect(approvalRequired!.status.value, 'approval-required');
      expect(approvalRequired.reason, isNull);
      expect(approvalRequired.selectionHandle, isNull);
      expect(approvalRequired.sample, isNull);

      final denied = AgentSearchAssetsToolResponseDto.fromJson({
        'status': 'denied',
        'reason': 'Too broad',
        'toolCall': {...toolCall, 'status': 'denied'},
      });
      expect(denied, isNotNull);
      expect(denied!.status.value, 'denied');
      expect(denied.reason, 'Too broad');

      final success = AgentSearchAssetsToolResponseDto.fromJson({
        'status': 'success',
        'toolCall': {...toolCall, 'status': 'completed'},
        'summary': 'Created a selection handle for 1 asset',
        'detail': 'summary',
        'returnedCount': 1,
        'hasMore': false,
        'nextPage': null,
        'resultSize': {
          'estimatedBytes': 512,
          'hasMore': false,
          'nextPage': null,
          'omittedFields': [],
          'returnedItems': 1,
          'truncated': false,
        },
        'sample': {
          'sampleSize': 1,
          'items': [
            {'itemRef': 'item:001', 'originalFileName': 'berlin.jpg'},
          ],
        },
        'selectionHandle': {
          'id': '00000000-0000-4000-8000-000000000003',
          'sourceRef': 'asset-source:search:00000000-0000-4000-8000-000000000003',
          'assetCount': 1,
          'sourceToolCallId': '00000000-0000-4000-8000-000000000001',
          'expiresAt': '2026-05-22T10:00:00.000Z',
        },
      });
      expect(success, isNotNull);
      expect(success!.status.value, 'success');
      expect(success.reason, isNull);
      expect(success.summary, 'Created a selection handle for 1 asset');
      expect(success.detail?.value, 'summary');
      expect(success.nextPage, isNull);
      expect(success.selectionHandle?.assetCount, 1);
      expect(success.sample?.items.first.itemRef, 'item:001');
    });
  });
}
