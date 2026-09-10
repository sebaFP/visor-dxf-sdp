/**
 * ── PUNTO DE INTEGRACIÓN ──────────────────────────────────────────────────────
 *
 * Todo lo que el otro equipo configura está en este archivo y en `.env`:
 *
 *   1. `VITE_PEOPLE_API_URL` (.env): el endpoint con las filas de la vista.
 *      Vacío → datos de ejemplo.
 *   2. `PEOPLE_FIELD_MAP` (acá): qué columna alimenta cada campo. Si les
 *      renombran una columna, se cambia el string y nada más.
 *   3. `VITE_PLANS_URL` (.env) o `PROJECTS` (acá): el catálogo de proyectos,
 *      sectores y planos DXF.
 *
 * Ver INTEGRACION.md para el paso a paso.
 */

import type { ProjectEntry } from "../core/dxf/plan-catalog";
import type { PersonFieldMap, RawRow } from "../core/occupancy/field-map";

/** DXF que se dibuja mientras no haya un proyecto elegido. */
export const PLAN_URL = "/plano.dxf";

/**
 * Catálogo de proyectos, sectores y planos. Es el mismo JSON que puede venir
 * del sistema por `VITE_PLANS_URL`; acá va el de respaldo cuando no hay URL.
 *
 * Cada proyecto trae su `dxf` (el plano general, sin sector elegido) y sus
 * `sectores`, cada uno con el suyo. Elegir uno **carga ese DXF**; no filtra
 * personas: de eso se encargan empresa y contrato.
 *
 *   export const PROJECTS: ProjectEntry[] = [
 *     { id: "exp", nombre: "Expansión Nivel 320", dxf: "/planos/exp.dxf",
 *       sectores: [
 *         { id: "mina",   nombre: "Interior Mina", dxf: "/planos/exp-mina.dxf" },
 *         { id: "planta", nombre: "Planta",        dxf: "/planos/exp-planta.dxf" },
 *       ] },
 *     { id: "cont", nombre: "Continuidad Operacional", dxf: "/planos/cont.dxf" },
 *   ];
 *
 * Con la lista vacía, proyecto y sector salen apagados y el visor dibuja
 * `PLAN_URL` y nada más.
 */
export const PROJECTS: ProjectEntry[] = [
  { id: "faena", nombre: "Faena Principal", dxf: PLAN_URL },
];

/** URL que devuelve el catálogo de arriba en JSON. Vacía → `PROJECTS`. */
export const PLANS_URL: string | undefined = import.meta.env.VITE_PLANS_URL || undefined;

/** Cada cuánto se vuelven a pedir las personas. 0 desactiva el refresco. */
export const REFRESH_INTERVAL_MS = 15_000;

/**
 * Endpoint con las filas de `dbo.SDP_V_TIEMPOREAL_GOM` (o equivalente) en
 * JSON. Vacío → el visor arranca con datos de ejemplo.
 */
export const PEOPLE_API_URL: string | undefined =
  import.meta.env.VITE_PEOPLE_API_URL || undefined;

/**
 * Qué columna alimenta cada campo de `Person`. Los nombres se comparan sin
 * importar mayúsculas, acentos ni separadores (`ID_ZONA` = `idZona`).
 *
 * Campo            → columna           → dónde se ve
 *   id             RUT                 identidad de la fila (no se muestra)
 *   idFallback     TAGID               id cuando RUT viene nulo
 *   name           NOMBRE              columna «Nombre»
 *   zoneId         ID_ZONA             cruce con las capas del DXF
 *   detectedAt     FECHA               «Detección» y «Permanencia»
 *   company        EMPRESA             columna y filtro «Empresa»
 *   contract       CONTRATO            columna y filtro «Contrato»
 *   role           CARGO               columna «Cargo»
 *   specialty      ESPECIALIDAD        columna «Especialidad» («—» hasta que exista)
 *   zoneName       ZONA                rótulo de zona si no hay descripción
 *   zoneDescription ZONA_DESCRIPCION   rótulo de zona
 *   extra          GERENCIA, TAGID, READER   quedan en `Person.extra`
 */
export const PEOPLE_FIELD_MAP: PersonFieldMap = {
  id: "RUT",
  idFallback: "TAGID",
  name: "NOMBRE",
  zoneId: "ID_ZONA",
  detectedAt: "FECHA",
  company: "EMPRESA",
  contract: "CONTRATO",
  role: "CARGO",
  specialty: "ESPECIALIDAD",
  zoneName: "ZONA",
  zoneDescription: "ZONA_DESCRIPCION",
  extra: ["GERENCIA", "TAGID", "READER"],
};

/**
 * Desplazamiento para fechas sin zona horaria (`"-03:00"`). `undefined` = se
 * interpretan en la hora del navegador. Solo hace falta si los navegadores
 * están en otra zona que el servidor; ver INTEGRACION.md §1 (horario de verano).
 */
export const PEOPLE_TIME_OFFSET: string | undefined = undefined;

/** Nombre para las lecturas sin persona asignada (RUT y NOMBRE nulos). */
export const PEOPLE_NAME_FALLBACK = (_row: RawRow, id: string): string => `Tag ${id}`;
