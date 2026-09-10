/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Endpoint con las filas de personas en JSON. Vacío → datos de ejemplo. */
  readonly VITE_PEOPLE_API_URL?: string;
  /** Endpoint con el catálogo de proyectos/sectores/planos. Vacío → `PROJECTS`. */
  readonly VITE_PLANS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
