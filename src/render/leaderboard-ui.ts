// Leaderboard in the browser: the launcher's /api/leaderboard when it is there (data/leaderboard.json on disk),
// otherwise this browser's own storage. The rules (name, top 10, ties) are in src/leaderboard/board.ts.
import { addEntry, parseStore, type Entry } from "../leaderboard/board";

const KEY = "dao-den-long-leaderboard";
const NAME_KEY = "dao-den-long-name";

const readLocal = (): Entry[] => {
  try {
    return parseStore(JSON.parse(window.localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return [];
  }
};
const writeLocal = (e: Entry[]): void => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(e));
  } catch {
    /* storage blocked: the board lasts for this visit only */
  }
};

export const rememberedName = (): string => {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
};

async function api(init?: RequestInit): Promise<Entry[] | null> {
  try {
    const r = await fetch("/api/leaderboard", init);
    if (!r.ok) return null;
    return parseStore(await r.json());
  } catch {
    return null;
  }
}

/** Where the scores are kept right now (shown under the table). */
export let storedIn = "this browser";

export async function loadBoard(): Promise<Entry[]> {
  const fromApi = await api();
  if (fromApi) {
    storedIn = "data/leaderboard.json on this computer";
    return fromApi;
  }
  storedIn = "this browser";
  return readLocal();
}

/** Save an entry; throws on a bad name. Returns the new top 10. */
export async function saveEntry(entry: Entry): Promise<Entry[]> {
  const next = addEntry(await loadBoard(), entry); // validates the name before anything is written
  try {
    window.localStorage.setItem(NAME_KEY, entry.name);
  } catch {
    /* ignore */
  }
  const fromApi = await api({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(entry) });
  if (fromApi) {
    storedIn = "data/leaderboard.json on this computer";
    return fromApi;
  }
  storedIn = "this browser";
  writeLocal(next);
  return next;
}
