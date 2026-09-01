# Family Relationships

Gallery can show how the people in your photos relate to you — not just who they are. Record who is partnered with whom and who their children are, and Gallery derives everything else: cousin, aunt, grandparent, step-parent, in-law. You never type a relative term yourself.

## How It Works

You only ever record two kinds of fact:

- **Unions** — a marriage or partnership between two people (or one, if the other parent was never photographed, or none, if you just want to say "these two are siblings").
- **Children** — attached to a union, not to a single parent.

Everything else — "your cousin", "Pierre's half-brother", "your former stepmother" — is computed at read time from those facts, from wherever the viewer is standing. Nobody records the word "cousin"; it falls out of the graph.

This also means relationships adapt to each viewer automatically. There's no single "family tree" document that someone owns, names, or shares — the graph is just a set of unions, and each person sees relationships computed relative to themselves.

## Enabling Family Relationships

Family relationships are **off by default** and gated in two layers, both independent of Shared Spaces.

### 1. Turn it on instance-wide

1. Go to **Administration** > **Settings** > **Family Relationships**.
2. Enable **Family relationships**. When off, the feature disappears entirely — no sidebar entry, no relations on the person page, no relation labels in the asset viewer — even for a user who has an explicit grant.
3. Optionally set a **Default access** level (`None`, `View`, or `Contribute`) that applies to anyone without an explicit per-user grant.

### 2. Grant access per user

In the same settings page, the **Per-user access** table lets you set an explicit access level for any user, which overrides the instance default for them:

- **None** — no family surfaces at all.
- **View** — can see relationships and derived labels, but can't edit anything.
- **Contribute** — can also drag people into unions, add children, and set union status and dates on the `/family` canvas. A contributor may edit or delete a union someone else created, so a mistaken entry isn't stuck waiting for whoever typed it.

A user with no explicit grant simply inherits the instance default — the admin table shows this state as **Inherits default**, distinct from an explicit **None**.

Admins get no automatic visibility into family data. If an admin wants to see or record relationships, they grant themselves access the same way anyone else would.

## Building the Graph

Head to **Family** in the sidebar (only visible if you have `view` or `contribute` access) to open the `/family` canvas. If your photos span more than one disconnected family, chips across the top let you switch between them — Gallery groups people into "clusters" automatically; there's nothing to name or create.

With `contribute` access, you build the graph by dragging a person's card:

| Drop the card…    | Effect                                                      |
| ----------------- | ----------------------------------------------------------- |
| **Above** a card  | Adds them as a partner in the union that card is a child of |
| **Beside** a card | Creates a new union with the two of them as partners        |
| **Below** a card  | Adds them as a child of that card's union                   |

Dropping a second parent onto an existing union joins that union rather than creating a competing one, so a family never accidentally ends up split across two records. A union renders as a pill you can click to set its status (married, partnered, separated, divorced, widowed) and start/end dates — remarriage to the same person is handled correctly as a second, distinct union.

You can also start a relationship from a person's own page: open a person, and use **Add a relationship** under the **Family** section.

## Where Relationships Show Up

Once a few unions exist, derived relationships appear in two places without any further setup:

- **Person page** — a **Family** section beneath the header lists this person's relatives with derived labels ("your aunt", "Pierre's half-brother").
- **Asset viewer people strip** — each recognized face shows how that person relates to you, right under their name, when you're looking at a photo.

Labels use neutral terms (`parent`, `sibling`, `partner`, `child`, `parent-in-law`) unless a person's gender has been set, in which case the gendered term is used instead. Gender is never guessed from a name or a photo — it's an explicit, optional field.

If Gallery can't find a direct path from you to someone, it falls back to describing them relative to the nearest person it can connect you to ("Pierre's sister") rather than showing nothing. Very distant or unusual relationships beyond Gallery's supported degree of kinship are labelled simply "relative".

## Current Limits

- **A person with no photos can't be added yet.** Family relationships reuse the identities Gallery already recognizes from faces in your library — there's no way to create a person from scratch just to place them in the tree. You can still record a union with only one known partner, or none, to capture siblings or a parent who was never photographed.
- **People you can't see appear as anonymous seats, not hidden entirely.** If a union has at least two participants you can resolve, you'll see the whole union, but any partner or child you don't otherwise have access to (for example, someone in a Shared Space you're not a member of) shows as a generic "Someone" card rather than being omitted. This keeps the structure of the family legible without disclosing a name or photo you're not entitled to see. A union with fewer than two resolvable participants doesn't appear for you at all.
- **Mobile is read-only.** You can browse relationships on a person's page and in the asset viewer on the mobile app, but building or editing the graph is web-only, on the `/family` canvas.
- **No live updates.** A co-contributor's edit to the graph appears the next time you reload — family relationships don't push real-time updates the way some other parts of Gallery do.
