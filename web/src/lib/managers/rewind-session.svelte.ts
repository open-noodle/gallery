import { CleanupQueue, type CleanupCommitDto, type CleanupCommitResponseDto } from '@immich/sdk';
import { SvelteMap } from 'svelte/reactivity';
import { chunk } from '$lib/utils/cleanup';

export type RewindMark = 'keep' | 'fav' | 'trash';
export type RewindCommitResult = { trashed: string[]; skipped: number };

type CommitFn = (dto: CleanupCommitDto) => Promise<CleanupCommitResponseDto>;
type MarkChange = [id: string, mark: RewindMark | undefined];

const CYCLE: Array<RewindMark | undefined> = [undefined, 'keep', 'fav', 'trash'];
const MAX_IDS = 1000;

/**
 * Holds the local keep / favourite / trash marks of one rewind date. Nothing reaches the server
 * until `commitTrash` or `finishDay`, so marking is cheap and every step can be undone.
 */
export class RewindSession {
  readonly marks = new SvelteMap<string, RewindMark>();
  focusedId = $state<string | null>(null);
  progress = $state<{ done: number; total: number } | null>(null);
  #history: MarkChange[][] = [];

  constructor(
    public readonly monthDay: number,
    private readonly commitFn: CommitFn,
  ) {}

  get counts() {
    const counts = { keep: 0, fav: 0, trash: 0 };
    for (const mark of this.marks.values()) {
      counts[mark]++;
    }
    return counts;
  }

  get hasUncommitted() {
    return this.marks.size > 0;
  }

  #apply(changes: MarkChange[]) {
    for (const [id, mark] of changes) {
      if (mark) {
        this.marks.set(id, mark);
      } else {
        this.marks.delete(id);
      }
    }
  }

  #set(changes: MarkChange[]) {
    this.#history.push(changes.map(([id]) => [id, this.marks.get(id)]));
    this.#apply(changes);
  }

  mark(id: string, kind: RewindMark) {
    this.#set([[id, kind]]);
  }

  markMany(ids: string[], kind: RewindMark) {
    if (ids.length > 0) {
      this.#set(ids.map((id) => [id, kind]));
    }
  }

  cycle(id: string) {
    const next = CYCLE[(CYCLE.indexOf(this.marks.get(id)) + 1) % CYCLE.length];
    this.#set([[id, next]]);
  }

  undo() {
    const previous = this.#history.pop();
    if (previous) {
      this.#apply(previous);
    }
  }

  #ids(kind: RewindMark) {
    return [...this.marks].filter(([, mark]) => mark === kind).map(([id]) => id);
  }

  async #send(
    lists: { trash: string[]; fav: string[]; keep: string[] },
    completeMonthDay?: number,
  ): Promise<RewindCommitResult> {
    const trash = chunk(lists.trash, MAX_IDS);
    const fav = chunk(lists.fav, MAX_IDS);
    const keep = chunk(lists.keep, MAX_IDS);
    const calls = Math.max(1, trash.length, fav.length, keep.length);
    const trashed: string[] = [];
    let skipped = 0;
    this.progress = { done: 0, total: calls };
    try {
      for (let i = 0; i < calls; i++) {
        const dto: CleanupCommitDto = {
          queue: CleanupQueue.Rewind,
          trashIds: trash[i] ?? [],
          favoriteIds: fav[i] ?? [],
          keepIds: keep[i] ?? [],
        };
        // The day is only complete once every mark has landed, so only the last request says so.
        if (completeMonthDay !== undefined && i === calls - 1) {
          dto.completeMonthDay = completeMonthDay;
        }
        const response = await this.commitFn(dto);
        trashed.push(...response.trashed);
        skipped += response.skipped.length;
        this.progress = { done: i + 1, total: calls };
      }
    } finally {
      this.progress = null;
    }
    return { trashed, skipped };
  }

  /** Sends only the trash marks, then clears them; keep and favourite marks stay local. */
  async commitTrash() {
    const ids = this.#ids('trash');
    const result = await this.#send({ trash: ids, fav: [], keep: [] });
    for (const id of ids) {
      this.marks.delete(id);
    }
    this.#history = [];
    return result;
  }

  /** Sends every mark and completes the date, then clears the session. */
  async finishDay() {
    const result = await this.#send(
      { trash: this.#ids('trash'), fav: this.#ids('fav'), keep: this.#ids('keep') },
      this.monthDay,
    );
    this.marks.clear();
    this.#history = [];
    return result;
  }
}
