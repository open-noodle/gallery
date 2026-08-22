# Mobile Asset Folder Information

## Summary

Show the server-side original asset path in the mobile asset-info panel, matching the web asset viewer.

## Motivation

The mobile API model already receives `originalPath`, but the mobile cached asset model drops it and the asset-info UI only renders the filename, size, and resolution. Users therefore cannot identify the source folder from iOS or Android even though the web viewer exposes the same information.

## Scope

- Fetch the original path when the remote asset-info panel is opened.
- Show the path in the Technical Details section under a localized `Folder` row.
- Omit the row when the asset has no remote ID, the request returns no path, or the path is empty.
- Do not add the path to the cached Drift asset schema.
- Do not change server APIs, folder navigation, or local-only asset behavior.

## UX

When a remote asset has an original path, Technical Details shows:

- Existing filename, file size, and resolution row.
- A `Folder` row with the original path as its subtitle.

The path remains copyable through the existing `SheetTile` long-press behavior. If path retrieval fails, the existing asset details remain available and the new row is omitted.

## Architecture and Data Flow

1. `AssetDetails` watches `assetOriginalPathProvider` for the displayed asset.
2. The provider resolves the remote ID and calls `AssetApiRepository.getOriginalPath`.
3. The repository requests `GET /assets/{id}` and returns `AssetResponseDto.originalPath`.
4. `AssetDetails` passes the value to `TechnicalDetails`.
5. `TechnicalDetails` renders the row only for a non-empty path.

The value is fetched on demand rather than persisted because the mobile Drift asset schema does not currently carry server filesystem paths.

## Error Handling

The provider returns `null` for local-only assets or a missing API response. `AssetDetails` uses the resolved value only, so loading and error states preserve the existing details UI without adding a failure surface.

## Testing

- Provider test verifies the remote ID is sent to the API repository and the original path is returned.
- Widget test verifies a non-empty path is rendered in Technical Details.
- Existing asset-viewer widget tests remain green.

## Files Changed

| File | Change |
| --- | --- |
| `mobile/lib/repositories/asset_api.repository.dart` | Fetch `originalPath` from the asset-info endpoint. |
| `mobile/lib/providers/infrastructure/asset_viewer/asset.provider.dart` | Provide the path on demand for the current asset. |
| `mobile/lib/presentation/widgets/asset_viewer/asset_details.widget.dart` | Pass the resolved path to Technical Details. |
| `mobile/lib/presentation/widgets/asset_viewer/asset_details/technical_details.widget.dart` | Render the Folder row. |
| `mobile/test/providers/asset_viewer/asset_original_path_provider_test.dart` | Cover path retrieval. |
| `mobile/test/presentation/widgets/asset_viewer/technical_details_widget_test.dart` | Cover path rendering. |
