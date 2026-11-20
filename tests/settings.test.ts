import { describe, expect, it } from "vitest";
import { ACTIONS, DEFAULT_BINDINGS, conflictFor, defaultSettings, keyLabel, sanitize } from "../src/render/settings";

describe("settings", () => {
  it("defaults: arrows move, Space jumps, Shift dashes, E interacts, Q glows, P pauses; no two actions share a key", () => {
    expect(DEFAULT_BINDINGS).toEqual({ up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright", jump: " ", dash: "shift", interact: "e", pulse: "q", pause: "p" });
    expect(new Set(ACTIONS.map((a) => DEFAULT_BINDINGS[a])).size).toBe(ACTIONS.length);
    expect(ACTIONS).toHaveLength(9);
  });
  it("garbage or missing data gives the defaults", () => {
    expect(sanitize(null)).toEqual(defaultSettings());
    expect(sanitize("nope" as never)).toEqual(defaultSettings());
    expect(sanitize({})).toEqual(defaultSettings());
  });
  it("volume and sensitivity are clamped; flags are booleans", () => {
    const s = sanitize({ volume: 7, sensitivity: -3, reduceMotion: true, largeText: true, subtitles: false });
    expect(s).toMatchObject({ volume: 1, sensitivity: 0.3, reduceMotion: true, largeText: true, subtitles: false });
    expect(sanitize({ volume: Number.NaN }).volume).toBe(defaultSettings().volume);
  });
  it("saved bindings are kept (lower-cased) when they are valid", () => {
    const s = sanitize({ bindings: { ...DEFAULT_BINDINGS, jump: "J", dash: "k" } });
    expect(s.bindings.jump).toBe("j");
    expect(s.bindings.dash).toBe("k");
  });
  it("a saved duplicate key is not accepted: the bindings go back to the defaults", () => {
    const s = sanitize({ bindings: { ...DEFAULT_BINDINGS, jump: "e" } });
    expect(s.bindings).toEqual(DEFAULT_BINDINGS);
  });
  it("conflictFor names the action that already owns the key", () => {
    expect(conflictFor(DEFAULT_BINDINGS, "jump", "E")).toBe("interact");
    expect(conflictFor(DEFAULT_BINDINGS, "jump", "x")).toBeNull();
    expect(conflictFor(DEFAULT_BINDINGS, "jump", " ")).toBeNull(); // its own key is not a conflict
  });
  it("key labels are readable", () => {
    expect(keyLabel(" ")).toBe("Space");
    expect(keyLabel("arrowleft")).toBe("Left");
    expect(keyLabel("x")).toBe("X");
  });
});
