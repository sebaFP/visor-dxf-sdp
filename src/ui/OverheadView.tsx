import { useEffect, useMemo, useRef, useState } from "react";
import type { DxfDocument, Vec2, ZoneLayer, ZoneRing } from "../core/dxf/types";
import { personField } from "../core/occupancy/extra-fields";
import type { OccupancySnapshot, Person } from "../core/occupancy/types";
import { formatZoneLabels, RAW_ZONE_LABEL, type ZoneLabeller } from "../core/occupancy/zone-names";
import { placePeople, type Placement } from "../core/render/placement";
import { PlanRenderer, type ZoneStyle } from "../core/render/plan-renderer";
import {
  bakeSprite,
  MINER_FALLEN_ART,
  MINER_STEP_ART,
  MINER_TOP_ART,
  MINER_TOP_PALETTE,
  OPERATOR_PALETTE,
  OPERATOR_TOP_ART,
  tintPalette,
  type BakedSprite,
} from "../core/render/sprites";
import { DARK_THEME, type PlanTheme } from "../core/render/theme";
import type { Viewport } from "../core/render/viewport";
import {
  Cell,
  companyOf,
  CRITICAL_HEALTH,
  KillFeed,
  Meter,
  OperatorState,
  RoundRail,
  UI,
  useKillFeed,
} from "./mode-hud";
import { CONTRACT_KEYS } from "./person-columns";

/**
 * Recorrido cenital del plano.
 *
 * La cámara mira el plano desde arriba y lo dibuja el mismo `PlanRenderer` que
 * el visor: el escenario no es una interpretación del plano, es el plano. Por
 * eso aquí no hay proyección que mantener ni baldosa que hornear — solo una
 * ventana que sigue al operador.
 *
 * La partida se juega zona a zona, **de la menos concurrida a la más**. La
 * curva de dificultad no está inventada: la pone la ocupación real del plano,
 * que es lo único que hace que este modo signifique algo. Al despejarlas todas
 * se vuelve a empezar, ya con ventaja para ellos.
 */

/**
 * Píxeles por unidad de mundo.
 *
 * A 16 caben unos ochenta metros de ancho: lo justo para ver venir a un grupo
 * entero sin que las figuras se vuelvan motas. Es la constante que decide si
 * esto se juega o se administra.
 */
const OVERHEAD_PX_PER_UNIT = 16;
/** Cuánto se adelanta la cámara hacia donde apuntas. Sin esto se dispara a ciegas. */
const CAMERA_LEAD = 0.22;
const CAMERA_MAX_LEAD = 14;
/** Constante de seguimiento. Alta persigue duro, baja marea. */
const CAMERA_SMOOTH = 8;

const PLAYER_SPEED = 6.4;
/**
 * Ancho de la figura en unidades de mundo.
 *
 * A 16 px por unidad esto son 42 px en pantalla. Por debajo de unos 36 el disco
 * del casco deja de leerse y las figuras se vuelven motas de color.
 */
const PLAYER_WIDTH = 2.6;
/** A qué distancia del grupo entra el operador al empezar una ronda. */
const SPAWN_DISTANCE = 17;
/** Radio con el que se mide "cuánta gente hay junta" al elegir por dónde entrar. */
const CLUSTER_REACH = 30;

/** Sombra de contacto: sin ella las figuras flotan sobre el trazado del plano. */
const SHADOW_ALPHA = 0.55;
const SHADOW_SQUASH = 0.42;
/** Alcance y apertura del haz de la lámpara, en unidades y radianes. */
const LAMP_REACH = 30;
const LAMP_HALF_ANGLE = 0.36;
/** Fase del paso: a cuánto va el bamboleo de los hombros. */
const STEP_RATE = 5.5;

const ZOMBIE_SPEED = 2.4;
const ZOMBIE_WIDTH = 2.4;
/** Radio del cuerpo para el impacto. Generoso: desde arriba se apunta peor. */
const ZOMBIE_RADIUS = 0.72;
const CONTACT_RANGE = 1.1;
const CONTACT_DPS = 6;
/**
 * Cuántos pueden morderte a la vez.
 *
 * Los de más allá del tope siguen ahí y siguen empujando; lo que no hacen es
 * sumar daño. Sin este tope, quedar rodeado por doce es morir en un segundo sin
 * entender por qué.
 */
const MAX_ATTACKERS = 3;
const ENEMY_HEALTH = 1;
const DEATH_TIME = 0.45;
const HURT_TIME = 0.14;

const MAX_HEALTH = 100;
const MAX_AMMO = 120;
const AMMO_PER_KILL = 4;
/**
 * El equipo se recarga solo al soltar el gatillo.
 *
 * Sin esto, gastar la carga con alguien todavía en pie deja la ronda sin forma
 * de terminar: no hay munición en el suelo que recoger, porque el suelo es un
 * plano de faena. La espera es el coste de fallar, no el final de la partida.
 */
const AMMO_RECHARGE_DELAY = 1.1;
const AMMO_RECHARGE_RATE = 9;
const SHOT_INTERVAL = 0.14;
const SCORE_PER_KILL = 100;
/** Lo que se recupera al despejar una zona. Es el respiro entre rondas. */
const HEAL_PER_ROUND = 25;

const BULLET_SPEED = 46;
const BULLET_LIFE = 1.1;

const MUZZLE_TIME = 0.05;
const RECOIL_TIME = 0.1;
/** Cuánto dura y cuánto abre el anillo del impacto. */
const RING_TIME = 0.26;
const RING_REACH = 2.6;
/**
 * Manchas que quedan en el suelo.
 *
 * Se pintan bajo las figuras y no caducan: el recinto va contando lo que ha
 * pasado en él. El tope es lo único que impide que una ronda de cuarenta deje
 * la lista creciendo sin fin.
 */
const MAX_DECALS = 90;

const SPLATTER_COUNT = 12;
const PARTICLE_LIFE = 0.55;
const PARTICLE_DRAG = 2.6;

/** Verde: la sangre de algo que ya no está del todo vivo. */
const BLOOD = "124, 240, 58";

/** Margen desde el borde al que se dibujan las flechas de quien queda fuera. */
const OFFSCREEN_MARGIN = 26;

/**
 * Minimapa: el recinto entero de un vistazo.
 *
 * No repite la vista más pequeña —eso no añadiría nada, porque la vista ya es
 * un mapa—: se aleja hasta encuadrar el anillo de la ronda completo. Contesta
 * las dos preguntas que la cámara no puede: qué forma tiene el sitio donde
 * estás y por dónde queda lo que falta.
 */
const MINIMAP_PX = 168;
const MINIMAP_PAD = 12;
/**
 * Tope de mundo encuadrado.
 *
 * Un anillo puede medir dos kilómetros; encuadrado entero, todo cabría en un
 * punto. Pasado el tope, el minimapa deja de encuadrar el recinto y pasa a
 * seguir al operador.
 */
const MINIMAP_MAX_SPAN = 240;
const MINIMAP_INTERVAL_FRAMES = 3;

const LABEL_RANGE = 24;
const MAX_LABELS = 6;
const LABEL_NAME_FONT = '600 11px "IBM Plex Mono", ui-monospace, Menlo, monospace';
const LABEL_META_FONT = '9px "IBM Plex Mono", ui-monospace, Menlo, monospace';

/** Cuánto se queda la tarjeta entre rondas, en segundos. */
const ROUND_CARD_TIME = 1.9;
/** Tras caer, cuánto se muestra el marcador antes de volver al plano. */
const DEFEAT_MS = 2200;
const HUD_INTERVAL_FRAMES = 10;

/**
 * El plano se dibuja limpio: sin relleno de densidad y sin rótulos.
 *
 * El color de ocupación tapa la traza justo donde hay gente, que es donde hace
 * falta verla, y el texto del DXF a esta escala es ruido bajo los pies.
 */
const OVERHEAD_THEME: PlanTheme = {
  ...DARK_THEME,
  background: UI.abyss,
  baseStroke: "#6d88a8",
  baseText: UI.inkDim,
  emptyFill: "rgba(0, 0, 0, 0)",
  zoneStroke: "#3c5670",
  dimmedAlpha: 1,
};
const NO_ZONE_STYLES = new Map<string, ZoneStyle>();

const MOVEMENT_KEYS = new Set([
  "w", "a", "s", "d",
  "arrowup", "arrowdown", "arrowleft", "arrowright", " ",
]);

export interface OverheadViewProps {
  doc: DxfDocument;
  occupancy: OccupancySnapshot;
  /** Zona por la que empezar. Sin ella se empieza por la menos concurrida. */
  startLayer: string | null;
  zoneLabel?: ZoneLabeller;
  onExit: () => void;
}

interface Enemy {
  person: Person;
  x: number;
  y: number;
  angle: number;
  health: number;
  hurt: number;
  dying: number;
  dead: boolean;
  /** Fase del paso. Desfasada por persona para que no anden todos a la vez. */
  step: number;
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

/** Una mancha en el suelo. No caduca. */
interface Decal {
  x: number;
  y: number;
  radius: number;
  squash: number;
}

/** El anillo que se abre en un impacto. */
interface Ring {
  x: number;
  y: number;
  life: number;
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
  cooldown: number;
  /** Segundos desde el último disparo. Manda la recarga. */
  idle: number;
  /** Cuenta atrás del fogonazo y del retroceso del equipo. */
  muzzle: number;
  recoil: number;
  /** Sacudida de cámara pendiente. */
  shake: number;
  /** Intensidad de la viñeta roja de daño, 0..1. */
  sting: number;
  /**
   * De dónde vino el último mordisco, en radianes.
   *
   * La viñeta entra por ese lado: un pulso desde todos los bordes dice que te
   * están haciendo daño, pero no hacia dónde girar.
   */
  stingAngle: number;
  defeated: boolean;
}

/**
 * Un recinto con gente dentro: una ronda.
 *
 * Es un **anillo**, no una capa. Una capa como "75-142-128-207" cubre cuatro
 * salas en distintos niveles del plano, a kilómetros unas de otras: jugarla
 * entera sería despejar una sala y caminar cinco minutos hasta la siguiente.
 * Un anillo es un sitio, y un sitio es una ronda.
 */
interface Arena {
  zl: ZoneLayer;
  ring: ZoneRing;
  /** Sufijo cuando la capa aporta más de un recinto. Vacío si aporta uno solo. */
  sector: string;
  path: Path2D;
  people: Placement[];
}

interface Round {
  /** Índice dentro de `arenas`. */
  index: number;
  /** Vuelta completa al plano. Cada una sube la dificultad. */
  cycle: number;
  total: number;
  /** Segundos que quedan de tarjeta; 0 mientras se pelea. */
  pause: number;
  speed: number;
  contactDps: number;
  maxAttackers: number;
  scoreMultiplier: number;
}

interface Hud {
  zone: string;
  round: number;
  cycle: number;
  alive: number;
  total: number;
  health: number;
  ammo: number;
  kills: number;
  score: number;
}

interface RoundCard {
  title: string;
  zone: string;
  detail: string;
}

/** Multiplicadores de la vuelta N. La primera es la fácil, a propósito. */
function difficulty(cycle: number) {
  return {
    speed: ZOMBIE_SPEED * (1 + 0.22 * cycle),
    health: ENEMY_HEALTH + cycle,
    contactDps: CONTACT_DPS * (1 + 0.3 * cycle),
    maxAttackers: MAX_ATTACKERS + cycle,
    scoreMultiplier: 1 + cycle,
  };
}

/**
 * Sitio desde el que entrar a una ronda: a `distance` del grupo y por el lado
 * más despejado.
 *
 * Nacer en medio del corro es no ver nada y empezar mordido. No se comprueba
 * geometría porque en este modo nadie choca con ella — la única condición que
 * importa es tener aire por delante.
 */
function vantage(center: Vec2, enemies: Enemy[], distance: number): Vec2 {
  let best = { x: center.x + distance, y: center.y };
  let bestGap = -Infinity;

  for (let i = 0; i < 32; i++) {
    const angle = (i / 32) * Math.PI * 2;
    const at = {
      x: center.x + Math.cos(angle) * distance,
      y: center.y + Math.sin(angle) * distance,
    };
    let gap = Infinity;
    for (const enemy of enemies) {
      const d = (enemy.x - at.x) ** 2 + (enemy.y - at.y) ** 2;
      if (d < gap) gap = d;
    }
    if (gap > bestGap) {
      bestGap = gap;
      best = at;
    }
  }

  return best;
}

/**
 * El sitio con más gente alrededor.
 *
 * Ni el centroide del polígono ni la media de las posiciones sirven: una capa
 * como "75-142-128-207" cubre cuatro zonas repartidas por medio plano, y tanto
 * el centro del polígono como la media de la gente caen entre ellas, donde no
 * hay nadie. Se entra por donde de verdad hay alguien.
 */
function densestSpot(enemies: Enemy[]): Vec2 | null {
  if (enemies.length === 0) return null;

  const reach2 = CLUSTER_REACH * CLUSTER_REACH;
  let best = enemies[0];
  let bestCount = -1;

  for (const candidate of enemies) {
    let count = 0;
    for (const other of enemies) {
      if ((other.x - candidate.x) ** 2 + (other.y - candidate.y) ** 2 <= reach2) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }

  return { x: best.x, y: best.y };
}

function ringPath(ring: ZoneRing): Path2D {
  const path = new Path2D();
  const pts = ring.points;
  if (pts.length < 2) return path;
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
  path.closePath();
  return path;
}

export default function OverheadView({
  doc,
  occupancy,
  startLayer,
  zoneLabel = RAW_ZONE_LABEL,
  onExit,
}: OverheadViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);

  const [hud, setHud] = useState<Hud>({
    zone: "",
    round: 0,
    cycle: 0,
    alive: 0,
    total: 0,
    health: MAX_HEALTH,
    ammo: MAX_AMMO,
    kills: 0,
    score: 0,
  });
  const [card, setCard] = useState<RoundCard | null>(null);
  const [defeated, setDefeated] = useState(false);
  const [feed, pushKill] = useKillFeed();

  /**
   * El rol se congela al entrar.
   *
   * `occupancy` cambia de identidad en cada refresco de TanStack Query; si las
   * rondas dependieran de él, la partida se reiniciaría sola cada pocos
   * segundos.
   */
  const rosterRef = useRef(occupancy);
  const roster = rosterRef.current;

  const renderer = useMemo(() => new PlanRenderer(doc, OVERHEAD_THEME), [doc]);

  const sprites = useMemo(() => {
    // El destello del impacto no tiñe el contorno: si se aclara el borde, la
    // figura pierde el recorte justo en el fotograma en que hay que verla.
    const hurt = { ...tintPalette(MINER_TOP_PALETTE, "#eaffd0", 0.72), O: MINER_TOP_PALETTE.O };
    return {
      miner: bakeSprite(MINER_TOP_ART, MINER_TOP_PALETTE),
      minerStep: bakeSprite(MINER_STEP_ART, MINER_TOP_PALETTE),
      minerHurt: bakeSprite(MINER_TOP_ART, hurt),
      fallen: bakeSprite(MINER_FALLEN_ART, MINER_TOP_PALETTE),
      operator: bakeSprite(OPERATOR_TOP_ART, OPERATOR_PALETTE),
    };
  }, []);

  /**
   * Las zonas con gente, de la menos concurrida a la más.
   *
   * Este orden ES el diseño de niveles: la zona de tres detectados enseña a
   * moverse y la de cuarenta es el final. No hay que inventarse una curva
   * porque el plano ya la trae puesta.
   */
  const arenas = useMemo<Arena[]>(() => {
    // La colocación se hace una sola vez, para todo el plano: cada persona cae
    // siempre en el mismo punto, así que repetirla por ronda solo costaría.
    const byRing = new Map<string, Placement[]>();
    for (const placement of placePeople(doc, roster)) {
      const key = `${placement.layer}#${placement.ringIndex}`;
      const bucket = byRing.get(key);
      if (bucket) bucket.push(placement);
      else byRing.set(key, [placement]);
    }

    const perLayer = new Map<string, number>();
    for (const key of byRing.keys()) {
      const layer = key.slice(0, key.lastIndexOf("#"));
      perLayer.set(layer, (perLayer.get(layer) ?? 0) + 1);
    }

    const list: Arena[] = [];
    for (const [key, people] of byRing) {
      const cut = key.lastIndexOf("#");
      const layer = key.slice(0, cut);
      const zl = doc.zoneLayers.find((z) => z.layer === layer);
      if (!zl) continue;
      const ring = zl.rings[Number(key.slice(cut + 1))];
      if (!ring) continue;
      const sectors = perLayer.get(layer) ?? 1;
      list.push({
        zl,
        ring,
        sector: sectors > 1 ? ` · sector ${Number(key.slice(cut + 1)) + 1}` : "",
        path: ringPath(ring),
        people,
      });
    }

    list.sort((a, b) => a.people.length - b.people.length || a.zl.layer.localeCompare(b.zl.layer));

    // Si el visor traía una zona seleccionada, se empieza por ella: al usuario
    // le costaría entender por qué el modo ignora lo que acababa de elegir.
    const chosen = list.findIndex((a) => a.zl.layer === startLayer);
    if (chosen > 0) list.unshift(...list.splice(chosen, 1));
    return list;
  }, [doc, roster, startLayer]);

  const liveRef = useRef({ zoneLabel });
  liveRef.current = { zoneLabel };

  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  const playerRef = useRef<Player>({ x: 0, y: 0, angle: 0 });
  const cameraRef = useRef<Vec2>({ x: 0, y: 0 });
  const viewRef = useRef<Viewport>({ scale: OVERHEAD_PX_PER_UNIT, tx: 0, ty: 0 });
  const enemiesRef = useRef<Enemy[]>([]);
  const bulletsRef = useRef<Bullet[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const decalsRef = useRef<Decal[]>([]);
  const ringsRef = useRef<Ring[]>([]);
  const statsRef = useRef<Stats>({
    health: MAX_HEALTH,
    ammo: MAX_AMMO,
    kills: 0,
    score: 0,
    cooldown: 0,
    idle: 0,
    muzzle: 0,
    recoil: 0,
    shake: 0,
    sting: 0,
    stingAngle: 0,
    defeated: false,
  });
  const roundRef = useRef<Round>({
    index: 0,
    cycle: 0,
    total: 0,
    pause: 0,
    ...difficulty(0),
  });
  const keysRef = useRef(new Set<string>());
  /** Botón mantenido: dispara en cadena mientras esté abajo. */
  const firingRef = useRef(false);
  /**
   * Un clic suelto, enganchado hasta que lo consuma el bucle.
   *
   * Un clic dura menos que un fotograma: leer solo el estado del botón pierde
   * los disparos rápidos, que son justo los que se sienten.
   */
  const firePendingRef = useRef(false);
  /** Puntero en píxeles CSS del lienzo. Es la mira: no hay bloqueo de puntero. */
  const aimRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const minimap = minimapRef.current;
    if (!canvas || !container || !minimap) return;

    const ctx = canvas.getContext("2d");
    const mctx = minimap.getContext("2d");
    if (!ctx || !mctx) return;

    const dpr = window.devicePixelRatio || 1;
    let cssWidth = 1;
    let cssHeight = 1;
    let running = true;
    let tick = 0;
    let hudCountdown = 0;
    let last = performance.now();

    const resize = (): void => {
      cssWidth = Math.max(1, container.clientWidth);
      cssHeight = Math.max(1, container.clientHeight);
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      minimap.width = Math.round(MINIMAP_PX * dpr);
      minimap.height = Math.round(MINIMAP_PX * dpr);
      minimap.style.width = `${MINIMAP_PX}px`;
      minimap.style.height = `${MINIMAP_PX}px`;
      aimRef.current = { x: cssWidth / 2, y: cssHeight / 2 };
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    // --- Rondas -------------------------------------------------------------

    const startRound = (index: number, cycle: number): void => {
      const arena = arenas[index];
      const tuning = difficulty(cycle);

      const enemies: Enemy[] = arena.people.map(({ person, at, seed }) => ({
        person,
        x: at.x,
        y: at.y,
        angle: 0,
        health: tuning.health,
        hurt: 0,
        dying: 0,
        dead: false,
        // Derivada del hash de la persona: doce zombis andando al unísono
        // parecen un desfile, no una cuadrilla.
        step: (seed % 1000) / 1000 * Math.PI * 2,
      }));
      enemiesRef.current = enemies;
      bulletsRef.current = [];
      particlesRef.current = [];
      ringsRef.current = [];
      // Las manchas se quedan con su recinto: cambiar de ronda es cambiar de
      // sitio, y arrastrarlas sería pintar sangre donde no ha pasado nada.
      decalsRef.current = [];

      const centre = densestSpot(enemies) ?? arena.zl.labelPoint;

      const at = vantage(centre, enemies, SPAWN_DISTANCE);
      playerRef.current = {
        x: at.x,
        y: at.y,
        angle: Math.atan2(centre.y - at.y, centre.x - at.x),
      };
      cameraRef.current = { x: at.x, y: at.y };

      const stats = statsRef.current;
      stats.ammo = MAX_AMMO;
      roundRef.current = {
        index,
        cycle,
        total: enemies.length,
        pause: 0,
        speed: tuning.speed,
        contactDps: tuning.contactDps,
        maxAttackers: tuning.maxAttackers,
        scoreMultiplier: tuning.scoreMultiplier,
      };

      setCard(null);
      refreshHud();
    };

    const clearRound = (): void => {
      const round = roundRef.current;
      const stats = statsRef.current;
      const arena = arenas[round.index];

      const healed = Math.min(MAX_HEALTH, stats.health + HEAL_PER_ROUND);
      const gained = Math.round(healed - stats.health);
      stats.health = healed;
      round.pause = ROUND_CARD_TIME;

      const lastArena = round.index === arenas.length - 1;
      setCard({
        title: lastArena ? "Plano despejado" : "Zona despejada",
        zone: labelOf(arena),
        detail: lastArena
          ? `Vuelta ${round.cycle + 2}: vuelven a levantarse, y más rápido`
          : `Equipo recargado · integridad +${gained}`,
      });
    };

    const advanceRound = (): void => {
      const round = roundRef.current;
      const next = round.index + 1;
      if (next < arenas.length) startRound(next, round.cycle);
      else startRound(0, round.cycle + 1);
    };

    const labelOf = (arena: Arena): string =>
      formatZoneLabels(arena.zl.zoneIds, liveRef.current.zoneLabel) + arena.sector;

    // --- Combate ------------------------------------------------------------

    const splatter = (x: number, y: number): void => {
      const particles = particlesRef.current;
      for (let i = 0; i < SPLATTER_COUNT; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 5;
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: PARTICLE_LIFE,
        });
      }
    };

    const damage = (enemy: Enemy): void => {
      enemy.health -= 1;
      enemy.hurt = HURT_TIME;
      splatter(enemy.x, enemy.y);
      ringsRef.current.push({ x: enemy.x, y: enemy.y, life: RING_TIME });
      if (enemy.health > 0) return;

      enemy.dying = DEATH_TIME;
      // La mancha se queda donde cayó.
      const decals = decalsRef.current;
      decals.push({
        x: enemy.x,
        y: enemy.y,
        radius: 0.7 + Math.random() * 0.5,
        squash: 0.42 + Math.random() * 0.16,
      });
      if (decals.length > MAX_DECALS) decals.splice(0, decals.length - MAX_DECALS);
      const stats = statsRef.current;
      const round = roundRef.current;
      stats.kills += 1;
      stats.score += SCORE_PER_KILL * round.scoreMultiplier;
      stats.ammo = Math.min(MAX_AMMO, stats.ammo + AMMO_PER_KILL);
      pushKill(enemy.person);
    };

    const shoot = (): void => {
      const stats = statsRef.current;
      if (stats.cooldown > 0 || stats.ammo < 1 || stats.defeated) return;

      stats.cooldown = SHOT_INTERVAL;
      stats.idle = 0;
      stats.ammo -= 1;
      stats.muzzle = MUZZLE_TIME;
      stats.recoil = RECOIL_TIME;

      const player = playerRef.current;
      const cos = Math.cos(player.angle);
      const sin = Math.sin(player.angle);
      bulletsRef.current.push({
        // Sale de la boca del equipo, no del centro del cuerpo: si no, el primer
        // fotograma del disparo aparece encima de ti.
        x: player.x + cos * (PLAYER_WIDTH * 0.5),
        y: player.y + sin * (PLAYER_WIDTH * 0.5),
        vx: cos * BULLET_SPEED,
        vy: sin * BULLET_SPEED,
        life: BULLET_LIFE,
      });
    };

    /**
     * Avanza las balas y resuelve impactos contra el tramo recorrido.
     *
     * Comprobar solo la posición final se cuela entre fotogramas: a 46 u/s el
     * paso mide 0,77 unidades y el cuerpo 0,72 de radio. Se mide la distancia
     * del enemigo al segmento, que es el recorrido real de la bala.
     */
    const advanceBullets = (dt: number): void => {
      const bullets = bulletsRef.current;
      const enemies = enemiesRef.current;
      const r2 = ZOMBIE_RADIUS * ZOMBIE_RADIUS;
      let write = 0;

      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i];
        b.life -= dt;
        if (b.life <= 0) continue;

        const dx = b.vx * dt;
        const dy = b.vy * dt;
        const len2 = dx * dx + dy * dy;

        let struck: Enemy | null = null;
        let bestT = Infinity;
        for (const enemy of enemies) {
          if (enemy.dead || enemy.dying > 0) continue;
          const rx = enemy.x - b.x;
          const ry = enemy.y - b.y;
          let t = len2 === 0 ? 0 : (rx * dx + ry * dy) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = rx - dx * t;
          const qy = ry - dy * t;
          if (qx * qx + qy * qy > r2) continue;
          if (t < bestT) {
            bestT = t;
            struck = enemy;
          }
        }

        if (struck) {
          damage(struck);
          continue;
        }

        b.x += dx;
        b.y += dy;
        bullets[write++] = b;
      }

      bullets.length = write;
    };

    const advanceEnemies = (dt: number): void => {
      const player = playerRef.current;
      const stats = statsRef.current;
      const round = roundRef.current;
      const enemies = enemiesRef.current;
      let attackers = 0;
      let alive = 0;

      for (const enemy of enemies) {
        if (enemy.dead) continue;

        enemy.hurt = Math.max(0, enemy.hurt - dt);

        if (enemy.dying > 0) {
          enemy.dying -= dt;
          if (enemy.dying <= 0) enemy.dead = true;
          continue;
        }
        alive += 1;

        // Sin tope de distancia: son unas decenas por ronda, y con un tope,
        // alejarse lo suficiente deja a los últimos plantados y la ronda no
        // termina nunca.
        const relX = player.x - enemy.x;
        const relY = player.y - enemy.y;
        const distance = Math.hypot(relX, relY);
        enemy.angle = Math.atan2(relY, relX);

        if (distance <= CONTACT_RANGE) {
          if (attackers < round.maxAttackers) {
            attackers += 1;
            stats.health -= round.contactDps * dt;
            stats.sting = Math.min(1, stats.sting + dt * 3.5);
            stats.stingAngle = Math.atan2(-relY, -relX);
            stats.shake = Math.max(stats.shake, 1.1);
          }
          continue;
        }

        const advance = (round.speed * dt) / distance;
        enemy.x += relX * advance;
        enemy.y += relY * advance;
        enemy.step += dt * STEP_RATE;
      }

      if (alive === 0 && round.pause <= 0 && !stats.defeated) clearRound();
    };

    const advanceRings = (dt: number): void => {
      const rings = ringsRef.current;
      let write = 0;
      for (const ring of rings) {
        ring.life -= dt;
        if (ring.life > 0) rings[write++] = ring;
      }
      rings.length = write;
    };

    const advanceParticles = (dt: number): void => {
      const particles = particlesRef.current;
      const drag = Math.max(0, 1 - PARTICLE_DRAG * dt);
      let write = 0;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) continue;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= drag;
        p.vy *= drag;
        particles[write++] = p;
      }
      particles.length = write;
    };

    const surrender = (): void => {
      setDefeated(true);
      window.setTimeout(() => exitRef.current(), DEFEAT_MS);
    };

    const advance = (dt: number): void => {
      const stats = statsRef.current;
      const round = roundRef.current;
      const player = playerRef.current;

      stats.cooldown = Math.max(0, stats.cooldown - dt);
      stats.muzzle = Math.max(0, stats.muzzle - dt);
      stats.recoil = Math.max(0, stats.recoil - dt);
      stats.shake = Math.max(0, stats.shake - dt * 7);
      stats.idle += dt;
      if (stats.idle > AMMO_RECHARGE_DELAY && stats.ammo < MAX_AMMO) {
        stats.ammo = Math.min(MAX_AMMO, stats.ammo + AMMO_RECHARGE_RATE * dt);
      }
      stats.sting = Math.max(0, stats.sting - dt * 2.2);

      if (stats.defeated) return;

      // Apuntado: el cursor es la mira, así que el ángulo sale de la ventana del
      // fotograma anterior. El desfase es de 16 ms y no se ve.
      const view = viewRef.current;
      const aim = aimRef.current;
      const aimX = (aim.x - view.tx) / view.scale;
      const aimY = -(aim.y - view.ty) / view.scale;
      player.angle = Math.atan2(aimY - player.y, aimX - player.x);

      if (round.pause > 0) {
        round.pause -= dt;
        if (round.pause <= 0) advanceRound();
        return;
      }

      const keys = keysRef.current;
      // Movimiento en el marco de la pantalla, no en el del cuerpo: en cenital
      // "arriba" es el norte del plano y no la dirección en la que apuntas.
      const north = (keys.has("w") || keys.has("arrowup") ? 1 : 0) -
        (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
      const east = (keys.has("d") || keys.has("arrowright") ? 1 : 0) -
        (keys.has("a") || keys.has("arrowleft") ? 1 : 0);

      if (north !== 0 || east !== 0) {
        // Normalizar la diagonal: si no, moverse en diagonal es un 41% más rápido.
        const len = Math.hypot(north, east);
        const speed = (PLAYER_SPEED * dt) / len;
        // Sin colisión, a propósito, igual que en el recorrido en perspectiva:
        // la capa base del DXF no distingue un muro de un achurado o de una
        // línea de cota, y quedarse trabado contra una cota sería lo primero
        // que pasaría.
        player.x += east * speed;
        player.y += north * speed;
      }

      if (firingRef.current || firePendingRef.current) {
        firePendingRef.current = false;
        shoot();
      }

      advanceBullets(dt);
      advanceEnemies(dt);
      advanceParticles(dt);
      advanceRings(dt);

      if (stats.health <= 0 && !stats.defeated) {
        stats.health = 0;
        stats.defeated = true;
        surrender();
      }
    };

    // --- Dibujo -------------------------------------------------------------

    const followCamera = (dt: number): Viewport => {
      const player = playerRef.current;
      const cam = cameraRef.current;
      const view = viewRef.current;
      const stats = statsRef.current;

      // La cámara se adelanta hacia la mira: sin eso se dispara contra el borde
      // de la pantalla sin ver qué hay detrás.
      const aim = aimRef.current;
      let leadX = ((aim.x - view.tx) / view.scale - player.x) * CAMERA_LEAD;
      let leadY = (-(aim.y - view.ty) / view.scale - player.y) * CAMERA_LEAD;
      const lead = Math.hypot(leadX, leadY);
      if (lead > CAMERA_MAX_LEAD) {
        leadX = (leadX / lead) * CAMERA_MAX_LEAD;
        leadY = (leadY / lead) * CAMERA_MAX_LEAD;
      }

      const follow = Math.min(1, CAMERA_SMOOTH * dt);
      cam.x += (player.x + leadX - cam.x) * follow;
      cam.y += (player.y + leadY - cam.y) * follow;

      // La sacudida va en la ventana y no en el lienzo: así la arrastra todo,
      // plano incluido, y no solo las figuras.
      const shake = stats.shake * 3;
      const scale = OVERHEAD_PX_PER_UNIT;
      const next = {
        scale,
        tx: cssWidth / 2 - cam.x * scale + (Math.random() - 0.5) * shake,
        ty: cssHeight / 2 + cam.y * scale + (Math.random() - 0.5) * shake,
      };
      viewRef.current = next;
      return next;
    };

    const toScreenX = (wx: number, view: Viewport): number => wx * view.scale + view.tx;
    const toScreenY = (wy: number, view: Viewport): number => -wy * view.scale + view.ty;

    /** La elipse difusa que apoya una figura en el suelo. */
    const drawShadow = (wx: number, wy: number, width: number, view: Viewport): void => {
      const rx = (width * view.scale) / 2.4;
      ctx.save();
      ctx.translate(toScreenX(wx, view), toScreenY(wy, view) + rx * 0.28);
      ctx.scale(1, SHADOW_SQUASH);
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 0, 0, ${SHADOW_ALPHA})`;
      ctx.fill();
      ctx.restore();
    };

    const drawSprite = (
      baked: BakedSprite,
      wx: number,
      wy: number,
      angle: number,
      width: number,
      view: Viewport,
    ): void => {
      const w = width * view.scale;
      const h = (baked.rows / baked.cols) * w;
      ctx.save();
      ctx.translate(toScreenX(wx, view), toScreenY(wy, view));
      // La Y del mundo crece hacia arriba y la del lienzo hacia abajo, así que
      // un giro antihorario del mundo es horario en pantalla.
      ctx.rotate(-angle);
      ctx.drawImage(baked.canvas, -w / 2, -h / 2, w, h);
      ctx.restore();
    };

    /**
     * El recinto de la ronda: dentro a plena luz, fuera atenuado.
     *
     * Es lo que dice dónde se juega sin tapar el plano. El velo se pinta con
     * `evenodd` sobre la pantalla entera menos el anillo, así que basta un
     * relleno y no hace falta un segundo renderer.
     */
    const drawArena = (view: Viewport, path: Path2D): void => {
      ctx.save();
      ctx.setTransform(dpr * view.scale, 0, 0, -dpr * view.scale, dpr * view.tx, dpr * view.ty);

      const outside = new Path2D();
      const a = { x: (0 - view.tx) / view.scale, y: -(0 - view.ty) / view.scale };
      const b = { x: (cssWidth - view.tx) / view.scale, y: -(cssHeight - view.ty) / view.scale };
      outside.rect(a.x, b.y, b.x - a.x, a.y - b.y);
      outside.addPath(path);
      ctx.fillStyle = "rgba(6, 9, 13, 0.62)";
      ctx.fill(outside, "evenodd");

      // Resplandor hacia dentro: tres trazos cada vez más finos y más opacos.
      const unit = 1 / view.scale;
      for (const [width, alpha] of [
        [9, 0.05],
        [4.5, 0.08],
        [1.6, 0.55],
      ] as const) {
        ctx.lineWidth = width * unit;
        ctx.strokeStyle = `rgba(240, 166, 60, ${alpha})`;
        ctx.setLineDash(width < 2 ? [9 * unit, 6 * unit] : []);
        ctx.stroke(path);
      }
      ctx.setLineDash([]);
      ctx.restore();
    };

    /** El haz del casco. Dice hacia dónde apuntas mejor que la propia figura. */
    const drawLamp = (view: Viewport): void => {
      const player = playerRef.current;
      const px = toScreenX(player.x, view);
      const py = toScreenY(player.y, view);
      const reach = LAMP_REACH * view.scale;
      const angle = -player.angle;

      const gradient = ctx.createRadialGradient(px, py, 0, px, py, reach);
      gradient.addColorStop(0, "rgba(240, 166, 60, 0.26)");
      gradient.addColorStop(0.5, "rgba(240, 166, 60, 0.10)");
      gradient.addColorStop(1, "rgba(240, 166, 60, 0)");

      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, reach, angle - LAMP_HALF_ANGLE, angle + LAMP_HALF_ANGLE);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    };

    const drawLabels = (view: Viewport): void => {
      const player = playerRef.current;
      const range2 = LABEL_RANGE * LABEL_RANGE;
      const near: { enemy: Enemy; d2: number }[] = [];

      for (const enemy of enemiesRef.current) {
        if (enemy.dead || enemy.dying > 0) continue;
        const d2 = (enemy.x - player.x) ** 2 + (enemy.y - player.y) ** 2;
        if (d2 > range2) continue;
        near.push({ enemy, d2 });
      }
      near.sort((a, b) => a.d2 - b.d2);
      near.length = Math.min(near.length, MAX_LABELS);

      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const boxes: { left: number; right: number; top: number; bottom: number }[] = [];

      for (const { enemy, d2 } of near) {
        const x = toScreenX(enemy.x, view);
        const y = toScreenY(enemy.y, view) - (ZOMBIE_WIDTH * view.scale) / 2 - 6;
        const name = enemy.person.name;
        const contract = personField(enemy.person, CONTRACT_KEYS);
        const meta = `${companyOf(enemy.person)}${contract ? ` · ${contract}` : ""}`;

        ctx.font = LABEL_NAME_FONT;
        const width = Math.max(ctx.measureText(name).width, ctx.measureText(meta).width) + 16;
        const box = { left: x - width / 2, right: x + width / 2, top: y - 30, bottom: y + 4 };
        // Amontonados, los rótulos son una mancha: el que llega tarde no se pinta.
        if (
          boxes.some(
            (b) => b.left < box.right && b.right > box.left && b.top < box.bottom && b.bottom > box.top,
          )
        ) {
          continue;
        }
        boxes.push(box);

        ctx.fillStyle = "rgba(9, 14, 20, 0.9)";
        ctx.fillRect(box.left, box.top, width, 34);
        ctx.fillStyle = UI.alert;
        ctx.fillRect(box.left, box.top, width, 1);

        ctx.fillStyle = UI.ink;
        ctx.font = LABEL_NAME_FONT;
        ctx.fillText(name, x, y - 17);
        ctx.fillStyle = UI.inkDim;
        ctx.font = LABEL_META_FONT;
        ctx.fillText(meta, x, y - 6);
        ctx.fillStyle = UI.inkDim;
        ctx.fillText(`${Math.sqrt(d2).toFixed(0)} M`, x, y + 1);
      }
    };

    /**
     * Flechas en el borde por cada enemigo fuera de cuadro.
     *
     * Sin ellas, el último que queda en pie de una ronda se busca a ciegas
     * dando vueltas por el recinto.
     */
    const drawOffscreen = (view: Viewport): void => {
      const player = playerRef.current;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = LABEL_META_FONT;

      for (const enemy of enemiesRef.current) {
        if (enemy.dead || enemy.dying > 0) continue;
        const sx = toScreenX(enemy.x, view);
        const sy = toScreenY(enemy.y, view);
        if (sx >= 0 && sx <= cssWidth && sy >= 0 && sy <= cssHeight) continue;

        const cx = cssWidth / 2;
        const cy = cssHeight / 2;
        const angle = Math.atan2(sy - cy, sx - cx);
        const halfW = cssWidth / 2 - OFFSCREEN_MARGIN;
        const halfH = cssHeight / 2 - OFFSCREEN_MARGIN;
        // Proyección al borde del rectángulo, no a un círculo: en apaisado un
        // círculo deja las flechas laterales muy adentro.
        const scale = Math.min(
          halfW / Math.max(1e-6, Math.abs(Math.cos(angle))),
          halfH / Math.max(1e-6, Math.abs(Math.sin(angle))),
        );
        const ex = cx + Math.cos(angle) * scale;
        const ey = cy + Math.sin(angle) * scale;
        const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);

        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(angle);
        ctx.fillStyle = UI.critical;
        ctx.beginPath();
        ctx.moveTo(7, 0);
        ctx.lineTo(-4, 5);
        ctx.lineTo(-4, -5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = UI.inkDim;
        ctx.fillText(
          `${distance.toFixed(0)} M`,
          ex - Math.cos(angle) * 20,
          ey - Math.sin(angle) * 20,
        );
      }
    };

    /**
     * El minimapa, encuadrando el recinto entero.
     *
     * Se dibuja con el MISMO renderer que la escena, solo que con otra ventana:
     * no hay baldosa que hornear ni un segundo `PlanRenderer` que mantener en
     * sincronía, y el pase cuesta lo mismo que el de la escena.
     */
    const drawMinimap = (): void => {
      const player = playerRef.current;
      const arena = arenas[roundRef.current.index];
      const { minX, maxX, minY, maxY } = arena.ring.bounds;
      const span = Math.max(maxX - minX, maxY - minY, 1e-6);
      const inner = MINIMAP_PX - MINIMAP_PAD * 2;

      const framed = span <= MINIMAP_MAX_SPAN;
      const scale = inner / (framed ? span : MINIMAP_MAX_SPAN);
      const cx = framed ? (minX + maxX) / 2 : player.x;
      const cy = framed ? (minY + maxY) / 2 : player.y;
      const view: Viewport = {
        scale,
        tx: MINIMAP_PX / 2 - cx * scale,
        ty: MINIMAP_PX / 2 + cy * scale,
      };

      renderer.render(mctx, {
        viewport: view,
        width: MINIMAP_PX,
        height: MINIMAP_PX,
        zoneStyles: NO_ZONE_STYLES,
        showBaseText: false,
      });

      // A esta escala el plano entero cabe en el recuadro y el trazado se vuelve
      // ruido: atenuarlo es lo que deja que se lean las marcas encima. Un velo
      // sale gratis; un segundo renderer costaría otro horneado.
      mctx.fillStyle = "rgba(6, 9, 13, 0.6)";
      mctx.fillRect(0, 0, MINIMAP_PX, MINIMAP_PX);

      mctx.save();
      mctx.setTransform(dpr * scale, 0, 0, -dpr * scale, dpr * view.tx, dpr * view.ty);
      mctx.strokeStyle = "rgba(240, 166, 60, 0.8)";
      mctx.lineWidth = 1.6 / scale;
      mctx.stroke(arena.path);
      mctx.restore();

      // Quien queda en pie. Cuadrados y no círculos: a tres píxeles, un círculo
      // antialiaseado se convierte en una mancha gris.
      for (const enemy of enemiesRef.current) {
        if (enemy.dead || enemy.dying > 0) continue;
        const ex = enemy.x * scale + view.tx;
        const ey = -enemy.y * scale + view.ty;
        if (ex < 0 || ey < 0 || ex > MINIMAP_PX || ey > MINIMAP_PX) continue;
        // Un borde oscuro bajo cada marca: sin él se pierden sobre una línea
        // clara del plano justo cuando hace falta contarlas.
        mctx.fillStyle = UI.abyss;
        mctx.fillRect(ex - 2.5, ey - 2.5, 5, 5);
        mctx.fillStyle = UI.critical;
        mctx.fillRect(ex - 1.5, ey - 1.5, 3, 3);
      }

      const px = player.x * scale + view.tx;
      const py = -player.y * scale + view.ty;
      const angle = -player.angle;
      const arrow = (reach: number): void => {
        mctx.beginPath();
        mctx.moveTo(px + Math.cos(angle) * reach, py + Math.sin(angle) * reach);
        mctx.lineTo(px + Math.cos(angle + 2.5) * reach * 0.72, py + Math.sin(angle + 2.5) * reach * 0.72);
        mctx.lineTo(px + Math.cos(angle - 2.5) * reach * 0.72, py + Math.sin(angle - 2.5) * reach * 0.72);
        mctx.closePath();
        mctx.fill();
      };
      mctx.fillStyle = UI.abyss;
      arrow(11);
      mctx.fillStyle = UI.signal;
      arrow(8.5);

      mctx.fillStyle = UI.inkDim;
      mctx.font = LABEL_META_FONT;
      mctx.textAlign = "left";
      mctx.textBaseline = "alphabetic";
      mctx.fillText(`${Math.round(framed ? span : MINIMAP_MAX_SPAN)} M`, 7, MINIMAP_PX - 7);
    };

    const draw = (view: Viewport): void => {
      // El plano es el escenario. `PlanRenderer` deja el contexto en píxeles CSS
      // y con la traza ya horneada en un `Path2D`, así que esto es un puñado de
      // `stroke()` — lo mismo que cuesta arrastrar el plano en el visor.
      renderer.render(ctx, {
        viewport: view,
        width: cssWidth,
        height: cssHeight,
        zoneStyles: NO_ZONE_STYLES,
        showBaseText: false,
      });

      const round = roundRef.current;
      const arena = arenas[round.index];
      drawArena(view, arena.path);
      drawLamp(view);

      ctx.imageSmoothingEnabled = false;

      // Las manchas van bajo todo el mundo: son suelo, no escena.
      ctx.fillStyle = "rgba(44, 74, 28, 0.55)";
      for (const decal of decalsRef.current) {
        const rx = decal.radius * view.scale;
        ctx.save();
        ctx.translate(toScreenX(decal.x, view), toScreenY(decal.y, view));
        ctx.scale(1, decal.squash);
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      for (const enemy of enemiesRef.current) {
        if (enemy.dead) continue;
        if (enemy.dying > 0) {
          const fade = enemy.dying / DEATH_TIME;
          drawShadow(enemy.x, enemy.y, ZOMBIE_WIDTH, view);
          ctx.globalAlpha = 0.35 + fade * 0.65;
          drawSprite(sprites.fallen, enemy.x, enemy.y, enemy.angle, ZOMBIE_WIDTH, view);
          ctx.globalAlpha = 1;
          continue;
        }
        drawShadow(enemy.x, enemy.y, ZOMBIE_WIDTH, view);
        const walking = Math.sin(enemy.step) > 0;
        const baked =
          enemy.hurt > 0 ? sprites.minerHurt : walking ? sprites.minerStep : sprites.miner;
        drawSprite(baked, enemy.x, enemy.y, enemy.angle, ZOMBIE_WIDTH, view);
      }

      const player = playerRef.current;
      const stats = statsRef.current;
      // El retroceso empuja la figura hacia atrás: es lo que hace que el
      // disparo se sienta en la mano y no solo en el contador de carga.
      const kick = (stats.recoil / RECOIL_TIME) * 0.28;
      const px = player.x - Math.cos(player.angle) * kick;
      const py = player.y - Math.sin(player.angle) * kick;
      drawShadow(px, py, PLAYER_WIDTH, view);
      drawSprite(sprites.operator, px, py, player.angle, PLAYER_WIDTH, view);

      if (stats.muzzle > 0) {
        const mx = toScreenX(px + Math.cos(player.angle) * (PLAYER_WIDTH * 0.5), view);
        const my = toScreenY(py + Math.sin(player.angle) * (PLAYER_WIDTH * 0.5), view);
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(-player.angle);
        ctx.fillStyle = "#ffe9a8";
        ctx.beginPath();
        ctx.moveTo(-2, 0);
        ctx.lineTo(9, -4);
        ctx.lineTo(7, 0);
        ctx.lineTo(9, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Trazadoras: cabeza clara y estela que se apaga. Una línea plana no deja
      // leer la trayectoria desde arriba.
      for (const b of bulletsRef.current) {
        const hx = toScreenX(b.x, view);
        const hy = toScreenY(b.y, view);
        const tx = hx - b.vx * 0.024 * view.scale;
        const ty = hy + b.vy * 0.024 * view.scale;
        const streak = ctx.createLinearGradient(tx, ty, hx, hy);
        streak.addColorStop(0, "rgba(240, 166, 60, 0)");
        streak.addColorStop(1, "rgba(255, 243, 214, 0.95)");
        ctx.strokeStyle = streak;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(hx, hy);
        ctx.stroke();
      }

      for (const ring of ringsRef.current) {
        const t = 1 - ring.life / RING_TIME;
        ctx.strokeStyle = `rgba(${BLOOD}, ${(1 - t) * 0.8})`;
        ctx.lineWidth = 2 - t;
        ctx.beginPath();
        ctx.arc(
          toScreenX(ring.x, view),
          toScreenY(ring.y, view),
          t * RING_REACH * view.scale,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }

      for (const p of particlesRef.current) {
        const alpha = p.life / PARTICLE_LIFE;
        ctx.fillStyle = `rgba(${BLOOD}, ${alpha.toFixed(2)})`;
        const size = 1 + alpha * 2.5;
        ctx.fillRect(
          toScreenX(p.x, view) - size / 2,
          toScreenY(p.y, view) - size / 2,
          size,
          size,
        );
      }

      ctx.imageSmoothingEnabled = true;
      drawLabels(view);
      drawOffscreen(view);

      // Mira. Va en el lienzo y no en CSS porque tiene que ir al ritmo del
      // fotograma: un cursor que se arrastra por detrás se siente roto.
      const aim = aimRef.current;
      ctx.strokeStyle = "rgba(221, 229, 237, 0.85)";
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(aim.x - 10, aim.y);
      ctx.lineTo(aim.x - 3, aim.y);
      ctx.moveTo(aim.x + 3, aim.y);
      ctx.lineTo(aim.x + 10, aim.y);
      ctx.moveTo(aim.x, aim.y - 10);
      ctx.lineTo(aim.x, aim.y - 3);
      ctx.moveTo(aim.x, aim.y + 3);
      ctx.lineTo(aim.x, aim.y + 10);
      ctx.stroke();
      ctx.fillStyle = UI.alert;
      ctx.fillRect(aim.x - 0.75, aim.y - 0.75, 1.5, 1.5);

      // Viñeta de la escena: asienta el borde y empuja la mirada al centro.
      const corner = ctx.createRadialGradient(
        cssWidth / 2,
        cssHeight / 2,
        Math.min(cssWidth, cssHeight) * 0.42,
        cssWidth / 2,
        cssHeight / 2,
        Math.max(cssWidth, cssHeight) * 0.72,
      );
      corner.addColorStop(0, "rgba(0, 0, 0, 0)");
      corner.addColorStop(1, "rgba(0, 0, 0, 0.55)");
      ctx.fillStyle = corner;
      ctx.fillRect(0, 0, cssWidth, cssHeight);

      if (stats.sting > 0.01) {
        // El pulso entra por el lado del que muerde: desde todos los bordes
        // dice que te hacen daño, pero no hacia dónde girar.
        // El foco cae FUERA de la pantalla, del lado del que muerde: así el
        // rojo se queda en el borde y no inunda el recinto, que es lo que hay
        // que seguir viendo mientras te comen.
        const reach = Math.max(cssWidth, cssHeight);
        const fx = cssWidth / 2 + Math.cos(-stats.stingAngle) * reach * 0.62;
        const fy = cssHeight / 2 + Math.sin(-stats.stingAngle) * reach * 0.62;
        const hurt = ctx.createRadialGradient(fx, fy, 0, fx, fy, reach * 0.48);
        hurt.addColorStop(0, `rgba(196, 46, 46, ${(stats.sting * 0.46).toFixed(3)})`);
        hurt.addColorStop(0.55, `rgba(176, 42, 42, ${(stats.sting * 0.14).toFixed(3)})`);
        hurt.addColorStop(1, "rgba(176, 42, 42, 0)");
        ctx.fillStyle = hurt;
        ctx.fillRect(0, 0, cssWidth, cssHeight);
      }
    };


    function refreshHud(): void {
      const stats = statsRef.current;
      const round = roundRef.current;
      const arena = arenas[round.index];
      let alive = 0;
      for (const enemy of enemiesRef.current) if (!enemy.dead && enemy.dying <= 0) alive += 1;

      setHud({
        zone: labelOf(arena),
        round: round.index,
        cycle: round.cycle,
        alive,
        total: round.total,
        health: Math.max(0, Math.round(stats.health)),
        ammo: Math.floor(stats.ammo),
        kills: stats.kills,
        score: stats.score,
      });
    }

    startRound(0, 0);

    const step = (now: number): void => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tick += 1;

      advance(dt);
      draw(followCamera(dt));
      // El recinto no cambia de forma: no necesita sesenta refrescos por segundo.
      if (tick % MINIMAP_INTERVAL_FRAMES === 0) drawMinimap();

      hudCountdown -= 1;
      if (hudCountdown <= 0) {
        hudCountdown = HUD_INTERVAL_FRAMES;
        refreshHud();
      }

      requestAnimationFrame(step);
    };

    requestAnimationFrame(step);

    // --- Entrada ------------------------------------------------------------

    const onKeyDown = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      if (key === "escape") {
        exitRef.current();
        return;
      }
      if (key === " ") firePendingRef.current = true;
      keysRef.current.add(key);
      if (MOVEMENT_KEYS.has(key)) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      keysRef.current.delete(event.key.toLowerCase());
    };
    const onBlur = (): void => {
      keysRef.current.clear();
      firingRef.current = false;
      firePendingRef.current = false;
    };
    const onPointerUp = (): void => {
      firingRef.current = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      running = false;
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [arenas, renderer, sprites, pushKill]);

  const trackPointer = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    aimRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  if (arenas.length === 0) {
    return (
      <div className="bg-abyss absolute inset-0 z-30 grid place-items-center">
        <div className="border-edge bg-panel border px-8 py-6 text-center font-mono">
          <p className="text-ink-dim text-[9px] tracking-[0.3em] uppercase">Sin detecciones</p>
          <p className="text-ink-soft mt-3 text-[12px]">No hay nadie en el plano ahora mismo.</p>
          <button
            type="button"
            onClick={onExit}
            className="border-edge text-ink hover:bg-hover mt-5 border px-4 py-1.5 text-[11px]"
          >
            Volver al plano
          </button>
        </div>
      </div>
    );
  }

  const critical = hud.health < CRITICAL_HEALTH;
  const lowAmmo = hud.ammo <= 18;

  return (
    <div ref={containerRef} className="bg-abyss absolute inset-0 z-30 select-none">
      <canvas
        ref={canvasRef}
        onPointerMove={trackPointer}
        onPointerDown={(event) => {
          trackPointer(event);
          firingRef.current = true;
          firePendingRef.current = true;
        }}
        onContextMenu={(event) => event.preventDefault()}
        className="block h-full w-full cursor-none"
      />

      <KillFeed feed={feed} />

      <div className="border-edge bg-panel pointer-events-none absolute top-3 right-3 border p-[3px]">
        <canvas ref={minimapRef} className="block" />
      </div>

      <RoundRail total={arenas.length} current={hud.round} />

      <div className="border-edge bg-panel pointer-events-none absolute inset-x-0 bottom-0 flex h-[74px] items-stretch border-t-2 font-mono">
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
          <p className="text-ink-dim text-[8.5px] tracking-[0.2em] uppercase">
            Zona · ronda {hud.round + 1} de {arenas.length}
            {hud.cycle > 0 && ` · vuelta ${hud.cycle + 1}`}
          </p>
          <p className="text-ink truncate text-[15px] leading-tight font-medium">{hud.zone}</p>
          <div className="flex items-center justify-center gap-2">
            <div className="bg-line h-0.5 w-32">
              <div
                className="bg-[#e05656] h-full"
                style={{ width: `${hud.total > 0 ? (hud.alive / hud.total) * 100 : 0}%` }}
              />
            </div>
            <span className="text-ink-dim font-mono text-[9.5px]">
              {hud.alive} de {hud.total} en pie
            </span>
          </div>
        </div>

        <Cell label="Bajas" value={String(hud.kills).padStart(3, "0")} />
        <Cell label="Puntos" value={String(hud.score).padStart(6, "0")} tone="alert" last />
      </div>

      {card && !defeated && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="bg-panel/95 border-signal border-t-2 px-9 py-6 text-center font-mono">
            <p className="text-ink-dim text-[9px] tracking-[0.32em] uppercase">{card.title}</p>
            <p className="text-ink mt-2.5 text-lg">{card.zone}</p>
            <p className="text-ink-soft mt-2 text-[11px]">{card.detail}</p>
          </div>
        </div>
      )}

      {defeated && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#7f1d1d]/40">
          <div className="bg-panel/95 border-t-2 border-[#e05656] px-9 py-6 text-center font-mono">
            <p className="text-ink-dim text-[9px] tracking-[0.32em] uppercase">Recorrido terminado</p>
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
