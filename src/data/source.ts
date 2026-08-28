/**
 * ── PUNTO DE INTEGRACIÓN ──────────────────────────────────────────────────────
 *
 * Configuración de la aplicación de ejemplo. Al integrar el sistema real esto
 * se reduce a la URL del plano; el resto lo define su proveedor.
 *
 * Ver INTEGRACION.md para el paso a paso.
 */

export const PLAN_URL = "/plano.dxf";

/** Cada cuánto React Query vuelve a pedir las personas. 0 desactiva el refresco. */
export const REFRESH_INTERVAL_MS = 15_000;
