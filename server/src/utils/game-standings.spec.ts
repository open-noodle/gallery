import { compareStandings, StandingsSortable } from 'src/utils/game-standings';

const entry = (name: string, total: number, played: number): StandingsSortable => ({ name, total, played });

describe('compareStandings', () => {
  it('orders by total, highest first', () => {
    const rows = [entry('Ana', 4200, 5), entry('Ben', 9100, 5), entry('Cara', 700, 5)];

    expect(rows.sort(compareStandings).map((row) => row.name)).toEqual(['Ben', 'Ana', 'Cara']);
  });

  it('breaks a tie on total by fewer rounds played, which is the better performance', () => {
    const rows = [entry('Ana', 4200, 5), entry('Ben', 4200, 3)];

    expect(rows.sort(compareStandings).map((row) => row.name)).toEqual(['Ben', 'Ana']);
  });

  it('breaks a full tie by name, so the order is stable across requests', () => {
    const rows = [entry('Cara', 4200, 5), entry('Ana', 4200, 5), entry('Ben', 4200, 5)];

    expect(rows.sort(compareStandings).map((row) => row.name)).toEqual(['Ana', 'Ben', 'Cara']);
  });

  it('ranks a member who played and scored nothing ABOVE a member who never played', () => {
    // The case the explicit never-played step exists for: scoreFromError floors at 0, so a real
    // player can hold total 0. Without step 1 the `played` ascending tie-break below would put
    // played:0 first and rank the no-show above the person who turned up.
    const rows = [entry('Ana', 0, 0), entry('Ben', 0, 1)];

    expect(rows.sort(compareStandings).map((row) => row.name)).toEqual(['Ben', 'Ana']);
  });

  it('keeps every member who never played at the bottom, whatever their name', () => {
    const rows = [entry('Zoe', 0, 0), entry('Ana', 0, 0), entry('Ben', 120, 1)];

    expect(rows.sort(compareStandings).map((row) => row.name)).toEqual(['Ben', 'Ana', 'Zoe']);
  });
});
