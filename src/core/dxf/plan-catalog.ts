/**
 * ── QUÉ PLANO SE DIBUJA ───────────────────────────────────────────────────────
 *
 * «Proyecto» y «Sector» no filtran personas: eligen el archivo DXF que se carga.
 * Las zonas son las que ese archivo traiga dibujadas, y las personas caen sobre
 * ellas por `zoneId` como siempre. Una zona que no esté en el DXF cargado va a
 * «Otras zonas», que es exactamente lo que ya hacía.
 *
 * El catálogo llega como JSON anidado, que es como lo entrega el sistema:
 *
 *   [
 *     { "id": "exp", "nombre": "Expansión Nivel 320", "dxf": "/planos/exp.dxf",
 *       "sectores": [
 *         { "id": "mina",   "nombre": "Interior Mina", "dxf": "/planos/exp-mina.dxf" },
 *         { "id": "planta", "nombre": "Planta",        "dxf": "/planos/exp-planta.dxf" }
 *       ] },
 *     { "id": "cont", "nombre": "Continuidad Operacional", "dxf": "/planos/cont.dxf" }
 *   ]
 *
 * El `dxf` del proyecto es el plano general: el que se dibuja mientras no haya
 * un sector elegido. Un proyecto sin `sectores` deja ese desplegable apagado.
 * `id` es opcional; sin él se usa el nombre.
 *
 * Por dentro el catálogo se aplana a `PlanOption[]` (una entrada por archivo),
 * que es lo que resuelven los desplegables. Ambas formas se aceptan.
 *
 * Los otros dos desplegables de la barra —empresa y contrato— sí filtran
 * personas y viven en `src/core/occupancy/people-filters.ts`. Son dos cosas
 * distintas que se ven parecidas en pantalla, y por eso están separadas acá.
 *
 * Puro y sin React.
 */

/** Un sector dentro de un proyecto, con su plano. */
export interface SectorEntry {
  /** Identidad estable. Opcional: sin ella se usa `nombre`. */
  id?: string;
  nombre: string;
  /** URL del DXF que se carga al elegirlo. */
  dxf: string;
}

/** Un proyecto del catálogo anidado. */
export interface ProjectEntry {
  /** Identidad estable. Opcional: sin ella se usa `nombre`. */
  id?: string;
  nombre: string;
  /** Plano general del proyecto: se dibuja mientras no haya sector elegido. */
  dxf: string;
  sectores?: readonly SectorEntry[];
}

/** Una entrada plana: un archivo DXF y a qué proyecto/sector corresponde. */
export interface PlanOption {
  /** Identidad estable. No se muestra. */
  id: string;
  /** Proyecto al que pertenece. Es lo que lista el desplegable «Proyecto». */
  proyecto: string;
  /**
   * Sector dentro del proyecto, si el proyecto se dibuja en varios archivos.
   * `null` marca el plano general del proyecto: el que se muestra mientras no
   * haya un sector elegido.
   */
  sector?: string | null;
  /** El DXF que se carga al elegirlo. */
  url: string;
}

/** Catálogo anidado (JSON del sistema) → lista plana. */
export function flattenProjects(projects: readonly ProjectEntry[]): PlanOption[] {
  const out: PlanOption[] = [];
  for (const project of projects) {
    const projectId = project.id ?? project.nombre;
    out.push({ id: projectId, proyecto: project.nombre, sector: null, url: project.dxf });
    for (const sector of project.sectores ?? []) {
      out.push({
        id: `${projectId}/${sector.id ?? sector.nombre}`,
        proyecto: project.nombre,
        sector: sector.nombre,
        url: sector.dxf,
      });
    }
  }
  return out;
}

/** ¿Es el JSON anidado o la lista plana? Mira la forma del primer elemento. */
export function isProjectCatalog(
  plans: readonly ProjectEntry[] | readonly PlanOption[],
): plans is readonly ProjectEntry[] {
  const first = plans[0] as ProjectEntry | PlanOption | undefined;
  return first !== undefined && "dxf" in first;
}

/** Cualquiera de las dos formas → lista plana. */
export function toPlanOptions(
  plans: readonly ProjectEntry[] | readonly PlanOption[],
): readonly PlanOption[] {
  return isProjectCatalog(plans) ? flattenProjects(plans) : plans;
}

/** Qué está elegido en los dos desplegables. `""` es «sin elegir». */
export interface PlanSelection {
  readonly proyecto: string;
  readonly sector: string;
}

export const NO_PLAN_SELECTION: PlanSelection = Object.freeze({ proyecto: "", sector: "" });

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) =>
    a.localeCompare(b, "es", { numeric: true, sensitivity: "base" }),
  );
}

/** Un `sector` vacío, `null` o ausente es «el plano general». */
function isGeneral(plan: PlanOption): boolean {
  return !plan.sector;
}

/** Proyectos del catálogo, sin repetir. */
export function projectsOf(plans: readonly PlanOption[]): string[] {
  return unique(plans.map((plan) => plan.proyecto));
}

/**
 * Sectores del proyecto elegido. Sin proyecto elegido no se ofrece ninguno: un
 * sector solo significa algo dentro de su proyecto, y mezclarlos daría una
 * lista donde dos «Norte» de proyectos distintos se ven iguales.
 */
export function sectorsOf(
  plans: readonly PlanOption[],
  proyecto: string,
): string[] {
  if (proyecto === "") return [];
  return unique(
    plans
      .filter((plan) => plan.proyecto === proyecto && !isGeneral(plan))
      .map((plan) => plan.sector as string),
  );
}

/**
 * El plano que corresponde a lo elegido, o `null` si no hay ninguno — y ahí el
 * visor cae al `planUrl` por defecto.
 *
 * Con proyecto pero sin sector gana el plano general; si el proyecto no tiene
 * uno, se toma su primer plano, que es mejor que dejar el lienzo en blanco
 * esperando que elijan un sector.
 */
export function resolvePlan(
  plans: readonly PlanOption[],
  selection: PlanSelection,
): PlanOption | null {
  if (selection.proyecto === "") return null;

  const ofProject = plans.filter((plan) => plan.proyecto === selection.proyecto);
  if (ofProject.length === 0) return null;

  if (selection.sector !== "") {
    return ofProject.find((plan) => plan.sector === selection.sector) ?? null;
  }

  return ofProject.find(isGeneral) ?? ofProject[0];
}

/**
 * Elegir proyecto limpia el sector: los sectores de un proyecto no existen en
 * otro, y dejarlo puesto apuntaría a un plano que no está en la lista.
 */
export function selectProject(proyecto: string): PlanSelection {
  return { proyecto, sector: "" };
}

export function selectSector(
  selection: PlanSelection,
  sector: string,
): PlanSelection {
  return { proyecto: selection.proyecto, sector };
}
