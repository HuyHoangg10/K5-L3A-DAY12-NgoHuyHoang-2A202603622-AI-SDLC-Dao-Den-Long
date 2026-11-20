// Settings saved between visits: volume, mouse sensitivity, colour set, key bindings, reduce motion, big text, subtitles.
// Falls back to defaults if storage is blocked.

export type Action = "up" | "down" | "left" | "right" | "jump" | "dash" | "interact" | "pulse" | "pause";
export const ACTIONS: Action[] = ["up", "down", "left", "right", "jump", "dash", "interact", "pulse", "pause"];
export const ACTION_LABEL: Record<Action, string> = {
  up: "Move up",
  down: "Move down",
  left: "Move left",
  right: "Move right",
  jump: "Jump",
  dash: "Dash",
  interact: "Put fireflies in a lantern",
  pulse: "Glow",
  pause: "Pause",
};
/** Keys are stored as `KeyboardEvent.key` in lower case ("arrowup", " ", "shift", "q"). */
export const DEFAULT_BINDINGS: Record<Action, string> = {
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  jump: " ",
  dash: "shift",
  interact: "e",
  pulse: "q",
  pause: "p",
};

export interface Settings {
  volume: number; // 0..1
  sensitivity: number; // 0.3..2, multiplies the camera drag speed
  colorBlind: boolean;
  reduceMotion: boolean; // no camera shake, no screen flash
  largeText: boolean; // x1.25
  subtitles: boolean; // visual cues for sounds
  bindings: Record<Action, string>;
}

const KEY = "dao-den-long-settings";
export const defaultSettings = (): Settings => ({
  volume: 0.6,
  sensitivity: 1,
  colorBlind: false,
  reduceMotion: false,
  largeText: false,
  subtitles: true,
  bindings: { ...DEFAULT_BINDINGS },
});

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** Turn whatever was stored into valid settings (bad or duplicate bindings fall back to the defaults). */
export function sanitize(p: Partial<Settings> | null | undefined): Settings {
  const d = defaultSettings();
  if (!p || typeof p !== "object") return d;
  const bindings = { ...DEFAULT_BINDINGS };
  const stored = (p.bindings ?? {}) as Partial<Record<Action, unknown>>;
  for (const a of ACTIONS) if (typeof stored[a] === "string" && (stored[a] as string).length > 0) bindings[a] = (stored[a] as string).toLowerCase();
  const seen = new Set<string>();
  for (const a of ACTIONS) {
    if (seen.has(bindings[a])) return { ...d, volume: clamp(p.volume, 0, 1, d.volume), sensitivity: clamp(p.sensitivity, 0.3, 2, d.sensitivity) }; // a conflict was saved: restore the keys
    seen.add(bindings[a]);
  }
  return {
    volume: clamp(p.volume, 0, 1, d.volume),
    sensitivity: clamp(p.sensitivity, 0.3, 2, d.sensitivity),
    colorBlind: p.colorBlind === true,
    reduceMotion: p.reduceMotion === true,
    largeText: p.largeText === true,
    subtitles: p.subtitles !== false,
    bindings,
  };
}

/** Which other action already uses this key? (to warn before a duplicate is accepted) */
export function conflictFor(bindings: Record<Action, string>, action: Action, key: string): Action | null {
  return ACTIONS.find((a) => a !== action && bindings[a] === key.toLowerCase()) ?? null;
}

export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw) as Partial<Settings>) : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: the settings just last for this visit */
  }
}

export const keyLabel = (k: string): string =>
  ({ " ": "Space", arrowup: "Up", arrowdown: "Down", arrowleft: "Left", arrowright: "Right", shift: "Shift", escape: "Esc", enter: "Enter" } as Record<string, string>)[k] ?? k.toUpperCase();
