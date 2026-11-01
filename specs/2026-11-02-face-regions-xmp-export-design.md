# Face Regions MWG-rs XMP Sidecar Export Design

## Overview

Immich and Noodle Gallery natively support importing face bounding boxes and names from XMP sidecars
adhering to the Metadata Working Group (`mwg-rs`) schema (`RegionInfo`). However, face recognition annotations
generated within the platform remained locked inside the database and were never written out to sidecar
files during sidecar generation (`handleSidecarWrite`).

This adds native, bidirectional MWG-rs compliant face export to XMP sidecars. Users managing libraries across
desktop photography tools (Adobe Lightroom, digiKam, Apple Photos, ExifTool) can export and retain their face
tags without proprietary lock-in.

## Decisions

- **Layering invariant preserved:** Core coordinate transformation logic and ExifTool argument synthesis live
  in `server/src/gallery/utils/face-region.util.ts`. Upstream `metadata.service.ts` carries only a single call
  hook gating face extraction on the configuration toggle.
- **Config extension via `GalleryServerExtension`:** The admin toggle `faces.export` is defined in
  `server/src/gallery/dtos/config.dto.ts` and spread into `AdminConfigFacesDto`. It defaults to `false` out of the box,
  maintaining identical behavior to stock Immich.
- **Exact mathematical inversion of EXIF orientations:** Immich normalizes coordinates relative to the upright display
  viewport. The exporter reverses all 8 EXIF orientation transformations (mirroring, 90°/180°/270° CW rotations, and
  sidewards dimension swapping) so coordinates map to the un-rotated physical sensor pixels expected by external tools.
- **StorageBackend & S3 compatibility:** S3-backed installations cannot run ExifTool directly against remote object keys.
  Face sidecar writing adheres to the `ensureLocalFile` staging pattern: download existing XMP to temporary disk,
  execute atomic ExifTool write with MWG-rs flags, upload result back to `StorageBackend`, and unlink local temporary files.
- **Privacy boundary:** Only visible, non-hidden, and named face regions are written to sidecars. Unnamed or hidden
  cluster faces are excluded to prevent metadata clutter and privacy leaks.

## Coordinate Normalization & Inversion

Face coordinates in `asset_face` are stored as absolute bounding boxes `[boundingBoxX1, boundingBoxY1, boundingBoxX2, boundingBoxY2]`.
The exporter calculates normalized center coordinates and dimensions:

$$\text{cx} = \frac{x_1 + x_2}{2 \cdot W}, \quad \text{cy} = \frac{y_1 + y_2}{2 \cdot H}, \quad w = \frac{|x_2 - x_1|}{W}, \quad h = \frac{|y_2 - y_1|}{H}$$

For sidewards orientations (EXIF 5, 6, 7, 8), dimensions $W$ and $H$ are swapped, and coordinates are inverted using the inverse rotation matrix before serialization to `-RegionAreaX+=`, `-RegionAreaY+=`, `-RegionAreaW+=`, `-RegionAreaH+=`, and `-RegionName+=`.

## Failure Semantics

- **ExifTool errors:** Any ExifTool warning or failure is trapped and logged to `LoggingRepository` without aborting the parent sidecar generation job.
- **Unassigned or zero dimensions:** Assets lacking valid dimension metadata fail gracefully by returning `null` from `toMwgRegionInfo`, skipping face tags and preserving standard EXIF tags.

