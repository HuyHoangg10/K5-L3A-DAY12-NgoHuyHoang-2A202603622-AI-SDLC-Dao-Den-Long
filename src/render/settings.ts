// Settings saved between visits (volume, mouse sensitivity, colour-blind palette). Falls back to defaults if storage is blocked.
export interface Settings {
  volume: number; // 0..1
  sensitivity: number; // 0.3..2, multiplies the camera drag speed
  colorBlind: boolean;
}

const KEY = "dao-den-long-settings";
const DEFAULTS: Settings = { volume: 0.6, sensitivity: 1, colorBlind: false };

export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      volume: typeof p.volume === "number" ? Math.min(1, Math.max(0, p.volume)) : DEFAULTS.volume,
      sensitivity: typeof p.sensitivity === "number" ? Math.min(2, Math.max(0.3, p.sensitivity)) : DEFAULTS.sensitivity,
      colorBlind: p.colorBlind === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: the settings just last for this visit */
  }
}
