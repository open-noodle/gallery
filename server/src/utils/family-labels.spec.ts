import {
  deriveDirectRelations,
  deriveRelationLabel,
  FamilyGender,
  ProjectedFamilyGraph,
  ProjectedFamilyParticipant,
  ProjectedFamilyUnion,
} from 'src/utils/family-labels';
import { describe, expect, it } from 'vitest';

const known = (identityId: string): ProjectedFamilyParticipant => ({ kind: 'known', identityId });
const anonymous = (): ProjectedFamilyParticipant => ({ kind: 'anonymous' });

/**
 * The shared fixture family used by most cases below. It covers, per the
 * plan:
 *  - two parents (dad, mom) with two children (root, sam)
 *  - one parent (dad) remarried (to nina) with a third child (zack) — the
 *    half-sibling case
 *  - a sibling's partner and child (sam + samPartner -> niece1)
 *  - a partner's parent (root + jess -> jess's parent jpar1)
 *  - one anonymous participant (the unnamed partner in `u-greatgp`)
 *
 * It also extends two more generations up one branch (mgp1/mgp2 ->
 * momSister -> cousin1, and further via the anonymous great-grandparent to
 * gilda and on to deb/cody) so the same graph can exercise cousin, second
 * cousin and great-aunt degrees without a separate fixture per degree.
 */
const familyGraph: ProjectedFamilyGraph = {
  identities: {
    root: { name: 'Root Person', gender: null },
    dad: { name: 'David', gender: null },
    mom: { name: 'Mary', gender: 'female' },
    sam: { name: 'Sam', gender: 'male' },
    nina: { name: 'Nina', gender: 'female' },
    zack: { name: 'Zack Chen', gender: 'male' },
    steve: { name: 'Steve', gender: 'male' },
    jess: { name: 'Jess', gender: 'female' },
    exWife: { name: 'Erin', gender: 'female' },
    separatedPartner: { name: 'Sasha', gender: null },
    jpar1: { name: 'Joan', gender: 'female' },
    samPartner: { name: 'Sally', gender: 'female' },
    niece1: { name: 'Nia', gender: 'female' },
    zackPartner: { name: 'Wendy', gender: 'female' },
    mgp1: { name: 'Mabel', gender: 'female' },
    mgp2: { name: 'Gerald', gender: 'male' },
    momSister: { name: 'Alice', gender: 'female' },
    momSisterPartner: { name: 'Frank', gender: 'male' },
    cousin1: { name: 'Carl', gender: 'male' },
    gilda: { name: 'Gilda', gender: 'female' },
    roger: { name: 'Roger', gender: 'male' },
    rhonda: { name: 'Rhonda', gender: 'female' },
    deb: { name: 'Deb', gender: 'female' },
    doug: { name: 'Doug', gender: 'male' },
    cody: { name: 'Cody', gender: 'male' },
  },
  unions: [
    {
      id: 'u-parents',
      status: 'married',
      partners: [known('dad'), known('mom')],
      children: [known('root'), known('sam')],
    },
    { id: 'u-dad-nina', status: 'married', partners: [known('dad'), known('nina')], children: [known('zack')] },
    { id: 'u-mom-steve', status: 'married', partners: [known('mom'), known('steve')], children: [] },
    { id: 'u-root-jess', status: 'married', partners: [known('root'), known('jess')], children: [] },
    { id: 'u-root-exwife', status: 'divorced', partners: [known('root'), known('exWife')], children: [] },
    { id: 'u-root-separated', status: 'separated', partners: [known('root'), known('separatedPartner')], children: [] },
    { id: 'u-jess-parent', status: 'married', partners: [known('jpar1')], children: [known('jess')] },
    {
      id: 'u-sam-partner',
      status: 'married',
      partners: [known('sam'), known('samPartner')],
      children: [known('niece1')],
    },
    { id: 'u-zack-partner', status: 'married', partners: [known('zack'), known('zackPartner')], children: [] },
    // The one anonymous participant: this union's other partner is present but unresolvable to the
    // viewer. It is also root's great-grandparent, four generations up — the path to `gilda` (E43,
    // E47) and to `cody` (E43, second cousin) both run through this anonymous node.
    {
      id: 'u-greatgp',
      status: 'married',
      partners: [anonymous()],
      children: [known('mgp1'), known('gilda'), known('roger')],
    },
    {
      id: 'u-mgp',
      status: 'married',
      partners: [known('mgp1'), known('mgp2')],
      children: [known('mom'), known('momSister')],
    },
    {
      id: 'u-momsister-partner',
      status: 'married',
      partners: [known('momSister'), known('momSisterPartner')],
      children: [known('cousin1')],
    },
    { id: 'u-roger-rhonda', status: 'married', partners: [known('roger'), known('rhonda')], children: [known('deb')] },
    { id: 'u-deb-doug', status: 'married', partners: [known('deb'), known('doug')], children: [known('cody')] },
  ],
};

describe('deriveRelationLabel', () => {
  it('returns nothing relative when no root is set', () => {
    // E35: with no root, every derived label is null — the caller falls back to a plain name.
    expect(deriveRelationLabel(familyGraph, null, 'dad')).toBeNull();
    expect(deriveRelationLabel(familyGraph, null, 'root')).toBeNull();
  });

  it('says that is you for the root itself', () => {
    // E46
    expect(deriveRelationLabel(familyGraph, 'root', 'root')).toBe("that's you");
  });

  it('describes an unreachable person relative to the nearest person the viewer can reach', () => {
    // E36 / A10: the viewer has no nameable path to Zack's wife directly (an unrelated in-law of an
    // in-law is not one of the recognised shapes), but Zack himself is reachable (root's
    // half-brother), so the target is described relative to Zack instead of coming back blank.
    expect(deriveRelationLabel(familyGraph, 'root', 'zackPartner')).toBe("Zack Chen's wife");
  });

  it('calls a child of a different union of the same parent a half-sibling', () => {
    // E39: zack shares only dad with root, via a different union (u-dad-nina, not u-parents).
    expect(deriveRelationLabel(familyGraph, 'root', 'zack')).toBe('your half-brother');
  });

  it("calls a parent's partner who is not your parent a step-parent", () => {
    // E40: steve is mom's partner in a union that is not the one that makes mom root's parent.
    expect(deriveRelationLabel(familyGraph, 'root', 'steve')).toBe('your stepfather');
  });

  it("calls your partner's parent a parent-in-law", () => {
    // E41: jpar1 is jess's parent, and jess is root's partner.
    expect(deriveRelationLabel(familyGraph, 'root', 'jpar1')).toBe('your mother-in-law');
  });

  it('says ex-partner when the union is divorced or separated', () => {
    // E42: divorced + gendered -> "ex-wife"; separated + neutral -> "former partner". Never "wife"
    // or "partner" outright once the union has ended.
    expect(deriveRelationLabel(familyGraph, 'root', 'exWife')).toBe('your ex-wife');
    expect(deriveRelationLabel(familyGraph, 'root', 'separatedPartner')).toBe('your former partner');
  });

  it('computes cousin, second cousin and great-aunt at the right degree', () => {
    // E43: cousin1 (u=2, d=2 via mgp1/mgp2), cody (u=3, d=3 via the anonymous great-grandparent),
    // gilda (u=3, d=1 via the same anonymous great-grandparent).
    expect(deriveRelationLabel(familyGraph, 'root', 'cousin1')).toBe('your cousin');
    expect(deriveRelationLabel(familyGraph, 'root', 'cody')).toBe('your second cousin');
    expect(deriveRelationLabel(familyGraph, 'root', 'gilda')).toBe('your great-aunt');
  });

  it('describes a person reachable only through an anonymous participant without naming that participant', () => {
    // E47: the only path from root to gilda runs through the anonymous partner in `u-greatgp`. The
    // label must still be computed correctly, and must never leak any trace of that anonymous node
    // (no synthetic key, no placeholder word).
    const label = deriveRelationLabel(familyGraph, 'root', 'gilda');
    expect(label).toBe('your great-aunt');
    expect(label).not.toMatch(/anon/i);
    expect(label).not.toContain('u-greatgp');
  });

  it('says "your parent" rather than "your father" when gender is not recorded', () => {
    // E37 / A9: this is the requirement most likely to be "fixed" into a bug — the correct
    // out-of-the-box behaviour is the neutral term, not a guessed gender.
    const graph = parentFixture(null);
    expect(deriveRelationLabel(graph, 'root', 'parent')).toBe('your parent');
  });

  it('says "your father" once that person has a gender recorded', () => {
    // E38 / A9 — the paired control for the test above. Same fixture shape, only the recorded
    // gender differs, so a regression that starts inferring gender (or one that stops reading it
    // entirely) shows up as exactly one of these two tests failing.
    const graph = parentFixture('male');
    expect(deriveRelationLabel(graph, 'root', 'parent')).toBe('your father');
  });

  it('prefers the shorter path when someone is reachable two ways', () => {
    // E44: `multi` is reachable as root's half-sibling through dad (distance 2) AND as root's first
    // cousin through gpX (distance 4). The shorter, correct answer is half-sibling.
    const graph: ProjectedFamilyGraph = {
      identities: {
        root: { name: 'Root', gender: null },
        dad: { name: 'Dad', gender: null },
        momA: { name: 'MomA', gender: null },
        nina: { name: 'Nina', gender: null },
        multi: { name: 'Multi', gender: 'male' },
        auntX: { name: 'AuntX', gender: null },
        gpX: { name: 'GpX', gender: null },
      },
      unions: [
        { id: 'u1', status: 'married', partners: [known('dad'), known('momA')], children: [known('root')] },
        { id: 'u2', status: 'married', partners: [known('dad'), known('nina')], children: [known('multi')] },
        { id: 'u3', status: 'married', partners: [known('auntX')], children: [known('multi')] },
        { id: 'u4', status: 'married', partners: [known('gpX')], children: [known('momA'), known('auntX')] },
      ],
    };
    expect(deriveRelationLabel(graph, 'root', 'multi')).toBe('your half-brother');
  });

  it('returns the same label on repeated calls when two paths are equally short', () => {
    // E44, determinism: `tieCousin` is root's cousin via TWO distinct grandparents (dgp1 and
    // mgp1b), both at the same distance. Both resolve to the same term here, so this proves the
    // result is stable rather than flipping between equally-valid candidates on repeated calls.
    const graph: ProjectedFamilyGraph = {
      identities: {
        root: { name: 'Root', gender: null },
        dad2: { name: 'Dad2', gender: null },
        mom2: { name: 'Mom2', gender: null },
        dgp1: { name: 'Dgp1', gender: null },
        mgp1b: { name: 'Mgp1b', gender: null },
        uncleD: { name: 'UncleD', gender: null },
        auntM: { name: 'AuntM', gender: null },
        tieCousin: { name: 'TieCousin', gender: 'female' },
      },
      unions: [
        { id: 'u1', status: 'married', partners: [known('dad2'), known('mom2')], children: [known('root')] },
        { id: 'u2', status: 'married', partners: [known('dgp1')], children: [known('dad2'), known('uncleD')] },
        { id: 'u3', status: 'married', partners: [known('mgp1b')], children: [known('mom2'), known('auntM')] },
        { id: 'u4', status: 'married', partners: [known('uncleD'), known('auntM')], children: [known('tieCousin')] },
      ],
    };
    const first = deriveRelationLabel(graph, 'root', 'tieCousin');
    const second = deriveRelationLabel(graph, 'root', 'tieCousin');
    expect(first).toBe('your cousin');
    expect(second).toBe(first);
  });

  it('falls back to a plain relative beyond the supported degree', () => {
    // E45: root and target share a common ancestor four generations up on each side (a third
    // cousin) — well past what gets a precise name. The walk is capped, not extended.
    const graph: ProjectedFamilyGraph = {
      identities: {
        root: { name: 'Root', gender: null },
        target: { name: 'Target', gender: null },
        p1: { name: 'P1', gender: null },
        p2: { name: 'P2', gender: null },
        p3: { name: 'P3', gender: null },
        p4: { name: 'P4', gender: null },
        q1: { name: 'Q1', gender: null },
        q2: { name: 'Q2', gender: null },
        q3: { name: 'Q3', gender: null },
      },
      unions: [
        { id: 'ua', status: 'married', partners: [known('p1')], children: [known('root')] },
        { id: 'ub', status: 'married', partners: [known('p2')], children: [known('p1')] },
        { id: 'uc', status: 'married', partners: [known('p3')], children: [known('p2')] },
        { id: 'ud', status: 'married', partners: [known('p4')], children: [known('p3')] },
        { id: 'ue', status: 'married', partners: [known('q1')], children: [known('target')] },
        { id: 'uf', status: 'married', partners: [known('q2')], children: [known('q1')] },
        { id: 'ug', status: 'married', partners: [known('q3')], children: [known('q2')] },
        { id: 'uh', status: 'married', partners: [known('p4')], children: [known('q3')] },
      ],
    };
    expect(deriveRelationLabel(graph, 'root', 'target')).toBe('your relative');
  });

  it('produces no label when the only path runs through a union absent from the projected graph', () => {
    // E59: `other` is only connected to root's family through `u-half-link`, and that union has
    // been withheld from this projection (as slice 5 would do when the viewer cannot resolve
    // enough of its participants). `other` still appears in `identities` — the viewer can resolve
    // the person, just not the connecting relationship — so this must not be confused with `other`
    // simply not existing.
    const identities: Record<string, { name: string; gender: FamilyGender }> = {
      root: { name: 'Root', gender: null },
      sharedParent: { name: 'Shared', gender: null },
      other: { name: 'Other', gender: 'male' },
    };
    const rootLink: ProjectedFamilyUnion = {
      id: 'u-root-link',
      status: 'married',
      partners: [known('sharedParent')],
      children: [known('root')],
    };
    const graphWithoutUnion: ProjectedFamilyGraph = { identities, unions: [rootLink] };

    expect(deriveRelationLabel(graphWithoutUnion, 'root', 'other')).toBeNull();
  });

  it('produces the label once that union is present in the projected graph', () => {
    // E59 — the positive control for the test above, using the exact same identities and the exact
    // same `u-root-link`, with only `u-half-link` added back. Without this pairing, the negative
    // test above would pass just as well against a graph that simply has no path at all.
    const identities: Record<string, { name: string; gender: FamilyGender }> = {
      root: { name: 'Root', gender: null },
      sharedParent: { name: 'Shared', gender: null },
      other: { name: 'Other', gender: 'male' },
    };
    const rootLink: ProjectedFamilyUnion = {
      id: 'u-root-link',
      status: 'married',
      partners: [known('sharedParent')],
      children: [known('root')],
    };
    const halfLink: ProjectedFamilyUnion = {
      id: 'u-half-link',
      status: 'married',
      partners: [known('sharedParent')],
      children: [known('other')],
    };
    const graphWithUnion: ProjectedFamilyGraph = { identities, unions: [rootLink, halfLink] };

    expect(deriveRelationLabel(graphWithUnion, 'root', 'other')).toBe('your half-brother');
  });
});

/** A minimal, single-purpose fixture for the gender neutral/gendered pair (E37/E38): one parent,
 * one child, nothing else — so the only thing that can differ between the two tests is `gender`. */
function parentFixture(gender: FamilyGender): ProjectedFamilyGraph {
  return {
    identities: {
      root: { name: 'Root', gender: null },
      parent: { name: 'Pat', gender },
    },
    unions: [{ id: 'u1', status: 'married', partners: [anonymous(), known('parent')], children: [known('root')] }],
  };
}

describe('deriveDirectRelations', () => {
  it("lists every direct relation for the subject, relative to the SUBJECT (no 'your ' prefix)", () => {
    const relations = deriveDirectRelations(familyGraph, 'root');
    const byId = new Map(
      relations
        .filter((entry) => entry.participant.kind === 'known')
        .map((entry) => [(entry.participant as { identityId: string }).identityId, entry.relation]),
    );

    expect(byId.get('dad')).toBe('parent');
    expect(byId.get('mom')).toBe('mother');
    expect(byId.get('sam')).toBe('brother');
    expect(byId.get('zack')).toBe('half-brother');
    expect(byId.get('jess')).toBe('wife');
    expect(byId.get('exWife')).toBe('ex-wife');
    expect(byId.get('separatedPartner')).toBe('former partner');
  });

  it('never includes the subject in their own relations', () => {
    const relations = deriveDirectRelations(familyGraph, 'root');
    const knownIds = relations
      .filter((entry) => entry.participant.kind === 'known')
      .map((entry) => (entry.participant as { identityId: string }).identityId);

    expect(knownIds).not.toContain('root');
  });

  it('includes an anonymous participant as a null-identity seat with its per-union slot index', () => {
    // `u-greatgp`'s sole partner is anonymous, and is root's great-grandparent via mom -> mgp1.
    const relations = deriveDirectRelations(familyGraph, 'root');
    const anonymousEntry = relations.find((entry) => entry.participant.kind === 'anonymous');

    expect(anonymousEntry).toBeDefined();
    expect(anonymousEntry?.participant).toEqual({ kind: 'anonymous' });
    expect(anonymousEntry?.anonymousSlot).toBe(0);
    expect(typeof anonymousEntry?.relation).toBe('string');
  });

  it('sets anonymousSlot to null for a known participant', () => {
    const relations = deriveDirectRelations(familyGraph, 'root');
    const knownEntry = relations.find(
      (entry) => entry.participant.kind === 'known' && entry.participant.identityId === 'dad',
    );

    expect(knownEntry?.anonymousSlot).toBeNull();
  });

  it('excludes a person with no path to the subject at all — never the anchored "X\'s Y" form', () => {
    // Two disconnected clusters: `root` only relates to `partner`; `target` only relates to
    // `spouse`. Nothing connects the two clusters, so `target` must not appear in `root`'s
    // relations — not even via the "nearest anchor" phrasing `deriveRelationLabel` would use for
    // a distant VIEWER, since that phrasing never belongs on a person's own relations panel.
    const graph: ProjectedFamilyGraph = {
      identities: {
        root: { name: 'Root', gender: null },
        partner: { name: 'Partner', gender: null },
        target: { name: 'Target', gender: null },
        spouse: { name: 'Spouse', gender: null },
      },
      unions: [
        { id: 'u-root', status: 'married', partners: [known('root'), known('partner')], children: [] },
        { id: 'u-target', status: 'married', partners: [known('target'), known('spouse')], children: [] },
      ],
    };

    const relations = deriveDirectRelations(graph, 'root');
    const relatedIds = relations
      .filter((entry) => entry.participant.kind === 'known')
      .map((entry) => (entry.participant as { identityId: string }).identityId);

    expect(relatedIds).toEqual(['partner']);
    expect(relatedIds).not.toContain('target');
    expect(relatedIds).not.toContain('spouse');
  });

  it('returns an empty list for a subject with no unions at all', () => {
    expect(deriveDirectRelations(familyGraph, 'unknownPerson')).toEqual([]);
  });
});
