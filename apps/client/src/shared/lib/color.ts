export function hexToRgba(hexColor: string, alpha: number) {
  const value = (hexColor || "").trim();
  if (!value.startsWith("#")) return null;
  const hex = value.slice(1);
  if (hex.length !== 6) return null;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
