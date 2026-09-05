import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DxfDocument, Vec2 } from "../core/dxf/types";
import { personField } from "../core/occupancy/extra-fields";
import type { OccupancySnapshot, Person } from "../core/occupancy/types";
import { formatZoneLabels, RAW_ZONE_LABEL, type ZoneLabeller } from "../core/occupancy/zone-names";
import {
  buildLevel,
  castRay,
  findVantagePoint,
  hasLineOfSight,
  move,
  type Hit,
  type Level,
} from "../core/render/perspective";
import { makeRandom, placePeople } from "../core/render/placement";
import { PlanRenderer, type ZoneStyle } from "../core/render/plan-renderer";
import {
  bakeSprite,
  MINER_ART,
  MINER_PALETTE,
  RIG_ART,
  RIG_PALETTE,
  shadePalette,
  tintPalette,
  type BakedSprite,
} from "../core/render/sprites";
import { DARK_THEME, rampColor, type PlanTheme } from "../core/render/theme";
import {
  Cell,
  companyOf,
  CRITICAL_HEALTH,
  KillFeed,
  Meter,
  OperatorState,
  UI,
  useKillFeed,
} from "./mode-hud";
import { CONTRACT_KEYS } from "./person-columns";

/**
 * Recorrido en perspectiva del plano.
 *
 * Proyección por columnas sobre Canvas 2D. El suelo se muestrea de una baldosa
 * que el propio `PlanRenderer` hornea alrededor del observador, así que lo que
 * se pisa es literalmente el plano — textos, círculos y relleno de zonas
 * incluidos — y no una textura aparte que haya que mantener en sincronía.
 *
 * Tres lienzos superpuestos, cada uno a la resolución que le corresponde:
 *   1. la escena, a 320 px de ancho y escalada con CSS (de ahí el pixelado);
 *   2. la capa de rótulos, a resolución real, donde el texto se lee;
 *   3. el minimapa, recortado de una baldosa horneada con su propio tema.
 */

/** Altura de los muros extruidos, en unidades de mundo. */
const WALL_HEIGHT = 2;
/** Altura del punto de vista. Bastante bajo el muro: es lo que da la sensación de encierro. */
const EYE_HEIGHT = 1.2;
const PERSON_HEIGHT = 1.75;

/** Alto del búfer interno. El ancho sale del aspecto del contenedor. */
const BUFFER_HEIGHT = 200;
const MIN_BUFFER_WIDTH = 240;
const MAX_BUFFER_WIDTH = 480;

const FOV = Math.PI / 3;
/** Más allá de esto no se traza nada: el fondo queda en negro. */
const VIEW_DISTANCE = 90;
/** Distancia a la que el sombreado por niebla llega al mínimo. */
const FOG_DISTANCE = 55;
const MIN_LIGHT = 0.16;

const WALK_SPEED = 4.5;
const RUN_MULTIPLIER = 2.1;
const TURN_SPEED = 2.4;
const MOUSE_SENSITIVITY = 0.0022;
const PLAYER_RADIUS = 0.35;
/**
 * Profundidad mínima con la que se proyecta cualquier cosa.
 *
 * Sin este suelo, algo a una millonésima de unidad se proyecta a cientos de
 * millones de píxeles de alto. Canvas no descarta ese rectángulo: lo intenta, y
 * el hilo principal no vuelve.
 */
const MIN_DEPTH = 0.08;
/** Una silueta más cerca que esto tapa la pantalla entera y no se dibuja. */
const MIN_SPRITE_DEPTH = 1.6;
/** Fracción del ancho de pantalla que como mucho puede ocupar una silueta. */
const MAX_SPRITE_WIDTH = 0.45;
/**
 * Distancia a la que se aparece del grupo de la zona de partida.
 *
 * Algo mayor que el radio del grupo: se aparece en su borde, viéndolo entero de
 * frente, en vez de en medio y rodeado antes de entender dónde se está.
 */
const SPAWN_DISTANCE = 26;
/** Nadie puede estar más cerca que esto del sitio donde se aparece. */
const SPAWN_CLEARANCE = 9;
/**
 * Cuántos pueden hacer daño a la vez.
 *
 * Sin tope, aparecer en una zona de cuarenta personas es aparecer rodeado por
 * quince y perder toda la integridad en un segundo, sin ver de dónde vino.
 * Alrededor de alguien caben tres, y tres es lo que cuenta.
 */
const MAX_ATTACKERS = 3;

/** Resolución de la baldosa de suelo, en píxeles por unidad de mundo. */
const FLOOR_PX_PER_UNIT = 4;
/** Lado de la baldosa en píxeles CSS. Cubre 128 unidades a la resolución de arriba. */
const FLOOR_TILE_PX = 512;
/** Al alejarse más de esto del centro de la baldosa, se vuelve a hornear. */
const FLOOR_REBAKE_DISTANCE = 40;

/** Nunca se dibujan más siluetas que esto por frame, por lejanas que sean. */
const MAX_SPRITES = 48;
/** Cada cuántos frames se relee la zona bajo los pies y se refresca el marcador. */
const HUD_INTERVAL_FRAMES = 12;

// --- Reglas del recorrido ---------------------------------------------------
//
// Calibrado en fácil a propósito: esto se abre sin buscarlo y quien cae aquí no
// viene preparado. Para endurecerlo, los tres números que mandan son
// CONTACT_DPS, ZOMBIE_SPEED y ENEMY_HEALTH.

/** Fuera de este radio un enemigo ni piensa ni se mueve. */
const ACTIVE_RANGE = 45;
/** Distancia a la que un enemigo deja de avanzar y empieza a hacer daño. */
const CONTACT_RANGE = 1.3;
const ZOMBIE_SPEED = 1.9;
const ZOMBIE_RADIUS = 0.4;
/** Hasta dónde se busca un hueco para quien nace dentro de un muro. */
const UNSTICK_RADIUS = 8;
/** Salud por segundo que quita un enemigo en contacto. */
const CONTACT_DPS = 6;
/** Cada cuántos frames se reevalúa la línea de visión de un enemigo. */
const SIGHT_INTERVAL_FRAMES = 6;

/** Un tiro, una baja. */
const ENEMY_HEALTH = 1;
/** Cuánto dura el derrumbe antes de desaparecer, en segundos. */
const DEATH_TIME = 0.5;
const HURT_TIME = 0.16;

const MAX_HEALTH = 100;
const MAX_AMMO = 80;
/** Munición que devuelve cada baja. Sin esto el recorrido se queda seco. */
const AMMO_PER_KILL = 6;
const SHOT_INTERVAL = 0.16;
const SCORE_PER_KILL = 100;
const MUZZLE_TIME = 0.06;
const RECOIL_TIME = 0.12;

/** Rótulos de identificación: solo los más cercanos, y no muy lejos. */
const MAX_LABELS = 6;
const LABEL_RANGE = 35;
const LABEL_BOX_HEIGHT = 40;
const LABEL_NAME_FONT = '600 12px "IBM Plex Mono", ui-monospace, Menlo, monospace';
const LABEL_META_FONT = '10px "IBM Plex Mono", ui-monospace, Menlo, monospace';
const LABEL_TAG_FONT = '9px "IBM Plex Mono", ui-monospace, Menlo, monospace';

/** Salpicadura al acertar y chispas al dar en la roca. */
const SPLATTER_COUNT = 14;
const SPARK_COUNT = 10;
const PARTICLE_LIFE = 0.6;
const PARTICLE_GRAVITY = 9;

/**
 * Polvo en suspensión.
 *
 * Una galería sin nada flotando en el aire se lee plana por muy bien resuelta
 * que esté la perspectiva: son las motas cercanas, moviéndose contra el fondo
 * quieto, las que dan la sensación de volumen.
 */
const DUST_COUNT = 80;
const DUST_RADIUS = 15;
const DUST_CEILING = 2.4;

/** Escalones de penumbra horneados por sprite. */
const LIGHT_STEPS = 6;
/** Fracción del ancho de pantalla que ocupa el equipo del operador. */
const RIG_WIDTH = 0.26;

/**
 * Opacidad de la frontera de una zona.
 *
 * Un contorno de zona no es roca: marca dónde empieza otra zona y se cruza
 * andando. Opaco convertía el recorrido en una jaula de paneles de color, y
 * además tapaba la ocupación de todo lo que hubiera detrás.
 */
const ZONE_VEIL_ALPHA = 0.26;
/** Fronteras que se pintan por columna. Más allá el color se satura y no dice nada. */
const MAX_ZONE_VEILS = 3;

/** Lado del minimapa en píxeles CSS y unidades de mundo que abarca. */
const MINIMAP_PX = 148;
const MINIMAP_SPAN = 90;
/**
 * El minimapa se hornea aparte del suelo, y con su propio tema.
 *
 * La baldosa del suelo lleva el relleno de densidad: una zona llena se pinta de
 * rojo casi opaco y a este tamaño se come el trazado. Y no basta con vaciar los
 * estilos, porque el relleno de zona vacía también es opaco y tapa igual el
 * dibujo de debajo. Con relleno transparente y trazo claro, lo que queda es el
 * plano DXF tal cual. La ocupación ya la dan los puntos rojos.
 */
const MINIMAP_TILE_PX = 512;
const MINIMAP_PX_PER_UNIT = 3;
const NO_ZONE_STYLES = new Map<string, ZoneStyle>();
/** El minimapa no necesita sesenta refrescos por segundo. */
const MINIMAP_INTERVAL_FRAMES = 3;

/** Tras caer, cuánto se muestra el marcador antes de volver al plano. */
const DEFEAT_MS = 2200;

export interface PerspectiveViewProps {
  doc: DxfDocument;
  /** El mismo renderer horneado del plano 2D: hornear otro costaría ~50 ms de más. */
  renderer: PlanRenderer;
  occupancy: OccupancySnapshot;
  zoneStyles: Map<string, ZoneStyle>;
  /** Capa desde la que arrancar. Sin ella se arranca en la zona más concurrida. */
  startLayer: string | null;
  zoneLabel?: ZoneLabeller;
  onExit: () => void;
}

/**
 * Una persona detectada, con el estado que necesita para moverse y encajar
 * disparos. Vive en un ref y se muta en sitio: sesenta cambios por segundo no
 * pasan por el estado de React.
 */
interface Enemy {
  person: Person;
  layer: string;
  x: number;
  y: number;
  health: number;
  /** Cuenta atrás del destello al recibir un impacto. */
  hurt: number;
  /** 0 mientras está en pie; > 0 mientras se derrumba. */
  dying: number;
  dead: boolean;
  /** Fase del bamboleo al caminar. */
  bob: number;
  /** Última línea de visión conocida; se recalcula escalonada. */
  sees: boolean;
}

interface Particle {
  x: number;
  y: number;
  /** Altura sobre el suelo, en unidades de mundo. */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  rgb: [number, number, number];
  /** Al tocar el suelo la sangre se apaga; una chispa no. */
  settles: boolean;
}

/** Una mota de polvo en suspensión. No tiene física, solo deriva. */
interface Mote {
  x: number;
  y: number;
  z: number;
  phase: number;
}

interface Player {
  x: number;
  y: number;
  angle: number;
}

interface Stats {
  health: number;
  ammo: number;
  kills: number;
  score: number;
  /** Segundos que faltan para poder volver a disparar. */
  cooldown: number;
  muzzle: number;
  recoil: number;
  /** Sacudida de cámara pendiente. */
  shake: number;
  /** Intensidad de la viñeta roja de daño, 0..1. */
  sting: number;
  defeated: boolean;
}

interface Hud {
  zone: string;
  zoneMeta: string;
  health: number;
  ammo: number;
  kills: number;
  score: number;
}

const BASE_WALL_RGB: [number, number, number] = [104, 122, 143];
const EMPTY_ZONE_RGB: [number, number, number] = [72, 96, 122];
const CEILING_RGB: [number, number, number] = [14, 20, 28];
const VOID_RGB: [number, number, number] = [6, 9, 13];

/** Verde: la sangre de algo que ya no está del todo vivo. */
const BLOOD_RGB: [number, number, number] = [124, 240, 58];
const BLOOD_DARK_RGB: [number, number, number] = [74, 168, 37];
/** Ámbar: el disparo que se fue a la roca. */
const SPARK_RGB: [number, number, number] = [240, 166, 60];
const DUST_RGB: [number, number, number] = [147, 163, 179];

const MINIMAP_THEME: PlanTheme = {
  ...DARK_THEME,
  background: UI.abyss,
  // Más claro que en el plano grande: a un píxel de grosor y a este tamaño, el
  // gris del visor se pierde contra el fondo.
  baseStroke: "#7d97b8",
  baseText: "#7d97b8",
  // Transparente a propósito: el relleno de zona no puede tapar el trazado.
  emptyFill: "rgba(0, 0, 0, 0)",
  zoneStroke: "#4b6c93",
  dimmedAlpha: 1,
};

function parseRgb(color: string): [number, number, number] {
  const m = color.match(/(\d+)\D+(\d+)\D+(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : BASE_WALL_RGB;
}

function shade(rgb: [number, number, number], light: number): string {
  return `rgb(${(rgb[0] * light) | 0},${(rgb[1] * light) | 0},${(rgb[2] * light) | 0})`;
}

/**
 * Siembra una entidad por persona detectada, dentro del polígono de su zona.
 *
 * La colocación vive en `core/render/placement.ts`, que es donde tiene sentido:
 * traducir "hay doce en la zona 85" a doce puntos del plano no depende de si se
 * mira de frente o desde arriba. Acá solo se le pone encima el estado que
 * necesita un enemigo del recorrido.
 */
function spawnEnemies(doc: DxfDocument, occupancy: OccupancySnapshot, level: Level): Enemy[] {
  const placements = placePeople(doc, occupancy, {
    level,
    radius: ZOMBIE_RADIUS,
    unstickRadius: UNSTICK_RADIUS,
  });

  return placements.map(({ person, layer, at, seed }) => ({
    person,
    layer,
    x: at.x,
    y: at.y,
    health: ENEMY_HEALTH,
    hurt: 0,
    dying: 0,
    dead: false,
    // Semilla derivada: el bamboleo no puede consumir del mismo flujo que la
    // colocación o moverlo cambiaría dónde nace la gente.
    bob: makeRandom(seed ^ 0x9e3779b9)() * Math.PI * 2,
    sees: false,
  }));
}

export default function PerspectiveView({
  doc,
  renderer,
  occupancy,
  zoneStyles,
  startLayer,
  zoneLabel = RAW_ZONE_LABEL,
  onExit,
}: PerspectiveViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);

  const [hud, setHud] = useState<Hud>({
    zone: "—",
    zoneMeta: "",
    health: MAX_HEALTH,
    ammo: MAX_AMMO,
    kills: 0,
    score: 0,
  });
  const [defeated, setDefeated] = useState(false);

  // Extraer e indexar decenas de miles de segmentos es el paso caro. Ocurre al
  // montar esta vista y no al montar el visor.
  const level = useMemo<Level>(() => buildLevel(doc), [doc]);

  // Un segundo horneado de la geometría, solo para el minimapa. Cuesta unas
  // decenas de milisegundos una vez, y es lo que permite darle sus colores sin
  // tocar el renderer que pinta el plano de verdad.
  const mapRenderer = useMemo(() => new PlanRenderer(doc, MINIMAP_THEME), [doc]);

  /**
   * Las siluetas, horneadas en escalones de penumbra.
   *
   * Recolorear un sprite por frame sería absurdo, y dibujarlo siempre a plena
   * luz lo despega del fondo. Seis escalones bastan para que la figura se
   * apague con la distancia igual que el muro que tiene detrás.
   */
  const sprites = useMemo(() => {
    const hurtPalette = tintPalette(MINER_PALETTE, "#7cf03a", 0.55);
    const step = (i: number) => MIN_LIGHT + ((1 - MIN_LIGHT) * i) / (LIGHT_STEPS - 1);
    return {
      miner: Array.from({ length: LIGHT_STEPS }, (_, i) =>
        bakeSprite(MINER_ART, shadePalette(MINER_PALETTE, step(i))),
      ),
      minerHurt: Array.from({ length: LIGHT_STEPS }, (_, i) =>
        bakeSprite(MINER_ART, shadePalette(hurtPalette, step(i))),
      ),
      rig: bakeSprite(RIG_ART, RIG_PALETTE),
    };
  }, []);

  const spawn = useMemo<Vec2>(() => {
    const chosen =
      doc.zoneLayers.find((zl) => zl.layer === startLayer) ??
      doc.zoneLayers.reduce<(typeof doc.zoneLayers)[number] | null>((best, zl) => {
        const count = occupancy.byLayer.get(zl.layer)?.count ?? 0;
        const bestCount = best ? (occupancy.byLayer.get(best.layer)?.count ?? 0) : -1;
        return count > bestCount ? zl : best;
      }, null);
    return chosen?.labelPoint ?? { x: 0, y: 0 };
  }, [doc, startLayer, occupancy]);

  /** Colores de muro por capa, resueltos una vez y no por columna. */
  const wallColors = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    for (const [layer, style] of zoneStyles) {
      map.set(
        layer,
        style.empty ? EMPTY_ZONE_RGB : parseRgb(rampColor(DARK_THEME.densityRamp, style.intensity)),
      );
    }
    return map;
  }, [zoneStyles]);

  /**
   * Lo que cambia con cada refresco de datos, leído por referencia.
   *
   * Si el bucle dependiera de `occupancy` directamente, cada refresco de la
   * consulta reiniciaría el efecto y con él el recorrido entero.
   */
  const liveRef = useRef({ occupancy, zoneStyles, wallColors, zoneLabel });
  liveRef.current = { occupancy, zoneStyles, wallColors, zoneLabel };

  // Los enemigos son la foto del momento en que se entró, y se congelan acá:
  // que el refresco de datos resucitara a los caídos no tendría ningún sentido.
  const enemiesRef = useRef<Enemy[] | null>(null);
  if (enemiesRef.current === null) enemiesRef.current = spawnEnemies(doc, occupancy, level);

  // Se resuelve una vez, al montar. El centroide de una zona cae dentro de un
  // tabique con toda naturalidad, y además es donde se juntan sus siluetas: se
  // arranca a una distancia de él y de frente.
  const playerRef = useRef<Player>(null as unknown as Player);
  if (playerRef.current === null) {
    const enemies = enemiesRef.current;
    const gap = SPAWN_CLEARANCE * SPAWN_CLEARANCE;
    const at = findVantagePoint(level, spawn, SPAWN_DISTANCE, PLAYER_RADIUS * 2, 48, (p) =>
      enemies.every((e) => (e.x - p.x) ** 2 + (e.y - p.y) ** 2 > gap),
    );
    playerRef.current = {
      x: at.x,
      y: at.y,
      angle: Math.atan2(spawn.y - at.y, spawn.x - at.x),
    };
  }

  const statsRef = useRef<Stats>({
    health: MAX_HEALTH,
    ammo: MAX_AMMO,
    kills: 0,
    score: 0,
    cooldown: 0,
    muzzle: 0,
    recoil: 0,
    shake: 0,
    sting: 0,
    defeated: false,
  });
  const particlesRef = useRef<Particle[]>([]);
  const dustRef = useRef<Mote[] | null>(null);
  const keysRef = useRef(new Set<string>());
  const fireRef = useRef(false);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  const [feed, pushKill] = useKillFeed();

  const surrender = useCallback(() => {
    setDefeated(true);
    window.setTimeout(() => exitRef.current(), DEFEAT_MS);
  }, []);

  // Salir es lo único que se atiende fuera del bucle: todo lo demás se lee del
  // conjunto de teclas presionadas cuando toca avanzar el frame.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        exitRef.current();
        return;
      }
      const key = event.key.toLowerCase();
      keysRef.current.add(key);
      if (key === " " || key === "control") fireRef.current = true;
      if (MOVEMENT_KEYS.has(key)) event.preventDefault();
    };
    const up = (event: KeyboardEvent) => keysRef.current.delete(event.key.toLowerCase());
    const blur = () => keysRef.current.clear();

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  /** El primer clic pide el puntero; a partir de ahí, dispara. */
  const handlePointerDown = useCallback(() => {
    if (document.pointerLockElement === sceneRef.current) fireRef.current = true;
    else sceneRef.current?.requestPointerLock?.();
  }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== sceneRef.current) return;
      playerRef.current.angle += event.movementX * MOUSE_SENSITIVITY;
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (document.pointerLockElement) document.exitPointerLock();
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const overlay = overlayRef.current;
    const minimap = minimapRef.current;
    const container = containerRef.current;
    if (!scene || !overlay || !minimap || !container) return;

    const ctx = scene.getContext("2d", { alpha: false });
    const octx = overlay.getContext("2d");
    const mctx = minimap.getContext("2d");
    if (!ctx || !octx || !mctx) return;

    let running = true;
    let bufferWidth = 0;
    let frame: ImageData | null = null;
    let zBuffer = new Float32Array(0);
    let cssWidth = 0;
    let cssHeight = 0;
    /** Viñeta de la lámpara de casco, recreada solo al cambiar de tamaño. */
    let lampVignette: CanvasGradient | null = null;

    // Baldosa de suelo: un trozo del plano horneado por el renderer de siempre.
    const dpr = window.devicePixelRatio || 1;
    const tile = document.createElement("canvas");
    tile.width = Math.round(FLOOR_TILE_PX * dpr);
    tile.height = Math.round(FLOOR_TILE_PX * dpr);
    const tileCtx = tile.getContext("2d", { willReadFrequently: true });
    let tilePixels: Uint8ClampedArray | null = null;
    let tileCenter: Vec2 = { x: NaN, y: NaN };

    const mapTile = document.createElement("canvas");
    mapTile.width = Math.round(MINIMAP_TILE_PX * dpr);
    mapTile.height = Math.round(MINIMAP_TILE_PX * dpr);
    const mapTileCtx = mapTile.getContext("2d");

    const bakeFloor = (cx: number, cy: number): void => {
      if (!tileCtx) return;
      const scale = FLOOR_PX_PER_UNIT;
      renderer.render(tileCtx, {
        viewport: {
          scale,
          tx: FLOOR_TILE_PX / 2 - cx * scale,
          ty: FLOOR_TILE_PX / 2 + cy * scale,
        },
        width: FLOOR_TILE_PX,
        height: FLOOR_TILE_PX,
        zoneStyles: liveRef.current.zoneStyles,
        showBaseText: true,
      });
      tilePixels = tileCtx.getImageData(0, 0, tile.width, tile.height).data;

      if (mapTileCtx) {
        // Sin estilos de zona y sin rótulos: el plano y nada más. A este tamaño
        // el texto del DXF es ruido y el relleno de densidad lo tapa todo.
        const mapScale = MINIMAP_PX_PER_UNIT;
        mapRenderer.render(mapTileCtx, {
          viewport: {
            scale: mapScale,
            tx: MINIMAP_TILE_PX / 2 - cx * mapScale,
            ty: MINIMAP_TILE_PX / 2 + cy * mapScale,
          },
          width: MINIMAP_TILE_PX,
          height: MINIMAP_TILE_PX,
          zoneStyles: NO_ZONE_STYLES,
          showBaseText: false,
        });
      }

      tileCenter = { x: cx, y: cy };
    };

    const resize = (): void => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      cssWidth = Math.round(rect.width);
      cssHeight = Math.round(rect.height);

      bufferWidth = Math.max(
        MIN_BUFFER_WIDTH,
        Math.min(MAX_BUFFER_WIDTH, Math.round(BUFFER_HEIGHT * (cssWidth / cssHeight))),
      );
      scene.width = bufferWidth;
      scene.height = BUFFER_HEIGHT;
      scene.style.width = `${cssWidth}px`;
      scene.style.height = `${cssHeight}px`;
      frame = ctx.createImageData(bufferWidth, BUFFER_HEIGHT);
      zBuffer = new Float32Array(bufferWidth);
      ctx.imageSmoothingEnabled = false;

      const cx = bufferWidth / 2;
      const cy = BUFFER_HEIGHT / 2;
      lampVignette = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(cx, cy) * 1.18);
      lampVignette.addColorStop(0, "rgba(255, 233, 168, 0.055)");
      lampVignette.addColorStop(0.42, "rgba(0, 0, 0, 0)");
      lampVignette.addColorStop(1, "rgba(6, 9, 13, 0.72)");

      // La capa de rótulos va a resolución real: es la que lleva el texto.
      overlay.width = Math.round(cssWidth * dpr);
      overlay.height = Math.round(cssHeight * dpr);
      overlay.style.width = `${cssWidth}px`;
      overlay.style.height = `${cssHeight}px`;
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);

      minimap.width = Math.round(MINIMAP_PX * dpr);
      minimap.height = Math.round(MINIMAP_PX * dpr);
      minimap.style.width = `${MINIMAP_PX}px`;
      minimap.style.height = `${MINIMAP_PX}px`;
      mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let last = performance.now();
    let hudCountdown = 1;
    let tick = 0;

    // Cámara del frame en curso, compartida entre los pases de escena y rótulos.
    let dirX = 1;
    let dirY = 0;
    let planeX = 0;
    let planeY = 0;
    let invDet = 1;
    let projection = 1;
    let horizon = BUFFER_HEIGHT / 2;

    // --- Avance del estado -------------------------------------------------

    const burst = (
      x: number,
      y: number,
      z: number,
      count: number,
      rgb: [number, number, number],
      speed: number,
      settles: boolean,
    ): void => {
      const particles = particlesRef.current;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const reach = speed * (0.4 + Math.random());
        particles.push({
          x,
          y,
          z,
          vx: Math.cos(angle) * reach,
          vy: Math.sin(angle) * reach,
          vz: 1 + Math.random() * 2.5,
          life: PARTICLE_LIFE,
          rgb,
          settles,
        });
      }
    };

    const damage = (enemy: Enemy): void => {
      enemy.health -= 1;
      enemy.hurt = HURT_TIME;
      burst(
        enemy.x,
        enemy.y,
        EYE_HEIGHT * (0.8 + Math.random() * 0.4),
        SPLATTER_COUNT,
        BLOOD_RGB,
        3,
        true,
      );
      if (enemy.health > 0) return;

      enemy.dying = DEATH_TIME;
      const stats = statsRef.current;
      stats.kills += 1;
      stats.score += SCORE_PER_KILL;
      stats.ammo = Math.min(MAX_AMMO, stats.ammo + AMMO_PER_KILL);
      pushKill(enemy.person);
    };

    /**
     * Disparo instantáneo: gana el enemigo más cercano cuyo centro caiga bajo la
     * mira y cuya columna no esté tapada por un muro. Si no hay nadie, la bala
     * llega a la roca y se ve dónde.
     */
    const shoot = (): void => {
      const stats = statsRef.current;
      if (stats.cooldown > 0 || stats.ammo <= 0 || stats.defeated) return;

      stats.cooldown = SHOT_INTERVAL;
      stats.ammo -= 1;
      stats.muzzle = MUZZLE_TIME;
      stats.recoil = RECOIL_TIME;
      stats.shake = Math.max(stats.shake, 1.1);

      const player = playerRef.current;
      const centre = bufferWidth / 2;
      let best: Enemy | null = null;
      let bestDepth = Infinity;

      for (const enemy of enemiesRef.current!) {
        if (enemy.dead || enemy.dying > 0) continue;
        const relX = enemy.x - player.x;
        const relY = enemy.y - player.y;
        const depth = invDet * (-planeY * relX + planeX * relY);
        if (depth < MIN_SPRITE_DEPTH || depth >= bestDepth) continue;

        const offset = invDet * (dirY * relX - dirX * relY);
        const screenX = centre * (1 + offset / depth);
        const halfWidth = ((PERSON_HEIGHT * projection) / depth) * 0.2;
        if (Math.abs(screenX - centre) > halfWidth) continue;

        const column = Math.min(bufferWidth - 1, Math.max(0, Math.round(screenX)));
        if (zBuffer[column] <= depth) continue;

        best = enemy;
        bestDepth = depth;
      }

      if (best) {
        damage(best);
        return;
      }

      // Contra la roca: chispas donde pegó, para que un fallo también se lea.
      const hit = castRay(level, player.x, player.y, dirX, dirY, VIEW_DISTANCE);
      if (!hit) return;
      const d = Math.max(MIN_DEPTH, hit.distance) - 0.1;
      burst(
        player.x + dirX * d,
        player.y + dirY * d,
        EYE_HEIGHT,
        SPARK_COUNT,
        SPARK_RGB,
        2.2,
        false,
      );
    };

    const reseedMote = (player: Player): Mote => {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * DUST_RADIUS;
      return {
        x: player.x + Math.cos(angle) * radius,
        y: player.y + Math.sin(angle) * radius,
        z: Math.random() * DUST_CEILING,
        phase: Math.random() * Math.PI * 2,
      };
    };

    const advance = (dt: number): void => {
      const stats = statsRef.current;
      stats.cooldown = Math.max(0, stats.cooldown - dt);
      stats.muzzle = Math.max(0, stats.muzzle - dt);
      stats.recoil = Math.max(0, stats.recoil - dt);
      stats.shake = Math.max(0, stats.shake - dt * 6);
      stats.sting = Math.max(0, stats.sting - dt * 2.2);

      if (fireRef.current) {
        fireRef.current = false;
        if (!stats.defeated) shoot();
      }
      if (stats.defeated) return;

      const keys = keysRef.current;
      const player = playerRef.current;

      if (keys.has("arrowleft") || keys.has("q")) player.angle -= TURN_SPEED * dt;
      if (keys.has("arrowright") || keys.has("e")) player.angle += TURN_SPEED * dt;

      const forward =
        (keys.has("w") || keys.has("arrowup") ? 1 : 0) -
        (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
      const strafe = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);

      if (forward !== 0 || strafe !== 0) {
        const speed = WALK_SPEED * (keys.has("shift") ? RUN_MULTIPLIER : 1) * dt;
        const cos = Math.cos(player.angle);
        const sin = Math.sin(player.angle);
        // Normalizar la diagonal: si no, moverse en diagonal es un 41% más rápido.
        const len = Math.hypot(forward, strafe);
        // Sin colisión, a propósito. Esto recorre un plano de faena, no un nivel
        // diseñado: la capa base no distingue un muro de un achurado o de una
        // línea de cota, así que chocar contra "paredes" que no existen deja al
        // observador encajonado sin entender por qué. Los muros siguen tapando
        // la vista y siguen cortando la línea de visión de los enemigos —
        // solamente no cortan el paso.
        player.x += ((cos * forward - sin * strafe) / len) * speed;
        player.y += ((sin * forward + cos * strafe) / len) * speed;
      }

      advanceEnemies(dt);
      advanceParticles(dt);
      advanceDust(dt);

      if (stats.health <= 0 && !stats.defeated) {
        stats.health = 0;
        stats.defeated = true;
        surrender();
      }
    };

    const advanceEnemies = (dt: number): void => {
      const player = playerRef.current;
      const stats = statsRef.current;
      const enemies = enemiesRef.current!;
      const activeRange2 = ACTIVE_RANGE * ACTIVE_RANGE;
      let attackers = 0;

      for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        if (enemy.dead) continue;

        enemy.hurt = Math.max(0, enemy.hurt - dt);

        if (enemy.dying > 0) {
          enemy.dying -= dt;
          if (enemy.dying <= 0) enemy.dead = true;
          continue;
        }

        const relX = player.x - enemy.x;
        const relY = player.y - enemy.y;
        const distance2 = relX * relX + relY * relY;
        if (distance2 > activeRange2) continue;

        // Escalonado por índice: un rayo por enemigo y frame sería tirar
        // rendimiento por un dato que no cambia tan deprisa.
        if (i % SIGHT_INTERVAL_FRAMES === tick % SIGHT_INTERVAL_FRAMES) {
          enemy.sees = hasLineOfSight(level, enemy, player);
        }
        if (!enemy.sees) continue;

        const distance = Math.sqrt(distance2);
        if (distance <= CONTACT_RANGE) {
          // Los de más allá del tope siguen ahí y siguen tapando: lo que no
          // hacen es sumar daño.
          if (attackers < MAX_ATTACKERS) {
            attackers += 1;
            stats.health -= CONTACT_DPS * dt;
            stats.sting = Math.min(1, stats.sting + dt * 3.5);
            stats.shake = Math.max(stats.shake, 1.6);
          }
          continue;
        }

        const step = (ZOMBIE_SPEED * dt) / distance;
        const next = move(level, enemy, relX * step, relY * step, ZOMBIE_RADIUS);
        enemy.x = next.x;
        enemy.y = next.y;
        enemy.bob += dt * 7;
      }
    };

    const advanceParticles = (dt: number): void => {
      const particles = particlesRef.current;
      let write = 0;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) continue;
        p.vz -= PARTICLE_GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.z < 0) {
          p.z = 0;
          p.vz = 0;
          p.vx *= 0.4;
          p.vy *= 0.4;
        }
        particles[write++] = p;
      }
      particles.length = write;
    };

    /** El polvo no cae: deriva, y se recicla cuando el observador lo deja atrás. */
    const advanceDust = (dt: number): void => {
      const player = playerRef.current;
      if (dustRef.current === null) {
        dustRef.current = Array.from({ length: DUST_COUNT }, () => reseedMote(player));
      }
      const now = performance.now() / 1000;
      for (const mote of dustRef.current) {
        mote.x += Math.sin(now * 0.5 + mote.phase) * 0.12 * dt;
        mote.y += Math.cos(now * 0.4 + mote.phase * 1.7) * 0.12 * dt;
        mote.z += Math.sin(now * 0.7 + mote.phase) * 0.08 * dt;
        if (Math.hypot(mote.x - player.x, mote.y - player.y) > DUST_RADIUS) {
          Object.assign(mote, reseedMote(player));
        }
      }
    };

    // --- Dibujo ------------------------------------------------------------

    /** Se rellena en el pase de siluetas y lo consume el de rótulos. */
    let labelled: { screenX: number; top: number; depth: number; enemy: Enemy }[] = [];

    const drawScene = (): void => {
      if (!frame || bufferWidth === 0) return;
      const player = playerRef.current;
      const stats = statsRef.current;
      const width = bufferWidth;
      const height = BUFFER_HEIGHT;

      // La sacudida mueve el horizonte, no la geometría: es la misma cizalla
      // vertical con la que un raycaster clásico simula mirar arriba y abajo.
      const jolt = stats.shake > 0 ? Math.sin(performance.now() * 0.05) * stats.shake * 2.4 : 0;
      horizon = height / 2 + jolt;
      // Distancia al plano de proyección: fija el campo de visión.
      projection = width / 2 / Math.tan(FOV / 2);

      if (
        Number.isNaN(tileCenter.x) ||
        Math.hypot(player.x - tileCenter.x, player.y - tileCenter.y) > FLOOR_REBAKE_DISTANCE
      ) {
        bakeFloor(player.x, player.y);
      }

      dirX = Math.cos(player.angle);
      dirY = Math.sin(player.angle);
      // El plano de cámara mide medio ancho de pantalla a distancia 1: con él la
      // corrección de ojo de pez sale gratis, sin un coseno por columna.
      const planeSpan = Math.tan(FOV / 2);
      planeX = -dirY * planeSpan;
      planeY = dirX * planeSpan;
      invDet = 1 / (planeX * dirY - dirX * planeY);

      // El fogonazo ilumina la galería un par de frames. Es lo que hace que un
      // disparo se sienta y no sea solo un número que baja.
      const flash = stats.muzzle > 0 ? 1 + (stats.muzzle / MUZZLE_TIME) * 0.45 : 1;

      const pixels = frame.data;
      const ceilingRows = Math.max(0, Math.min(height, Math.ceil(horizon)));

      // --- Techo -----------------------------------------------------------
      for (let i = 0; i < ceilingRows * width; i++) {
        const o = i * 4;
        pixels[o] = CEILING_RGB[0];
        pixels[o + 1] = CEILING_RGB[1];
        pixels[o + 2] = CEILING_RGB[2];
        pixels[o + 3] = 255;
      }

      // --- Suelo -----------------------------------------------------------
      // Una fila de pantalla es una distancia constante en el suelo, así que el
      // muestreo avanza linealmente y no hay una división por píxel.
      const leftX = dirX - planeX;
      const leftY = dirY - planeY;
      const rightX = dirX + planeX;
      const rightY = dirY + planeY;
      const tileScale = FLOOR_PX_PER_UNIT * dpr;
      const tileHalf = (FLOOR_TILE_PX / 2) * dpr;
      const tileSize = tile.width;

      for (let y = ceilingRows; y < height; y++) {
        const rowOffset = y * width * 4;
        const denom = y - horizon;
        const distance = denom <= 0 ? VIEW_DISTANCE : (EYE_HEIGHT * projection) / denom;

        if (distance > VIEW_DISTANCE || !tilePixels) {
          for (let x = 0; x < width; x++) {
            const o = rowOffset + x * 4;
            pixels[o] = VOID_RGB[0];
            pixels[o + 1] = VOID_RGB[1];
            pixels[o + 2] = VOID_RGB[2];
            pixels[o + 3] = 255;
          }
          continue;
        }

        const light = Math.max(MIN_LIGHT, 1 - distance / FOG_DISTANCE) * flash;
        let wx = player.x + leftX * distance;
        let wy = player.y + leftY * distance;
        const stepX = ((rightX - leftX) * distance) / width;
        const stepY = ((rightY - leftY) * distance) / width;

        for (let x = 0; x < width; x++) {
          const tx = ((wx - tileCenter.x) * tileScale + tileHalf) | 0;
          const ty = (-(wy - tileCenter.y) * tileScale + tileHalf) | 0;
          const o = rowOffset + x * 4;

          if (tx < 0 || ty < 0 || tx >= tileSize || ty >= tileSize) {
            pixels[o] = VOID_RGB[0];
            pixels[o + 1] = VOID_RGB[1];
            pixels[o + 2] = VOID_RGB[2];
          } else {
            const s = (ty * tileSize + tx) * 4;
            pixels[o] = tilePixels[s] * light;
            pixels[o + 1] = tilePixels[s + 1] * light;
            pixels[o + 2] = tilePixels[s + 2] * light;
          }
          pixels[o + 3] = 255;
          wx += stepX;
          wy += stepY;
        }
      }

      ctx.putImageData(frame, 0, 0);

      // --- Muros y fronteras de zona ---------------------------------------
      const wallColorFor = liveRef.current.wallColors;
      const crossings: Hit[] = [];

      for (let x = 0; x < width; x++) {
        const camera = (2 * x) / width - 1;
        const rayX = dirX + planeX * camera;
        const rayY = dirY + planeY * camera;
        crossings.length = 0;
        const hit = castRay(level, player.x, player.y, rayX, rayY, VIEW_DISTANCE, crossings);

        if (hit) {
          // `castRay` devuelve el parámetro sobre un rayo cuya proyección sobre
          // la dirección de la cámara vale 1: eso ya es la distancia
          // perpendicular. El suelo evita que un muro rozado dé una altura de
          // cientos de millones de píxeles, que el rasterizador no rechaza: se
          // cuelga intentándola.
          const distance = Math.max(MIN_DEPTH, hit.distance);
          zBuffer[x] = distance;

          const top = Math.max(-1, horizon - ((WALL_HEIGHT - EYE_HEIGHT) * projection) / distance);
          const bottom = Math.min(height + 1, horizon + (EYE_HEIGHT * projection) / distance);
          if (bottom > top) {
            // Las caras de canto se oscurecen: da relieve sin iluminación.
            const facing = hit.sideX ? 1 : 0.68;
            const light = Math.max(MIN_LIGHT, 1 - distance / FOG_DISTANCE) * facing * flash;
            ctx.fillStyle = shade(BASE_WALL_RGB, Math.min(1, light));
            ctx.fillRect(x, top, 1, bottom - top);
          }
        } else {
          zBuffer[x] = VIEW_DISTANCE;
        }

        // Los velos, del más lejano al más cercano, para que se acumulen en el
        // orden correcto. Uno solo tiñe; tres seguidos avisan de que hay varias
        // fronteras por delante sin cerrar el paso a ninguna.
        for (let i = 0; i < crossings.length && i < MAX_ZONE_VEILS; i++) {
          const veil = crossings[i];
          const distance = Math.max(MIN_DEPTH, veil.distance);
          const top = Math.max(-1, horizon - ((WALL_HEIGHT - EYE_HEIGHT) * projection) / distance);
          const bottom = Math.min(height + 1, horizon + (EYE_HEIGHT * projection) / distance);
          if (bottom <= top) continue;

          const rgb = wallColorFor.get(veil.wall.layer!) ?? EMPTY_ZONE_RGB;
          const light = Math.max(MIN_LIGHT, 1 - distance / FOG_DISTANCE) * flash;
          const alpha = veil.sideX ? ZONE_VEIL_ALPHA : ZONE_VEIL_ALPHA * 0.72;
          ctx.fillStyle = `rgba(${(rgb[0] * light) | 0},${(rgb[1] * light) | 0},${(rgb[2] * light) | 0},${alpha})`;
          ctx.fillRect(x, top, 1, bottom - top);
        }
      }

      drawEnemies(width, height);
      drawParticles(width, height);
      drawLighting(width, height);
      drawRig(width, height);
    };

    const drawEnemies = (width: number, height: number): void => {
      const player = playerRef.current;
      const centre = width / 2;
      const visible: { depth: number; screenX: number; enemy: Enemy }[] = [];

      for (const enemy of enemiesRef.current!) {
        if (enemy.dead) continue;
        const relX = enemy.x - player.x;
        const relY = enemy.y - player.y;
        const depth = invDet * (-planeY * relX + planeX * relY);
        if (depth < MIN_SPRITE_DEPTH || depth > FOG_DISTANCE) continue;
        const offset = invDet * (dirY * relX - dirX * relY);
        visible.push({ depth, screenX: centre * (1 + offset / depth), enemy });
      }

      // De atrás hacia adelante, y solo los más cercanos si hay multitud.
      visible.sort((a, b) => b.depth - a.depth);
      const drawn = visible.slice(Math.max(0, visible.length - MAX_SPRITES));
      labelled = [];

      for (const item of drawn) {
        const { enemy } = item;
        const fullHeight = (PERSON_HEIGHT * projection) / item.depth;
        // Al caer, el cuerpo se aplasta manteniendo los pies en el suelo.
        const collapse = enemy.dying > 0 ? Math.max(0.15, enemy.dying / DEATH_TIME) : 1;
        const spriteHeight = fullHeight * collapse;
        // Tope de ancho: a distancia de mordisco un sprite ocupa todas las
        // columnas y deja al jugador ciego, sin saber por dónde escapar.
        const spriteWidth = Math.min(width * MAX_SPRITE_WIDTH, Math.max(2, fullHeight * 0.42));

        const bob = enemy.dying > 0 ? 0 : Math.sin(enemy.bob) * fullHeight * 0.018;
        const feet = horizon + (EYE_HEIGHT * projection) / item.depth + bob;
        const top = feet - spriteHeight;
        const left = item.screenX - spriteWidth / 2;

        const from = Math.max(0, Math.ceil(left));
        const to = Math.min(width - 1, Math.floor(left + spriteWidth));
        if (to < from || top > height || feet < 0) continue;

        const light = Math.max(MIN_LIGHT, 1 - item.depth / FOG_DISTANCE);
        const shadeStep = Math.min(
          LIGHT_STEPS - 1,
          Math.max(0, Math.round(((light - MIN_LIGHT) / (1 - MIN_LIGHT)) * (LIGHT_STEPS - 1))),
        );
        const baked: BakedSprite =
          enemy.hurt > 0 ? sprites.minerHurt[shadeStep] : sprites.miner[shadeStep];

        // Sin nada delante basta un `drawImage`; solo cuando un muro corta la
        // figura hay que pagar el recorte columna a columna.
        let occluded = false;
        for (let x = from; x <= to && !occluded; x++) {
          if (zBuffer[x] <= item.depth) occluded = true;
        }

        if (occluded) {
          // Por tramos contiguos y no columna a columna: un `drawImage` de una
          // sexta parte de píxel de origen, repetido cien veces por sprite y
          // por frame, cuelga el rasterizador. Lo normal es que un muro parta la
          // figura en dos trozos, así que son dos llamadas y no cien.
          const srcPerColumn = baked.canvas.width / spriteWidth;
          let runStart = -1;

          for (let x = from; x <= to + 1; x++) {
            const visible = x <= to && zBuffer[x] > item.depth;
            if (visible) {
              if (runStart < 0) runStart = x;
              continue;
            }
            if (runStart < 0) continue;

            const span = x - runStart;
            ctx.drawImage(
              baked.canvas,
              (runStart - left) * srcPerColumn,
              0,
              span * srcPerColumn,
              baked.canvas.height,
              runStart,
              top,
              span,
              spriteHeight,
            );
            runStart = -1;
          }
        } else {
          ctx.drawImage(baked.canvas, left, top, spriteWidth, spriteHeight);
        }

        if (enemy.dying === 0 && item.depth <= LABEL_RANGE) {
          labelled.push({ screenX: item.screenX, top, depth: item.depth, enemy });
        }
      }

      // Los rótulos son para orientarse, no para tapar la pantalla.
      labelled.sort((a, b) => a.depth - b.depth);
      labelled = labelled.slice(0, MAX_LABELS);
    };

    /**
     * Salpicaduras, chispas y polvo, en el búfer pequeño.
     *
     * Van aquí y no en la capa nítida a propósito: comparten el pixelado de la
     * escena, así que se leen como parte de ella y no como una calcomanía.
     */
    const drawParticles = (width: number, height: number): void => {
      const player = playerRef.current;
      const centre = width / 2;

      const plot = (
        wx: number,
        wy: number,
        wz: number,
        rgb: [number, number, number],
        alpha: number,
        scale: number,
      ): void => {
        const relX = wx - player.x;
        const relY = wy - player.y;
        const depth = invDet * (-planeY * relX + planeX * relY);
        if (depth < MIN_DEPTH || depth > FOG_DISTANCE) return;

        const offset = invDet * (dirY * relX - dirX * relY);
        const sx = centre * (1 + offset / depth);
        const column = Math.round(sx);
        if (column < 0 || column >= width || zBuffer[column] <= depth) return;

        const sy = horizon + ((EYE_HEIGHT - wz) * projection) / depth;
        if (sy < -4 || sy > height + 4) return;

        const size = Math.max(1, (projection * scale) / depth);
        ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(2)})`;
        ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
      };

      for (const mote of dustRef.current ?? []) {
        const distance = Math.hypot(mote.x - player.x, mote.y - player.y);
        // Las motas de lejos son ruido; solo las cercanas dan sensación de aire.
        const alpha = 0.3 * Math.max(0, 1 - distance / DUST_RADIUS);
        if (alpha < 0.02) continue;
        plot(mote.x, mote.y, mote.z, DUST_RGB, alpha, 0.012);
      }

      for (const p of particlesRef.current) {
        const fade = Math.min(1, p.life / PARTICLE_LIFE);
        const rgb = p.settles && p.z <= 0 ? BLOOD_DARK_RGB : p.rgb;
        plot(p.x, p.y, p.z, rgb, fade, 0.05);
      }
    };

    /** La lámpara de casco y, si toca, el golpe encajado. */
    const drawLighting = (width: number, height: number): void => {
      if (lampVignette) {
        ctx.fillStyle = lampVignette;
        ctx.fillRect(0, 0, width, height);
      }

      const stats = statsRef.current;
      const lowHealth = stats.health < CRITICAL_HEALTH && !stats.defeated;
      // Con la integridad al límite la viñeta late aunque no estén pegando: es
      // la única señal que se ve sin apartar la vista del frente.
      const pulse = lowHealth ? 0.12 + Math.sin(performance.now() * 0.006) * 0.06 : 0;
      const sting = Math.max(stats.sting * 0.5, pulse);
      if (sting <= 0.01) return;

      const gradient = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.22,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.72,
      );
      gradient.addColorStop(0, "rgba(176, 42, 42, 0)");
      gradient.addColorStop(1, `rgba(176, 42, 42, ${sting.toFixed(2)})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    };

    const drawRig = (width: number, height: number): void => {
      const stats = statsRef.current;
      const rig = sprites.rig;
      // Se dimensiona por ancho y no por alto: atado al alto, en una pantalla
      // apaisada el equipo crece hasta comerse el tercio central de la galería.
      const rigWidth = width * RIG_WIDTH;
      const rigHeight = (rigWidth * rig.rows) / rig.cols;
      const recoil = (stats.recoil / RECOIL_TIME) * height * 0.07;
      const left = width / 2 - rigWidth / 2;
      // Se sale por abajo a propósito, como cualquier arma en primera persona:
      // apoyada justo sobre el marcador parecería estar flotando.
      const top = height - rigHeight * 0.78 + recoil;

      if (stats.muzzle > 0) {
        // El fogonazo va detrás del cañón, no encima: así se ve salir de la boca.
        const size = rigWidth * 0.62;
        ctx.fillStyle = "rgba(255, 233, 168, 0.35)";
        ctx.fillRect(width / 2 - size, top - size * 0.5, size * 2, size * 0.7);
        ctx.fillStyle = "rgba(255, 233, 168, 0.9)";
        ctx.fillRect(width / 2 - size / 2, top - size * 0.34, size, size * 0.4);
      }

      ctx.drawImage(rig.canvas, left, top, rigWidth, rigHeight);
    };

    const drawOverlay = (): void => {
      if (cssWidth === 0) return;
      octx.clearRect(0, 0, cssWidth, cssHeight);
      const scaleX = cssWidth / bufferWidth;
      const scaleY = cssHeight / BUFFER_HEIGHT;

      // --- Identificación --------------------------------------------------
      // Mismo criterio que las insignias del plano: en un corrillo los rótulos
      // caen unos sobre otros y se vuelven ilegibles. Gana el más cercano y el
      // que se solape con uno ya puesto no se dibuja.
      octx.textAlign = "center";
      octx.textBaseline = "alphabetic";
      const boxes: { left: number; right: number; top: number; bottom: number }[] = [];

      for (const item of labelled) {
        const x = item.screenX * scaleX;
        const y = Math.max(LABEL_BOX_HEIGHT + 8, item.top * scaleY - 9);
        const { person } = item.enemy;
        const name = person.name;
        const company = companyOf(person);
        const contract = personField(person, CONTRACT_KEYS);
        const tag = contract
          ? `${contract} · ${item.depth.toFixed(0)} M`
          : `${item.depth.toFixed(0)} M`;

        octx.font = LABEL_NAME_FONT;
        const nameWidth = octx.measureText(name).width;
        octx.font = LABEL_META_FONT;
        const companyWidth = octx.measureText(company).width;
        octx.font = LABEL_TAG_FONT;
        const tagWidth = octx.measureText(tag).width;
        const boxWidth = Math.max(nameWidth, companyWidth, tagWidth) + 22;

        const box = {
          left: x - boxWidth / 2,
          right: x + boxWidth / 2,
          top: y - LABEL_BOX_HEIGHT,
          bottom: y + 4,
        };
        const overlaps = boxes.some(
          (b) =>
            b.left < box.right && b.right > box.left && b.top < box.bottom && b.bottom > box.top,
        );
        if (overlaps) continue;
        boxes.push(box);

        octx.fillStyle = "rgba(9, 14, 20, 0.88)";
        octx.fillRect(box.left, box.top, boxWidth, LABEL_BOX_HEIGHT + 4);
        // Un filo ámbar arriba y nada más: el color dentro del rótulo compite
        // con la figura que está señalando.
        octx.fillStyle = UI.alert;
        octx.fillRect(box.left, box.top, boxWidth, 1);

        octx.fillStyle = UI.ink;
        octx.font = LABEL_NAME_FONT;
        octx.fillText(name, x, y - 26);
        octx.fillStyle = UI.inkSoft;
        octx.font = LABEL_META_FONT;
        octx.fillText(company, x, y - 14);
        octx.fillStyle = UI.inkDim;
        octx.font = LABEL_TAG_FONT;
        octx.fillText(tag, x, y - 3);
      }

      // --- Mira ------------------------------------------------------------
      const cx = cssWidth / 2;
      const cy = cssHeight / 2;
      const stats = statsRef.current;
      // Se abre al disparar. Es lo que da la sensación de que el equipo retrocede.
      const spread = 4 + (stats.recoil / RECOIL_TIME) * 5;

      octx.strokeStyle = "rgba(221, 229, 237, 0.8)";
      octx.lineWidth = 1.25;
      octx.beginPath();
      octx.moveTo(cx - spread - 7, cy);
      octx.lineTo(cx - spread, cy);
      octx.moveTo(cx + spread, cy);
      octx.lineTo(cx + spread + 7, cy);
      octx.moveTo(cx, cy - spread - 7);
      octx.lineTo(cx, cy - spread);
      octx.moveTo(cx, cy + spread);
      octx.lineTo(cx, cy + spread + 7);
      octx.stroke();
      octx.fillStyle = "rgba(240, 166, 60, 0.9)";
      octx.fillRect(cx - 0.75, cy - 0.75, 1.5, 1.5);
    };

    const drawMinimap = (): void => {
      const player = playerRef.current;
      mctx.fillStyle = UI.abyss;
      mctx.fillRect(0, 0, MINIMAP_PX, MINIMAP_PX);

      const pxPerUnit = MINIMAP_PX / MINIMAP_SPAN;
      const cx = MINIMAP_PX / 2;
      const cy = MINIMAP_PX / 2;

      if (!Number.isNaN(tileCenter.x)) {
        const unit = MINIMAP_PX_PER_UNIT * dpr;
        const half = (MINIMAP_SPAN / 2) * unit;
        const sx = (player.x - tileCenter.x) * unit + mapTile.width / 2 - half;
        const sy = -(player.y - tileCenter.y) * unit + mapTile.height / 2 - half;
        mctx.drawImage(mapTile, sx, sy, half * 2, half * 2, 0, 0, MINIMAP_PX, MINIMAP_PX);
      }

      // Cono de visión: sin él el minimapa dice dónde estás pero no hacia dónde
      // miras, que es justo lo que hace falta para decidir por dónde salir.
      // La Y del mundo crece hacia arriba y la del lienzo hacia abajo.
      const angle = -player.angle;
      const reach = MINIMAP_PX * 0.42;
      const halfFov = Math.atan(Math.tan(FOV / 2));
      mctx.fillStyle = "rgba(240, 166, 60, 0.11)";
      mctx.beginPath();
      mctx.moveTo(cx, cy);
      mctx.lineTo(cx + Math.cos(angle - halfFov) * reach, cy + Math.sin(angle - halfFov) * reach);
      mctx.lineTo(cx + Math.cos(angle + halfFov) * reach, cy + Math.sin(angle + halfFov) * reach);
      mctx.closePath();
      mctx.fill();

      mctx.fillStyle = UI.critical;
      for (const enemy of enemiesRef.current!) {
        if (enemy.dead || enemy.dying > 0) continue;
        if (Math.abs(enemy.x - player.x) > MINIMAP_SPAN / 2) continue;
        if (Math.abs(enemy.y - player.y) > MINIMAP_SPAN / 2) continue;
        const px = cx + (enemy.x - player.x) * pxPerUnit;
        const py = cy - (enemy.y - player.y) * pxPerUnit;
        mctx.fillRect(px - 1.5, py - 1.5, 3, 3);
      }

      mctx.fillStyle = UI.alert;
      mctx.beginPath();
      mctx.moveTo(cx + Math.cos(angle) * 6, cy + Math.sin(angle) * 6);
      mctx.lineTo(cx + Math.cos(angle + 2.5) * 4.5, cy + Math.sin(angle + 2.5) * 4.5);
      mctx.lineTo(cx + Math.cos(angle - 2.5) * 4.5, cy + Math.sin(angle - 2.5) * 4.5);
      mctx.closePath();
      mctx.fill();
    };

    const refreshHud = (): void => {
      const player = playerRef.current;
      const stats = statsRef.current;
      const { occupancy: live, zoneLabel: label } = liveRef.current;

      const layer = renderer.hitTest({ x: player.x, y: player.y });
      const zl = layer ? doc.zoneLayers.find((z) => z.layer === layer) : null;
      const count = layer ? (live.byLayer.get(layer)?.count ?? 0) : 0;

      setHud({
        zone: zl ? formatZoneLabels(zl.zoneIds, label) : "Fuera de zona",
        zoneMeta: layer ? `capa ${layer} · ${count} detectadas` : "sin polígono bajo los pies",
        health: Math.max(0, Math.round(stats.health)),
        ammo: stats.ammo,
        kills: stats.kills,
        score: stats.score,
      });
    };

    const step = (now: number): void => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tick += 1;

      advance(dt);
      drawScene();
      drawOverlay();
      if (tick % MINIMAP_INTERVAL_FRAMES === 0) drawMinimap();

      // `hitTest` recorre todos los anillos del plano: a 60 Hz no vale la pena
      // para un marcador que solo cambia al cruzar una frontera.
      hudCountdown -= 1;
      if (hudCountdown <= 0) {
        hudCountdown = HUD_INTERVAL_FRAMES;
        refreshHud();
      }

      requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
    return () => {
      running = false;
      observer.disconnect();
    };
    // `occupancy` y `zoneStyles` se leen por referencia a propósito: si entraran
    // acá, cada refresco de datos reiniciaría el recorrido.
  }, [doc, level, renderer, mapRenderer, sprites, pushKill, surrender]);

  const critical = hud.health < CRITICAL_HEALTH;
  const lowAmmo = hud.ammo <= 12;

  return (
    <div ref={containerRef} className="bg-abyss absolute inset-0 z-30 select-none">
      <canvas
        ref={sceneRef}
        onPointerDown={handlePointerDown}
        className="block h-full w-full"
        style={{ imageRendering: "pixelated" }}
      />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0" />

      <KillFeed feed={feed} />

      <div className="border-edge bg-panel pointer-events-none absolute top-3 right-3 border p-[3px]">
        <canvas ref={minimapRef} className="block" />
        <p className="text-ink-dim absolute bottom-1.5 left-2 font-mono text-[8px] tracking-[0.18em]">
          {MINIMAP_SPAN} M
        </p>
      </div>

      {/* La barra hereda la anatomía del status bar clásico —celdas separadas,
          cifras grandes, etiquetas diminutas— pero con los tokens del visor. */}
      <div className="border-edge bg-panel pointer-events-none absolute inset-x-0 bottom-0 flex items-stretch border-t-2 font-mono">
        <Cell label="Carga" value={String(hud.ammo).padStart(3, "0")} alert={lowAmmo}>
          <Meter value={hud.ammo / MAX_AMMO} tone={lowAmmo ? "alert" : "signal"} />
        </Cell>

        <Cell
          label="Integridad"
          value={String(hud.health)}
          suffix="%"
          critical={critical}
          alert={critical}
        >
          <Meter value={hud.health / MAX_HEALTH} tone={critical ? "critical" : "ink"} />
        </Cell>

        <div className="border-line bg-canvas grid shrink-0 place-items-center border-r px-3.5">
          <OperatorState health={hud.health} />
        </div>

        <div className="flex min-w-0 grow flex-col justify-center gap-1.5 px-4 py-2 text-center">
          <p className="text-ink-dim text-[8.5px] tracking-[0.2em] uppercase">Zona</p>
          <p className="text-ink truncate text-[15px] leading-tight font-medium">{hud.zone}</p>
          <p className="text-ink-dim truncate text-[9.5px]">{hud.zoneMeta}</p>
        </div>

        <Cell label="Bajas" value={String(hud.kills).padStart(3, "0")} />
        <Cell label="Puntos" value={String(hud.score).padStart(6, "0")} tone="alert" last />
      </div>

      {defeated && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#7f1d1d]/40">
          <div className="bg-panel/95 border-t-2 border-[#e05656] px-9 py-6 text-center font-mono">
            <p className="text-ink-dim text-[9px] tracking-[0.32em] uppercase">
              Recorrido terminado
            </p>
            <p className="mt-2.5 text-lg tracking-[0.24em] text-[#e05656]">SIN INTEGRIDAD</p>
            <p className="text-ink-soft mt-3 text-[11px]">
              {hud.kills} bajas · {String(hud.score).padStart(6, "0")} puntos
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Teclas cuyo desplazamiento de página hay que cancelar mientras se recorre. */
const MOVEMENT_KEYS = new Set([
  "w", "a", "s", "d", "q", "e",
  "arrowup", "arrowdown", "arrowleft", "arrowright", " ",
]);
