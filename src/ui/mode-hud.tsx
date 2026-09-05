import { useCallback, useRef, useState } from "react";
import type { Person } from "../core/occupancy/types";
import { personField } from "../core/occupancy/extra-fields";
import { COMPANY_KEYS } from "./person-columns";

/**
 * Marcador compartido por los recorridos del plano.
 *
 * Las dos vistas dibujan mundos distintos pero cuentan lo mismo —carga,
 * integridad, zona, bajas, puntos— y tienen que contarlo igual: dos marcadores
 * parecidos pero no iguales se notan enseguida y delatan que uno se hizo
 * después. Vive en HTML sobre el lienzo, igual que las insignias de conteo del
 * plano: texto nítido a cualquier resolución y estilable con CSS normal.
 */

/**
 * Tokens del visor.
 *
 * Los recorridos usan exactamente la misma paleta que el resto de la aplicación
 * (`src/index.css`): es una herramienta de faena con un guiño, no una recreativa.
 * El ámbar tiene un solo significado — algo que atender — y por eso no decora
 * cifras que están bien.
 */
export const UI = {
  abyss: "#06090d",
  panel: "#0e141c",
  raised: "#141d27",
  line: "#1b2530",
  edge: "#2a3947",
  ink: "#dde5ed",
  inkSoft: "#93a3b3",
  inkDim: "#5c6d7e",
  signal: "#45c0f5",
  alert: "#f0a63c",
  critical: "#e05656",
} as const;

/** Bajo esta integridad el marcador pasa a rojo. */
export const CRITICAL_HEALTH = 35;

const KILL_FEED_MS = 6000;
const KILL_FEED_MAX = 4;

export interface KillEntry {
  id: number;
  name: string;
  company: string;
}

export function companyOf(person: Person): string {
  return personField(person, COMPANY_KEYS) ?? "SIN EMPRESA";
}

/**
 * Registro de bajas. Cada línea se retira sola.
 *
 * Vive en estado de React y no en un ref: solo cambia al derribar a alguien, no
 * sesenta veces por segundo.
 */
export function useKillFeed(): [KillEntry[], (person: Person) => void] {
  const [feed, setFeed] = useState<KillEntry[]>([]);
  const idRef = useRef(0);

  const push = useCallback((person: Person) => {
    const id = ++idRef.current;
    setFeed((current) => [
      ...current.slice(-(KILL_FEED_MAX - 1)),
      { id, name: person.name, company: companyOf(person) },
    ]);
    window.setTimeout(() => {
      setFeed((current) => current.filter((entry) => entry.id !== id));
    }, KILL_FEED_MS);
  }, []);

  return [feed, push];
}

/** La más reciente abajo y a plena luz; las anteriores se apagan en vez de irse de golpe. */
export function KillFeed({ feed }: { feed: KillEntry[] }) {
  return (
    <ul className="pointer-events-none absolute top-3 left-3 flex flex-col gap-px font-mono text-[11px]">
      {feed.map((entry, index) => {
        const age = feed.length - 1 - index;
        return (
          <li
            key={entry.id}
            style={{ opacity: 1 - age * 0.24 }}
            className={`bg-panel/90 flex items-baseline gap-4 border-l-2 py-1 pr-2.5 pl-2 ${
              age === 0 ? "border-alert" : "border-edge"
            }`}
          >
            <span className="text-ink">{entry.name}</span>
            <span className="text-ink-dim ml-auto text-[9px] tracking-wider">{entry.company}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Una casilla del marcador. */
export function Cell({
  label,
  value,
  suffix,
  tone,
  alert,
  critical,
  last,
  children,
}: {
  label: string;
  value: string;
  suffix?: string;
  tone?: "ink" | "alert";
  /** Pinta la cifra de ámbar: hay algo que atender. */
  alert?: boolean;
  /** Pinta la cifra de rojo: ya es tarde para atenderlo. */
  critical?: boolean;
  last?: boolean;
  children?: React.ReactNode;
}) {
  const color = critical
    ? "text-[#e05656]"
    : alert || tone === "alert"
      ? "text-alert"
      : "text-ink";

  return (
    <div
      className={`flex w-[96px] shrink-0 flex-col justify-center gap-1.5 px-4 py-2 ${
        last ? "" : "border-line border-r"
      }`}
    >
      <p className="text-ink-dim text-[8.5px] tracking-[0.2em] uppercase">{label}</p>
      <p className={`tnum text-[19px] leading-none font-semibold ${color}`}>
        {value}
        {suffix && <span className="text-ink-dim text-[11px]">{suffix}</span>}
      </p>
      {children ?? <div className="bg-line h-0.5" />}
    </div>
  );
}

/** Barra de dos píxeles bajo la cifra: la proporción se lee sin leer el número. */
export function Meter({
  value,
  tone,
}: {
  value: number;
  tone: "ink" | "signal" | "alert" | "critical";
}) {
  const fill =
    tone === "signal"
      ? "bg-signal"
      : tone === "alert"
        ? "bg-alert"
        : tone === "critical"
          ? "bg-[#e05656]"
          : "bg-ink";
  return (
    <div className="bg-line h-0.5">
      <div
        className={`h-full ${fill}`}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}

/**
 * El indicador del operador: donde el clásico ponía una cara, un casco de faena.
 *
 * Cumple la misma función —decir cómo estás sin leer un número— sin la mueca
 * ensangrentada, que en una herramienta de faena estaría fuera de sitio.
 */
export function OperatorState({ health }: { health: number }) {
  const hurt = health < 66;
  const critical = health < CRITICAL_HEALTH;

  const shell = critical ? "#8f7318" : "#c9a227";
  const shellDark = critical ? "#5f4c10" : "#8f7318";
  const lamp = critical ? "#8a7444" : hurt ? "#d8c288" : "#ffe9a8";
  const eyes = critical ? UI.critical : UI.inkSoft;
  const face = critical ? "#3a2226" : UI.edge;

  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
      <rect
        x="0.5"
        y="0.5"
        width="33"
        height="33"
        fill={critical ? "#1d1416" : UI.raised}
        stroke={critical ? "#4a2a2c" : UI.edge}
      />
      <path d="M6 20 h22 v2 h-22 z" fill={shell} />
      <path d="M10 20 a7 7 0 0 1 14 0 z" fill={shell} />
      <path d="M13 20 a4 4 0 0 1 8 0 z" fill={shellDark} />
      <circle cx="17" cy="15" r="2.4" fill={lamp} />
      {!critical && <circle cx="17" cy="15" r="4.6" fill={lamp} opacity="0.16" />}
      <rect x="12" y="23" width="10" height="5" fill={face} />
      <rect x="13.5" y="24.5" width="2.5" height="2" fill={eyes} />
      <rect x="18" y="24.5" width="2.5" height="2" fill={eyes} />
      {critical && <path d="M20 11 l2 4 l-1.5 1" stroke={UI.critical} strokeWidth="1" fill="none" />}
    </svg>
  );
}
