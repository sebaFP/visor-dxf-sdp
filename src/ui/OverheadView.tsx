import { useEffect, useMemo, useRef, useState } from "react";
import type { DxfDocument, Vec2, ZoneLayer, ZoneRing } from "../core/dxf/types";
import type { OccupancySnapshot, Person } from "../core/occupancy/types";
import { formatZoneLabels, RAW_ZONE_LABEL, type ZoneLabeller } from "../core/occupancy/zone-names";
import { placePeople, type Placement } from "../core/render/placement";
import { PlanRenderer, type ZoneStyle } from "../core/render/plan-renderer";
import {
  bakeSprite,
  MINER_PALETTE,
  MINER_TOP_ART,
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
  UI,
  useKillFeed,
} from "./mode-hud";

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
const PLAYER_WIDTH = 2.2;
/** A qué distancia del grupo entra el operador al empezar una ronda. */
const SPAWN_DISTANCE = 17;
/** Radio con el que se mide "cuánta gente hay junta" al elegir por dónde entrar. */
const CLUSTER_REACH = 30;

const ZOMBIE_SPEED = 2.4;
const ZOMBIE_WIDTH = 1.9;
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

const SPLATTER_COUNT = 12;
const PARTICLE_LIFE = 0.55;
const PARTICLE_DRAG = 2.6;

/** Verde: la sangre de algo que ya no está del todo vivo. */
const BLOOD = "124, 240, 58";

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
  /** Intensidad de la viñeta roja de daño, 0..1. */
  sting: number;
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
  meta: string;
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

  const [hud, setHud] = useState<Hud>({
    zone: "",
    meta: "",
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

  const sprites = useMemo(
    () => ({
      miner: bakeSprite(MINER_TOP_ART, MINER_PALETTE),
      minerHurt: bakeSprite(MINER_TOP_ART, tintPalette(MINER_PALETTE, "#7cf03a", 0.6)),
      operator: bakeSprite(OPERATOR_TOP_ART, OPERATOR_PALETTE),
    }),
    [],
  );

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
  const statsRef = useRef<Stats>({
    health: MAX_HEALTH,
    ammo: MAX_AMMO,
    kills: 0,
    score: 0,
    cooldown: 0,
    idle: 0,
    sting: 0,
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
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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
      aimRef.current = { x: cssWidth / 2, y: cssHeight / 2 };
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    // --- Rondas -------------------------------------------------------------

    const startRound = (index: number, cycle: number): void => {
      const arena = arenas[index];
      const tuning = difficulty(cycle);

      const enemies: Enemy[] = arena.people.map(({ person, at }) => ({
        person,
        x: at.x,
        y: at.y,
        angle: 0,
        health: tuning.health,
        hurt: 0,
        dying: 0,
        dead: false,
      }));
      enemiesRef.current = enemies;
      bulletsRef.current = [];
      particlesRef.current = [];

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
      if (enemy.health > 0) return;

      enemy.dying = DEATH_TIME;
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
          }
          continue;
        }

        const step = (round.speed * dt) / distance;
        enemy.x += relX * step;
        enemy.y += relY * step;
      }

      if (alive === 0 && round.pause <= 0 && !stats.defeated) clearRound();
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

      const scale = OVERHEAD_PX_PER_UNIT;
      const next = {
        scale,
        tx: cssWidth / 2 - cam.x * scale,
        ty: cssHeight / 2 + cam.y * scale,
      };
      viewRef.current = next;
      return next;
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
      ctx.translate(wx * view.scale + view.tx, -wy * view.scale + view.ty);
      // La Y del mundo crece hacia arriba y la del lienzo hacia abajo, así que
      // un giro antihorario del mundo es horario en pantalla.
      ctx.rotate(-angle);
      ctx.drawImage(baked.canvas, -w / 2, -h / 2, w, h);
      ctx.restore();
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

      for (const { enemy } of near) {
        const x = enemy.x * view.scale + view.tx;
        const y = -enemy.y * view.scale + view.ty - (ZOMBIE_WIDTH * view.scale) / 2 - 6;
        const name = enemy.person.name;
        const company = companyOf(enemy.person);

        ctx.font = LABEL_NAME_FONT;
        const width = Math.max(ctx.measureText(name).width, 60) + 12;
        const box = { left: x - width / 2, right: x + width / 2, top: y - 24, bottom: y + 4 };
        // Amontonados, los rótulos son una mancha: el que llega tarde no se pinta.
        if (boxes.some((b) => b.left < box.right && b.right > box.left && b.top < box.bottom && b.bottom > box.top))
          continue;
        boxes.push(box);

        ctx.fillStyle = "rgba(9, 14, 20, 0.82)";
        ctx.fillRect(box.left, box.top, width, 28);
        ctx.fillStyle = UI.alert;
        ctx.fillRect(box.left, box.top, width, 1);

        ctx.fillStyle = UI.ink;
        ctx.font = LABEL_NAME_FONT;
        ctx.fillText(name, x, y - 12);
        ctx.fillStyle = UI.inkDim;
        ctx.font = LABEL_META_FONT;
        ctx.fillText(company, x, y - 2);
      }
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

      // La arena de la ronda, teñida: hay que saber de un vistazo dónde se juega.
      ctx.save();
      ctx.setTransform(dpr * view.scale, 0, 0, -dpr * view.scale, dpr * view.tx, dpr * view.ty);
      ctx.fillStyle = "rgba(240, 166, 60, 0.06)";
      ctx.fill(arena.path, "evenodd");
      ctx.strokeStyle = "rgba(240, 166, 60, 0.5)";
      ctx.lineWidth = 1.5 / view.scale;
      ctx.stroke(arena.path);
      ctx.restore();

      ctx.imageSmoothingEnabled = false;

      for (const p of particlesRef.current) {
        const alpha = p.life / PARTICLE_LIFE;
        ctx.fillStyle = `rgba(${BLOOD}, ${alpha.toFixed(2)})`;
        const size = 1 + alpha * 2.5;
        ctx.fillRect(
          p.x * view.scale + view.tx - size / 2,
          -p.y * view.scale + view.ty - size / 2,
          size,
          size,
        );
      }

      for (const enemy of enemiesRef.current) {
        if (enemy.dead) continue;
        const baked = enemy.hurt > 0 ? sprites.minerHurt : sprites.miner;
        // Al caer, la figura se encoge en vez de desvanecerse: desde arriba un
        // cuerpo tumbado y uno de pie ocupan lo mismo y no se distinguiría.
        const shrink = enemy.dying > 0 ? 0.35 + (enemy.dying / DEATH_TIME) * 0.65 : 1;
        ctx.globalAlpha = enemy.dying > 0 ? enemy.dying / DEATH_TIME : 1;
        drawSprite(baked, enemy.x, enemy.y, enemy.angle, ZOMBIE_WIDTH * shrink, view);
      }
      ctx.globalAlpha = 1;

      const player = playerRef.current;
      drawSprite(sprites.operator, player.x, player.y, player.angle, PLAYER_WIDTH, view);

      ctx.strokeStyle = UI.alert;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const b of bulletsRef.current) {
        const x = b.x * view.scale + view.tx;
        const y = -b.y * view.scale + view.ty;
        ctx.moveTo(x, y);
        ctx.lineTo(x - b.vx * 0.016 * view.scale, y + b.vy * 0.016 * view.scale);
      }
      ctx.stroke();

      ctx.imageSmoothingEnabled = true;
      drawLabels(view);

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

      const sting = statsRef.current.sting;
      if (sting > 0.01) {
        const gradient = ctx.createRadialGradient(
          cssWidth / 2,
          cssHeight / 2,
          Math.min(cssWidth, cssHeight) * 0.28,
          cssWidth / 2,
          cssHeight / 2,
          Math.max(cssWidth, cssHeight) * 0.62,
        );
        gradient.addColorStop(0, "rgba(176, 42, 42, 0)");
        gradient.addColorStop(1, `rgba(176, 42, 42, ${(sting * 0.55).toFixed(3)})`);
        ctx.fillStyle = gradient;
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
        meta:
          `${alive} de ${round.total} en pie · ronda ${round.index + 1}/${arenas.length}` +
          ` · vuelta ${round.cycle + 1}`,
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
          <p className="text-ink-dim truncate text-[9.5px]">{hud.meta}</p>
        </div>

        <Cell label="Bajas" value={String(hud.kills).padStart(3, "0")} />
        <Cell label="Puntos" value={String(hud.score).padStart(6, "0")} tone="alert" last />
      </div>

      {card && !defeated && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="bg-panel/95 border-alert border-t-2 px-9 py-6 text-center font-mono">
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
