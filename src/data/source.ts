/**
 * ── PUNTO DE INTEGRACIÓN ──────────────────────────────────────────────────────
 *
 * Configuración de la aplicación de ejemplo. Al integrar el sistema real esto
 * se reduce a la URL del plano; el resto lo define su proveedor.
 *
 * Ver INTEGRACION.md para el paso a paso.
 */

import type { PlanOption } from "../core/dxf/plan-catalog";

export const PLAN_URL = "/plano.dxf";

/**
 * Catálogo de planos: lo que ofrecen los desplegables «Proyecto» y «Sector».
 *
 * Elegir un proyecto **carga otro DXF**. Las zonas son las que ese archivo
 * traiga dibujadas; una zona que no esté en él cae en «Otras zonas», igual que
 * siempre. No filtra personas: de eso se encargan empresa y contrato.
 *
 * Acá va una sola entrada porque el repo trae un solo plano. Agreguen los suyos
 * y los desplegables se llenan solos:
 *
 *   export const PLANS: PlanOption[] = [
 *     { id: "exp",      proyecto: "Expansión Nivel 320", url: "/planos/exp.dxf" },
 *     { id: "exp-mina", proyecto: "Expansión Nivel 320", sector: "Interior Mina",
 *       url: "/planos/exp-mina.dxf" },
 *     { id: "exp-plta", proyecto: "Expansión Nivel 320", sector: "Planta",
 *       url: "/planos/exp-planta.dxf" },
 *     { id: "cont",     proyecto: "Continuidad Operacional", url: "/planos/cont.dxf" },
 *   ];
 *
 * La entrada sin `sector` es el plano general del proyecto: el que se dibuja
 * mientras no haya un sector elegido. Un proyecto sin sectores deja ese
 * desplegable apagado, que es lo correcto: no hay nada que ofrecer.
 *
 * Con la lista vacía, proyecto y sector salen apagados y el visor dibuja
 * `PLAN_URL` y nada más.
 */
export const PLANS: PlanOption[] = [
  { id: "faena", proyecto: "Faena Principal", url: PLAN_URL },
];

/** Cada cuánto React Query vuelve a pedir las personas. 0 desactiva el refresco. */
export const REFRESH_INTERVAL_MS = 15_000;
