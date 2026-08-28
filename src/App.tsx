import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PLAN_URL, REFRESH_INTERVAL_MS } from "./data/source";
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
 */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SamplePeopleProvider planUrl={PLAN_URL} refreshIntervalMs={REFRESH_INTERVAL_MS}>
        <PlanOccupancyViewer planUrl={PLAN_URL} />
      </SamplePeopleProvider>
    </QueryClientProvider>
  );
}
