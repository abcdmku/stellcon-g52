export const HEX_SPACING = 1.08;

export function axialToPixel(q: number, r: number, size: number, spacing = HEX_SPACING) {
  // Flat-top hex layout to match the tile orientation used in CSS.
  const x = size * 1.5 * q * spacing;
  const y = size * Math.sqrt(3) * (r + q / 2) * spacing;
  return { x, y };
}

export function hexRadiusAtAngle(angleRad: number, size: number) {
  const sector = Math.PI / 3;
  const inradius = (size * Math.sqrt(3)) / 2;
  let wrapped = angleRad % sector;
  if (wrapped < 0) wrapped += sector;
  const phi = wrapped - sector / 2;
  return inradius / Math.cos(phi);
}

type Point = { x: number; y: number };

export function trimLineToHexEdges(from: Point, to: Point, { size, pad = 4 }: { size: number; pad?: number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len <= 0.001) return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };

  const ux = dx / len;
  const uy = dy / len;
  const angle = Math.atan2(dy, dx);
  const startCut = Math.max(0, hexRadiusAtAngle(angle, size) - pad);
  const endCut = Math.max(0, hexRadiusAtAngle(angle + Math.PI, size) - pad);
  const maxCut = Math.max(0, len / 2 - 0.5);
  const a = Math.min(startCut, maxCut);
  const b = Math.min(endCut, maxCut);

  return {
    x1: from.x + ux * a,
    y1: from.y + uy * a,
    x2: to.x - ux * b,
    y2: to.y - uy * b,
  };
}

type Axial = { q: number; r: number };

export function axialDistanceCoords(a: Axial, b: Axial) {
  const dq = Math.abs(a.q - b.q);
  const dr = Math.abs(a.r - b.r);
  const ds = Math.abs((a.q + a.r) - (b.q + b.r));
  return Math.max(dq, dr, ds);
}
