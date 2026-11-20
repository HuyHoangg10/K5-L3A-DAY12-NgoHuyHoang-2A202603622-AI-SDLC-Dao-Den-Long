// Local leaderboard rules (Ticket-04 part 3): names, entries, top 10. Pure functions, used by the game, the server and the tests.

export interface Entry {
  name: string;
  score: number; // total of the nights won
  nights_won: number; // 0-3
  achieved_at: string; // ISO 8601 with time zone
  seed: number;
}

export const MAX_ENTRIES = 10;

/** 3-12 characters: Latin letters (Vietnamese diacritics included), digits, underscore. */
export function validName(name: string): boolean {
  return /^[\p{Script=Latin}0-9_]{3,12}$/u.test(name);
}

const isEntry = (e: unknown): e is Entry => {
  const x = e as Partial<Entry> | null;
  return (
    !!x &&
    typeof x.name === "string" &&
    validName(x.name) &&
    Number.isFinite(x.score) &&
    Number.isInteger(x.nights_won) &&
    (x.nights_won as number) >= 0 &&
    (x.nights_won as number) <= 3 &&
    typeof x.achieved_at === "string" &&
    !Number.isNaN(Date.parse(x.achieved_at)) &&
    Number.isFinite(x.seed)
  );
};

/** Sort by score (high first); equal scores: the earlier entry stays on top. Keeps the top 10. */
export function normalise(entries: Entry[]): Entry[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.score - a.e.score || Date.parse(a.e.achieved_at) - Date.parse(b.e.achieved_at) || a.i - b.i)
    .slice(0, MAX_ENTRIES)
    .map((x) => x.e);
}

/** Add an entry (returns the new list; throws on a bad name). */
export function addEntry(entries: Entry[], entry: Entry): Entry[] {
  if (!validName(entry.name)) throw new Error("name must be 3-12 letters, digits or underscore");
  return normalise([...entries, entry]);
}

/** Read whatever a store holds: {entries: [...]} or a bare array. Bad rows are dropped. */
export function parseStore(raw: unknown): Entry[] {
  const list = Array.isArray(raw) ? raw : (raw as { entries?: unknown } | null)?.entries;
  return normalise(Array.isArray(list) ? list.filter(isEntry) : []);
}

export const exportJson = (entries: Entry[]): string => JSON.stringify({ entries: normalise(entries) }, null, 2) + "\n";
