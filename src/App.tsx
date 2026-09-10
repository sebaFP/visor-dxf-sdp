import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createApiPeopleSource } from "./data/api-people-source";
import { PeopleProvider } from "./data/people-context";
import { SamplePeopleProvider } from "./data/sample-people-provider";
import {
  PEOPLE_API_URL,
  PEOPLE_FIELD_MAP,
  PEOPLE_NAME_FALLBACK,
  PEOPLE_TIME_OFFSET,
  PLAN_URL,
  PLANS_URL,
  PROJECTS,
  REFRESH_INTERVAL_MS,
} from "./data/source";
import { usePlansQuery } from "./data/use-plans-query";
import { PlanOccupancyViewer } from "./ui/PlanOccupancyViewer";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // El plano es inmutable y las personas ya se refrescan por intervalo:
      // revalidar al enfocar la ventana solo agrega peticiones sin información.
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * La fuente real, si hay endpoint configurado. A nivel de módulo para que su
 * identidad sea estable entre renders.
 */
const apiSource = PEOPLE_API_URL
  ? createApiPeopleSource({
      url: PEOPLE_API_URL,
      label: "Detección en tiempo real",
      fieldMap: PEOPLE_FIELD_MAP,
      assumeOffset: PEOPLE_TIME_OFFSET,
      nameFallback: PEOPLE_NAME_FALLBACK,
    })
  : null;

/**
 * Composición completa de la aplicación.
 *
 * Con `VITE_PEOPLE_API_URL` en `.env` el visor lee del API real a través de
 * `createApiPeopleSource`; sin ella, de los datos de ejemplo. El visor no
 * cambia en ninguno de los dos casos.
 */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}

function Shell() {
  // El catálogo de planos puede venir del sistema (`VITE_PLANS_URL`) o del
  // respaldo estático. Mientras se descarga, o si falla, se usa el estático.
  const remotePlans = usePlansQuery(PLANS_URL);
  const projects = remotePlans.data ?? PROJECTS;

  // El `planUrl` vive acá arriba porque el desplegable «Proyecto» cambia de DXF
  // y el proveedor de ejemplo tiene que seguirlo: reparte gente sobre las zonas
  // del plano dibujado. La fuente real no depende del plano y lo ignora.
  const [planUrl, setPlanUrl] = useState(PLAN_URL);

  const viewer = (
    <PlanOccupancyViewer planUrl={PLAN_URL} plans={projects} onPlanUrlChange={setPlanUrl} />
  );

  if (apiSource) {
    return (
      <PeopleProvider
        source={apiSource}
        sourceId={`api:${PEOPLE_API_URL}`}
        refreshIntervalMs={REFRESH_INTERVAL_MS}
      >
        {viewer}
      </PeopleProvider>
    );
  }

  return (
    <SamplePeopleProvider planUrl={planUrl} refreshIntervalMs={REFRESH_INTERVAL_MS}>
      {viewer}
    </SamplePeopleProvider>
  );
}
