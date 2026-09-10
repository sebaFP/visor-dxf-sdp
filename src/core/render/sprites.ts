/**
 * Siluetas del recorrido en perspectiva.
 *
 * Cada figura es una rejilla de píxeles, no una pila de bandas horizontales:
 * una banda no tiene silueta y lo que se ve de lejos es un rectángulo de cuatro
 * colores. Con una rejilla se recortan hombros, cabeza y piernas, que es lo que
 * hace reconocible a una figura a treinta metros.
 *
 * Se hornean una vez a un lienzo aparte y luego se dibujan escaladas, así que el
 * coste por frame es un `drawImage` y no doscientos rectángulos.
 */

/** Un carácter por píxel; el punto es transparente. */
export type PixelArt = readonly string[];

export type Palette = Readonly<Record<string, string>>;

/**
 * Minero de faena. Casco con lámpara, banda reflectante en el torso y las
 * piernas separadas — los tres detalles que lo identifican de un vistazo.
 */
export const MINER_ART: PixelArt = [
  "....hhhh....",
  "...hhhhhh...",
  "..hhhhhhhh..",
  "..HhhLLhhH..",
  "...ffffff...",
  "...fFffFf...",
  "...ffffff...",
  "..f.ffff.f..",
  ".goOooooOog.",
  ".goOooooOog.",
  ".goorrrroog.",
  ".goorrrroog.",
  ".g.OooooO.g.",
  "...OooooO...",
  "...bb..bb...",
  "...bb..bb...",
  "..BBB..BBB..",
  "..BBB..BBB..",
];

/**
 * El equipo que lleva el observador, visto desde atrás.
 *
 * Apagado y sin brillos: en un plano de faena el instrumento no puede competir
 * con lo que hay delante.
 */
export const RIG_ART: PixelArt = [
  "........dMd.........",
  "........dMd.........",
  "........dMd.........",
  ".......dmMmd........",
  ".......dmMmd........",
  "......ddmMmdd.......",
  ".....dmmmMmmmd......",
  "....dmmmmMmmmmd.....",
  "...dmmMMMMMMMmmd....",
  "...dmaaaaaaaaamd....",
  "..dmmmmmmmmmmmmmd...",
  "..dmgggggggggggmd...",
  ".dmggggggggggggmmd..",
  ".dmgggggggggggggmd..",
];

/**
 * El mismo minero visto desde arriba, mirando al este (rotación 0).
 *
 * Hombros, casco y lámpara: nada más. Desde arriba una figura mide unos treinta
 * y ocho píxeles en pantalla, y a ese tamaño un brazo de tres celdas no se lee
 * como un brazo — se lee como una mancha, y la silueta se convierte en un
 * bloque. Lo que sí se lee es el óvalo ancho de los hombros, el disco claro del
 * casco encima y hacia dónde apunta la lámpara.
 *
 * El contorno (`O`) rodea la silueta ENTERA, calculado dilatándola: es lo único
 * que la separa del trazado del DXF, que pasa por debajo.
 */
export const MINER_TOP_ART: PixelArt = [
  "....................",
  ".....OOOOOO.........",
  "....OOooooOO........",
  "...OOroooooOOO......",
  "..OOsroooHHHHOO.....",
  "..OssrooHiihhHOO....",
  "..OorroHhhhhhhHO....",
  "..OorroHhhhhhLLO....",
  "..OorroHhhhhhLLO....",
  "..OorroHhhhhhhHO....",
  "..OorrooHhhhhHOO....",
  "..OOrroooHHHHOO.....",
  "...OOroooooOOO......",
  "....OOooooOO........",
  ".....OOOOOO.........",
  "....................",
];

/**
 * Segundo fotograma del paso: los hombros ladeados una celda.
 *
 * Mover la figura entera da tiritona; ladear los hombros dejando el casco
 * quieto da el andar torcido que se busca.
 */
export const MINER_STEP_ART: PixelArt = [
  "....................",
  "......OOOO..........",
  "....OOOooOO.........",
  "...OOrooooOOOO......",
  "...OsroooHHHHOO.....",
  "..OOsrooHiihhHOO....",
  "..OorroHhhhhhhHO....",
  "..OorroHhhhhhLLO....",
  "..OorroHhhhhhLLO....",
  "..OorroHhhhhhhHO....",
  "..OorrooHhhhhHOO....",
  "..OOrroooHHHHOO.....",
  "...OrroooooOOO......",
  "...OOroooooO........",
  "....OOoooOOO........",
  ".....OOOOO..........",
];

/**
 * Lo que queda en el suelo.
 *
 * Desde arriba, alguien tumbado y alguien en pie ocupan lo mismo, así que caer
 * no puede ser encogerse: la figura pierde la silueta y se desparrama.
 */
export const MINER_FALLEN_ART: PixelArt = [
  "....................",
  "....................",
  "....................",
  "....................",
  ".....OOOOOOOO.......",
  "...OOOrrooooOOO.....",
  "..OOoorrooooHHOO....",
  "..OooorroooHhhHO....",
  "..OooorroooHhhHO....",
  "..OOoorrooooHHOO....",
  "...OOOrrooooOOO.....",
  ".....OOOOOOOO.......",
  "....................",
  "....................",
  "....................",
  "....................",
];

/**
 * El operador, también desde arriba y mirando al este.
 *
 * Silueta más estrecha, tonos fríos y el equipo por delante. Con doce figuras
 * en pantalla, lo primero que hay que poder contestar es cuál eres tú.
 */
export const OPERATOR_TOP_ART: PixelArt = [
  "....................",
  "....................",
  "....OOOOOO..........",
  "...OOroooOOO........",
  "...OrroooHHOOO......",
  "..OOrroHHihHHO......",
  "..OorroHhhhhHOOOOOOO",
  "..OorrHhhhhwwwwwwwWW",
  "..OorrHhhhhwwwwwwwWW",
  "..OorroHhhhhHOOOOOOO",
  "..OOrroHHhhHHO......",
  "...OrroooHHOOO......",
  "...OOroooOOO........",
  "....OOOOOO..........",
  "....................",
  "....................",
];

export const MINER_PALETTE: Palette = {
  h: "#c9a227",
  H: "#8f7318",
  L: "#ffe9a8",
  f: "#7d9166",
  F: "#5a6b49",
  o: "#9c5a28",
  O: "#6f3f1c",
  r: "#c6d3de",
  g: "#4a3728",
  b: "#3c4a5c",
  B: "#2a3543",
};

/**
 * Paleta de la vista cenital.
 *
 * `O` es casi negro a propósito: sin un contorno oscuro, el marrón del overol
 * se funde con el trazado del plano y la figura desaparece a treinta píxeles.
 */
export const MINER_TOP_PALETTE: Palette = {
  O: "#140c05",
  o: "#8f5324",
  r: "#cfdbe6",
  h: "#d8ae2a",
  H: "#7a5c0f",
  i: "#ffeaa0",
  L: "#fff4cf",
  s: "#3f4d22",
};

export const OPERATOR_PALETTE: Palette = {
  O: "#080c11",
  o: "#41576d",
  r: "#45c0f5",
  h: "#dbe4ed",
  H: "#77899b",
  i: "#ffffff",
  w: "#66788c",
  W: "#f0a63c",
};

export const RIG_PALETTE: Palette = {
  m: "#3a444f",
  M: "#5b6a7b",
  d: "#1c232c",
  a: "#f0a63c",
  g: "#2a3138",
};

export interface BakedSprite {
  canvas: HTMLCanvasElement;
  /** Ancho y alto en píxeles de la rejilla, no del lienzo. */
  cols: number;
  rows: number;
}

/**
 * Píxeles por celda al hornear.
 *
 * A 1 el lienzo es de 12×18 y al estirarlo a media pantalla cada celda mide
 * medio dedo; a 2 los bloques quedan del tamaño que pide un raycaster y el
 * lienzo sigue cabiendo en nada.
 */
const BAKE_SCALE = 2;

export function bakeSprite(art: PixelArt, palette: Palette): BakedSprite {
  const rows = art.length;
  const cols = art[0]?.length ?? 0;
  const canvas = document.createElement("canvas");
  canvas.width = cols * BAKE_SCALE;
  canvas.height = rows * BAKE_SCALE;

  const ctx = canvas.getContext("2d");
  if (ctx) {
    for (let y = 0; y < rows; y++) {
      const line = art[y];
      for (let x = 0; x < cols; x++) {
        const fill = palette[line[x]];
        if (!fill) continue;
        ctx.fillStyle = fill;
        ctx.fillRect(x * BAKE_SCALE, y * BAKE_SCALE, BAKE_SCALE, BAKE_SCALE);
      }
    }
  }

  return { canvas, cols, rows };
}

/** Mezcla dos colores hexadecimales. Sirve para las variantes de una paleta. */
export function mixHex(from: string, to: string, amount: number): string {
  const a = Number.parseInt(from.slice(1), 16);
  const b = Number.parseInt(to.slice(1), 16);
  const channel = (shift: number): number => {
    const x = (a >> shift) & 255;
    const y = (b >> shift) & 255;
    return Math.round(x + (y - x) * amount);
  };
  const hex = (v: number): string => v.toString(16).padStart(2, "0");
  return `#${hex(channel(16))}${hex(channel(8))}${hex(channel(0))}`;
}

/** La misma paleta tirada hacia un color. Para el destello de un impacto. */
export function tintPalette(palette: Palette, toward: string, amount: number): Palette {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(palette)) {
    out[key] = mixHex(value, toward, amount);
  }
  return out;
}

/**
 * La misma paleta oscurecida por la distancia.
 *
 * Un sprite con la luz del primer plano pegado al fondo de la galería delata
 * que no está donde parece; hornear unos pocos escalones de penumbra cuesta
 * nada y lo asienta en la escena.
 */
export function shadePalette(palette: Palette, light: number): Palette {
  return tintPalette(palette, "#000000", 1 - light);
}
