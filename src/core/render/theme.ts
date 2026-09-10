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
  /** Alpha applied to the ramp colour when filling a zone. */
  zoneFillAlpha: number;
  /** Accent (badge stripe, list dot, dialog marker) for a zone with nobody. */
  emptyAccent: string;
  /** Accent for «Otras zonas»: people the plan cannot place. */
  otherAccent: string;
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
  zoneFillAlpha: 0.55,
  emptyAccent: "#3d4a58",
  otherAccent: "#f0a63c",
  zoneStroke: "#64748b",
  zoneStrokeSelected: "#f1f5f9",
  zoneStrokeHover: "#b6c4d2",
  dimmedAlpha: 0.14,
};

type Rgb = readonly [number, number, number];

/** "#rgb" or "#rrggbb" → channels. Anything else is a bug in the theme, so it throws. */
function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Color de tema inválido: "${hex}" (se espera #rrggbb)`);
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const v = Number.parseInt(h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * The ramp is parsed once per array, not once per zone per frame: the renderer
 * samples it for every visible zone on every pan/zoom frame.
 */
const PARSED_RAMPS = new WeakMap<readonly string[], Rgb[]>();

function parsedRamp(ramp: readonly string[]): Rgb[] {
  let parsed = PARSED_RAMPS.get(ramp);
  if (!parsed) {
    if (ramp.length === 0) throw new Error("La rampa de densidad necesita al menos un color.");
    parsed = ramp.map(hexToRgb);
    PARSED_RAMPS.set(ramp, parsed);
  }
  return parsed;
}

/** Sample the density ramp at t in [0, 1]. */
export function rampColor(ramp: readonly string[], t: number, alpha = 1): string {
  const stops = parsedRamp(ramp);
  if (stops.length === 1) {
    const [r, g, b] = stops[0];
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const pos = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  const f = pos - i;
  const [r1, g1, b1] = stops[i];
  const [r2, g2, b2] = stops[i + 1];
  const r = Math.round(r1 + (r2 - r1) * f);
  const g = Math.round(g1 + (g2 - g1) * f);
  const b = Math.round(b1 + (b2 - b1) * f);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
