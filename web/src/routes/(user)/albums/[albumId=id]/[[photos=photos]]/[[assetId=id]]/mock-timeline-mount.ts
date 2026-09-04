// #1041: mount counter for the Timeline stub, rendered as `timeline-mount-id`.
//
// A spec asserting a keyed reload needs to distinguish "remounted" (fresh TimelineManager, buckets
// re-fetched from the server) from "re-rendered with new props" — no other stub output tells those
// apart, and the bug being guarded is precisely a timeline that re-rendered without re-fetching.
//
// Lives in a `.ts` module rather than the stub's `<script module>` because `tsc --noEmit` resolves
// `.svelte` imports through an ambient declaration that exposes only a default export, so a named
// export from a component's module context fails the type check even though Vite resolves it.
const mountState = { seq: 0 };

/** Called once per Timeline stub instantiation. */
export const nextTimelineMountId = (): number => ++mountState.seq;

/** Reset between tests so mount ids are comparable within a spec. */
export const resetTimelineMountSeq = (): void => {
  mountState.seq = 0;
};
