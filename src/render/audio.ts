// Sound made in the browser with WebAudio: a soft night pad plus short effects. No audio files.
import type { Settings } from "./settings";

type Sfx = "pickup" | "deposit" | "lit" | "pulse" | "hit" | "jump" | "dash" | "win" | "lose" | "spawn" | "tick" | "charm" | "steal" | "fall";

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicTimer = 0;
  private step = 0;
  private fast = false;

  constructor(private settings: () => Settings) {}

  /** Must be called from a user gesture (key or click) the first time. */
  resume(): void {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
      }
      void this.ctx.resume();
      this.applyVolume();
    } catch {
      this.ctx = null; // no audio in this browser: the game stays silent
    }
  }

  applyVolume(): void {
    if (this.master) this.master.gain.value = this.settings().volume * 0.5;
  }

  private tone(freq: number, dur: number, type: OscillatorType = "sine", vol = 0.3, slideTo?: number, delay = 0): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, vol = 0.25, freq = 800): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); // sound only: not part of the game rules
    const src = c.createBufferSource();
    const f = c.createBiquadFilter();
    const g = c.createGain();
    f.type = "bandpass";
    f.frequency.value = freq;
    g.gain.value = vol;
    src.buffer = buf;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  play(name: Sfx): void {
    switch (name) {
      case "pickup": this.tone(880, 0.12, "sine", 0.25, 1320); break;
      case "deposit": this.tone(520, 0.15, "triangle", 0.3, 780); break;
      case "lit": [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, "sine", 0.3, undefined, i * 0.09)); break;
      case "pulse": this.tone(300, 0.5, "sawtooth", 0.18, 900); this.noise(0.3, 0.12, 2000); break;
      case "hit": this.noise(0.25, 0.4, 300); this.tone(140, 0.3, "square", 0.2, 70); break;
      case "jump": this.tone(300, 0.14, "sine", 0.2, 560); break;
      case "dash": this.noise(0.18, 0.25, 1500); break;
      case "win": [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.6, "triangle", 0.3, undefined, i * 0.14)); break;
      case "lose": [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.6, "sine", 0.3, undefined, i * 0.22)); break;
      case "spawn": this.tone(90, 0.7, "sine", 0.3, 60); break;
      case "tick": this.tone(1000, 0.06, "square", 0.12); break;
      case "charm": this.tone(660, 0.3, "triangle", 0.3, 990); this.tone(990, 0.3, "triangle", 0.2, 1320, 0.12); break;
      case "steal": this.tone(700, 0.35, "sawtooth", 0.2, 200); break;
      case "fall": this.tone(500, 0.9, "sine", 0.3, 60); break;
    }
  }

  /** Slow pentatonic pad; faster in the last 30 s of a night. */
  startMusic(): void {
    if (this.musicTimer || !this.ctx) return;
    const notes = [110, 130.8, 146.8, 164.8, 196, 220];
    const loop = () => {
      const f = notes[(this.step * 3 + (this.step >> 2)) % notes.length] as number;
      this.tone(f, this.fast ? 0.5 : 1.4, "sine", 0.1);
      if (this.step % 4 === 0) this.tone(f * 2, 1.6, "triangle", 0.05);
      this.step++;
      this.musicTimer = window.setTimeout(loop, this.fast ? 380 : 900);
    };
    loop();
  }
  stopMusic(): void {
    window.clearTimeout(this.musicTimer);
    this.musicTimer = 0;
  }
  setFast(v: boolean): void {
    this.fast = v;
  }
}
