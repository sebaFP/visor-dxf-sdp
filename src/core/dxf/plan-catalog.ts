/**
 * ── QUÉ PLANO SE DIBUJA ───────────────────────────────────────────────────────
 *
 * «Proyecto» y «Sector» no filtran personas: eligen el archivo DXF que se carga.
 * Cada entrada del catálogo es un plano con su URL; las zonas son las que ese
 * archivo traiga dibujadas, y las personas caen sobre ellas por `zoneId` como
 * siempre. Una zona que no esté en el DXF cargado va a «Otras zonas», que es
 * exactamente lo que ya hacía.
 *
 * Los otros dos desplegables de la barra —empresa y contrato— sí filtran
 * personas y viven en `src/core/occupancy/people-filters.ts`. Son dos cosas
 * distintas que se ven parecidas en pantalla, y por eso están separadas acá.
 *
 * Puro y sin React.
 */

export interface PlanOption {
  /** Identidad estable. No se muestra. */
  id: string;
  /** Proyecto al que pertenece. Es lo que lista el desplegable «Proyecto». */
  proyecto: string;
  /**
   * Sector dentro del proyecto, si el proyecto se dibuja en varios archivos.
   * `null` marca el plano general del proyecto: el que se muestra mientras no
   * haya un sector elegido. Un proyecto de un solo plano no necesita más.
   */
  sector?: string | null;
  /** El DXF que se carga al elegirlo. */
  url: string;
}

/** Qué está elegido en los dos desplegables. `""` es «sin elegir». */
export interface PlanSelection {
  proyecto: string;
  sector: string;
}

export const NO_PLAN_SELECTION: PlanSelection = { proyecto: "", sector: "" };

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) =>
    a.localeCompare(b, "es", { numeric: true, sensitivity: "base" }),
  );
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
      .filter((plan) => plan.proyecto === proyecto)
      .map((plan) => plan.sector ?? "")
      .filter((sector) => sector !== ""),
  );
}

/**
 * El plano que corresponde a lo elegido, o `null` si no hay ninguno — y ahí el
 * visor cae al `planUrl` por defecto.
 *
 * Con proyecto pero sin sector gana el plano general (`sector: null`); si el
 * proyecto no tiene uno, se toma su primer plano, que es mejor que dejar el
 * lienzo en blanco esperando que elijan un sector.
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

  return ofProject.find((plan) => !plan.sector) ?? ofProject[0];
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
