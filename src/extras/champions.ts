import type { Sim } from "../sim/sim";
import { CardKit } from "./cards";
import { CubKit } from "./cub";
import { DefaultKit } from "./default";
import type { KitBase } from "./kit";
import { WeaverKit } from "./weaver";

export interface ChampionDef {
  id: string;
  name: string;
  tagline: string;
  create: (sim: Sim) => KitBase;
}

/** Display names, art and numbers are original; only the Q/W/E/R shapes are inspired by MOBA kits. */
export const CHAMPIONS: ChampionDef[] = [
  { id: "default", name: "Mây (default)", tagline: "The lamp keeper herself: run, jump, dash, glow. No extra skills", create: (s) => new DefaultKit(s) },
  { id: "cards", name: "Mây the Card Reader", tagline: "Fan of cards, a lucky pick, a lure lantern, a gate", create: (s) => new CardKit(s) },
  { id: "cub", name: "Rowdy Cub", tagline: "Fast and small; rage turns it into a big stone brawler", create: (s) => new CubKit(s) },
  { id: "weaver", name: "Serpent Weaver", tagline: "Poison, haze, a sting and a freezing stare; light is her mana", create: (s) => new WeaverKit(s) },
];

export const championById = (id: string): ChampionDef => CHAMPIONS.find((c) => c.id === id) ?? (CHAMPIONS[0] as ChampionDef);
