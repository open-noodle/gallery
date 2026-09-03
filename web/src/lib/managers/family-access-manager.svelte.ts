import { getMyRoot } from '@immich/sdk';

// Gallery-fork: family relationships (slice 10). There is no endpoint that reports the caller's
// own effective family access level (`view` vs `contribute` vs `none`) directly — the server
// exposes capability only as a pass/fail on each individual endpoint (`FamilyService.
// requireFamilyRead` / `requireFamilyWrite`, both 403 on refusal). `GET /family/me` requires only
// `view` (D4: reading back your own root discloses nothing about anyone else), so it is the
// cheapest safe probe for "is the caller granted at least `view`" — a 200 means yes, a 403 means
// `none`. This deliberately cannot distinguish `view` from `contribute`; see the slice 10 report
// for why the empty-seat "+ Add a parent" affordance (A6) defaults to hidden until a slice with a
// real signal (slice 11, which needs the same distinction for its own drop-zone gating) wires one
// up.
class FamilyAccessManager {
  #granted = $state<boolean>();

  /** `true`/`false` once resolved; `undefined` before `init()` has completed. Consumers that must
   * not flash the family sidebar item before this resolves should read `grantedOrUndefined` and
   * treat `undefined` as "hidden", never as `true`. */
  get granted(): boolean {
    return this.#granted ?? false;
  }

  get grantedOrUndefined(): boolean | undefined {
    return this.#granted;
  }

  async init(): Promise<void> {
    try {
      await getMyRoot();
      this.#granted = true;
    } catch {
      this.#granted = false;
    }
  }
}

export const familyAccessManager = new FamilyAccessManager();
