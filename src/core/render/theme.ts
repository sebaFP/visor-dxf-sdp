/**
 * Every colour the canvas draws. Kept out of the renderer so a team can restyle
 * the plan without reading a line of drawing code.
 */
export interface PlanTheme {
  background: string;
  /** Base drawing (layer "0"). */
  baseStroke: string;
  baseText: string;
  /** Zone fill ramp, from empty to busiest. Interpolated per zone. */
  densityRamp: string[];
  /** Fill for a zone with nobody in it. */
  emptyFill: string;
  zoneStroke: string;
  zoneStrokeSelected: string;
  zoneStrokeHover: string;
  /** Opacity applied to zones that are filtered out. */
  dimmedAlpha: number;
}

/** Debe seguir a los tokens de `src/index.css`. */
export const DARK_THEME: PlanTheme = {
  background: "#0a0f15",
  baseStroke: "#38465a",
  baseText: "#5a6d80",
  // Frío = vacío, cálido = lleno. Salta de tono además de brillo para que se
  // lea en escala de grises y con daltonismo rojo-verde.
  densityRamp: ["#2563eb", "#0ea5e9", "#22c55e", "#eab308", "#f97316", "#ef4444"],
  emptyFill: "#131c26",
  zoneStroke: "#64748b",
  zoneStrokeSelected: "#f1f5f9",
  zoneStrokeHover: "#b6c4d2",
  dimmedAlpha: 0.14,
};

function hexToRgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Sample the density ramp at t in [0, 1]. */
export function rampColor(ramp: string[], t: number, alpha = 1): string {
  const clamped = Math.min(1, Math.max(0, t));
  const pos = clamped * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(pos));
  const f = pos - i;
  const [r1, g1, b1] = hexToRgb(ramp[i]);
  const [r2, g2, b2] = hexToRgb(ramp[i + 1]);
  const r = Math.round(r1 + (r2 - r1) * f);
  const g = Math.round(g1 + (g2 - g1) * f);
  const b = Math.round(b1 + (b2 - b1) * f);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
