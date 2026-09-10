import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PLAN_URL, PLANS, REFRESH_INTERVAL_MS } from "./data/source";
import { SamplePeopleProvider } from "./data/sample-people-provider";
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
 * Composición completa de la aplicación de ejemplo.
 *
 * Para integrar: cambien <SamplePeopleProvider> por su propio proveedor. El
 * visor no cambia.
 *
 * El `planUrl` vive acá arriba porque el desplegable «Proyecto» cambia de DXF y
 * el proveedor de personas tiene que seguirlo: reparte gente sobre las zonas
 * del plano que está dibujado. Una fuente real que no dependa del plano puede
 * ignorar `onPlanUrlChange` y quedarse con <PlanOccupancyViewer plans={…} />.
 */
export default function App() {
  const [planUrl, setPlanUrl] = useState(PLAN_URL);

  return (
    <QueryClientProvider client={queryClient}>
      <SamplePeopleProvider planUrl={planUrl} refreshIntervalMs={REFRESH_INTERVAL_MS}>
        <PlanOccupancyViewer
          planUrl={PLAN_URL}
          plans={PLANS}
          onPlanUrlChange={setPlanUrl}
        />
      </SamplePeopleProvider>
    </QueryClientProvider>
  );
}
