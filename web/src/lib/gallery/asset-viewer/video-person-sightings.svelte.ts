/**
The person whose moments in a video the info panel lists, picked with the film button on their People tile
(specs/2026-10-31-video-face-frames-design.md, Phase 2). Held with the asset it was picked on, so another asset
never shows it.
*/
export type VideoPersonSelection = { assetId: string; personId: string; name: string; faceIds: string[] };

class VideoPersonSightings {
  current = $state<VideoPersonSelection>();

  isShowing(assetId: string, personId: string) {
    return this.current?.assetId === assetId && this.current.personId === personId;
  }

  /** Shows the person, or closes their moments when they are already shown. */
  toggle(selection: VideoPersonSelection) {
    this.current = this.isShowing(selection.assetId, selection.personId) ? undefined : selection;
  }

  clear() {
    this.current = undefined;
  }
}

export const videoPersonSightings = new VideoPersonSightings();
