/**
 * Click-to-move: turn "walk to this world point" into the sim's camera-relative move input.
 * The sim turns input (x, z) into the world with the camera yaw; this is the inverse of that turn.
 */
export function steer(
  player: [number, number],
  target: [number, number],
  camYawDeg: number,
  speed: number,
  dt: number,
): { move: [number, number]; arrived: boolean } {
  const dx = target[0] - player[0];
  const dz = target[1] - player[1];
  const d = Math.hypot(dx, dz);
  if (d <= 0.05) return { move: [0, 0], arrived: true };
  const mag = Math.min(1, d / (speed * dt)); // slow down for the last step so Mây does not jitter around the point
  const wx = (dx / d) * mag;
  const wz = (dz / d) * mag;
  const th = (camYawDeg * Math.PI) / 180;
  return { move: [wx * Math.cos(th) - wz * Math.sin(th), wx * Math.sin(th) + wz * Math.cos(th)], arrived: false };
}
