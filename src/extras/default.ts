// The default character: plain Mây. No champion skills; the base game's own actions (dash, glow, lantern) are all she has.
import { KitBase, type KitEvent, type KitFrame, type SkillInfo, type SlotHud, type Style } from "./kit";

export class DefaultKit extends KitBase {
  readonly id = "default";
  readonly name = "Mây";
  readonly skills: SkillInfo[] = [];
  style: Style = { dress: 0xe8e2d0, hat: 0xe3c27d, scale: 1 };
  slots(): SlotHud[] {
    return [];
  }
  protected update(_f: KitFrame, _out: KitEvent[]): void {}
}
