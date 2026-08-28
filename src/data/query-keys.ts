/**
 * Claves de query centralizadas.
 *
 * Están acá y no dispersas en los hooks para que dos consumidores del mismo
 * dato compartan caché sin coordinarse. Es lo que permite que el proveedor de
 * datos de ejemplo lea el plano ya parseado por el visor, en vez de descargar y
 * parsear 13 MB por segunda vez.
 */
export const queryKeys = {
  plan: (url: string) => ["plan", url] as const,
  people: (sourceId: string) => ["people", sourceId] as const,
};
