# Guía de integración

Todo lo que su equipo necesita cambiar para conectar el visor al sistema real.
Son tres puntos, en orden de importancia.

---

## 1. De dónde salen las personas — el proveedor

El visor lee las personas de un contexto de React. Hoy se lo da
`<SamplePeopleProvider>`, que genera datos falsos. Para integrar, reemplacen ese
componente por el suyo:

```tsx
// App.tsx
<QueryClientProvider client={queryClient}>
  <MiProveedorDePersonas>
    <PlanOccupancyViewer planUrl="/plano.dxf" />
  </MiProveedorDePersonas>
</QueryClientProvider>
```

El caso simple no necesita escribir un provider: `<PeopleProvider>` ya está
hecho y solo pide una fuente.

```tsx
import { PeopleProvider } from "./data/people-context";
import type { PeopleSource } from "./core/occupancy/types";

const fuente: PeopleSource = {
  label: "API detección",
  async fetchPeople(signal) {
    const res = await fetch("/api/personas/activas", { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const filas: LecturaRow[] = await res.json();

    return filas.map((r) => ({
      id: r.rut,
      name: r.nombre ?? r.rut,
      zoneId: String(r.id_zona),
      detectedAt: r.fecha,
      extra: {
        gerencia: r.gerencia,
        tag: r.tagid,
        lector: r.reader,
        zonaDescripcion: r.zona_descripcion,
      },
    }));
  },
};

<PeopleProvider source={fuente} sourceId="api" refreshIntervalMs={10_000}>
  <PlanOccupancyViewer planUrl="/plano.dxf" />
</PeopleProvider>;
```

El contrato completo son dos tipos
([`src/core/occupancy/types.ts`](src/core/occupancy/types.ts)):

```ts
interface Person {
  id: string;          // identidad estable (en el sistema de referencia, el RUT)
  name: string;
  zoneId: string;      // debe coincidir con los tokens del nombre de capa
  detectedAt: string;  // ISO-8601
  extra?: Record<string, string | number | null | undefined>;  // opcional, libre
}

interface PeopleSource {
  label: string;
  fetchPeople(signal?: AbortSignal): Promise<Person[]>;
}
```

`fetchPeople` recibe el `AbortSignal` de React Query: pásenlo a `fetch` y las
peticiones obsoletas se cancelan solas.

### Con WebSocket o SSE

`fetchPeople` solo tiene que resolver el último estado conocido. Para un sistema
push, guarden el snapshot y avísenle a React Query cuando cambie:

```tsx
const queryClient = useQueryClient();

useEffect(() => {
  const socket = new WebSocket("wss://…/presencia");
  socket.onmessage = (ev) => {
    queryClient.setQueryData(queryKeys.people("tiempo-real"), mapear(JSON.parse(ev.data)));
  };
  return () => socket.close();
}, [queryClient]);
```

Con `refreshIntervalMs={0}` desactivan el polling y queda solo el push.

### Lo único que hay que respetar

**`Person.zoneId` tiene que usar exactamente los mismos identificadores que los
nombres de capa del DXF.** Si la capa se llama `81-82`, el visor busca personas
con `zoneId === "81"` o `zoneId === "82"`. Son strings: `"85"` no es `85`.

Cualquier `zoneId` que no corresponda a una capa dibujada cae en **"Otras
zonas"** — no se pierde ni se descarta. Ese panel es el primer lugar donde mirar
si un conteo no cuadra.

### Cuando terminen

Borren `src/data/sample-people-provider.tsx` y `src/data/mock-people-source.ts`.
No los importa nada más que `App.tsx`.

---

## 2. Qué muestra la tabla — `src/ui/person-columns.ts`

Hoy la tabla muestra el mínimo: nombre, RUT, zona y hora de detección (más
permanencia, calculada). Para agregar un campo:

1. Póngalo en `Person.extra` desde su `PeopleSource`.
2. Agregue una entrada a `PERSON_COLUMNS`:

```ts
export const PERSON_COLUMNS: PersonColumn[] = [
  { key: "name",   header: "Nombre", value: (p) => p.name },
  { key: "id",     header: "RUT",    value: (p) => p.id,     variant: "mono", width: "8.5rem" },
  { key: "zoneId", header: "Zona",   value: (p) => p.zoneId, variant: "chip", width: "5rem" },

  // agregado:
  { key: "gerencia", header: "Gerencia", value: (p) => String(p.extra?.gerencia ?? "—") },
];
```

`variant` decide cómo se pinta la celda: `text` (por defecto), `mono`
(monoespaciado y a la derecha, para RUT/horas/códigos) o `chip` (pastilla, para
categorías cortas). `width` fija el ancho; sin él la columna reparte el
sobrante. `secondary: true` la oculta en pantallas chicas. El filtro del modal
busca sobre todas las columnas declaradas, sin configuración extra.

La columna de iniciales y la de permanencia no salen de acá: son fijas.

---

## 3. El componente y su caché

`<PlanOccupancyViewer>` es lo que montan. Su API completa:

```tsx
interface PlanOccupancyViewerProps {
  planUrl: string;            // ruta del DXF (la misma que reciba el proveedor)
  title?: string | null;      // null oculta la cabecera y deja plano + panel
  className?: string;
}
```

Requiere un `<QueryClientProvider>` y un `<PeopleProvider>` por encima. Si falta
el segundo, `usePeople()` tira un error que lo dice explícitamente en vez de
renderizar vacío.

Las claves de query viven en [`src/data/query-keys.ts`](src/data/query-keys.ts).
Están centralizadas para que dos consumidores del mismo dato compartan caché sin
coordinarse: es lo que permite que el proveedor de ejemplo lea el plano ya
parseado por el visor en vez de descargar 13 MB dos veces. Si escriben su propio
proveedor y necesitan las zonas del plano, usen `usePlanQuery(planUrl)` y
obtienen lo mismo gratis.

El plano usa `staleTime: Infinity` a propósito: un DXF no cambia bajo los pies.
Si cambia, cambia su URL.

---

## 4. Si su convención de capas es distinta — `src/core/dxf/zones.ts`

Todo el conocimiento sobre nombres de capa está en un archivo de ~20 líneas:

```ts
export const BASE_LAYER = "0";

export function parseZoneLayer(layer: string): string[] | null {
  // "0" → null (no es zona)
  // "85" → ["85"]
  // "81-82" → ["81", "82"]
}
```

Devolver `null` significa "esta capa no es una zona" y se ignora. Si su plano
usa, por ejemplo, `ZONA_85` o separa con `_`, es acá y en ningún otro lado.

Las capas ignoradas quedan listadas en `doc.ignoredLayers`, útil para depurar un
plano nuevo.

---

## Cambiar la UI completa

`src/core` no importa nada de `src/ui` ni de React. Si su stack de UI es otro,
lleve `core` tal cual y reescriba la capa de presentación (y `src/data`, que sí
es React Query). La superficie que necesita es:

```ts
import { loadDxf } from "./core/dxf/parse-dxf";
import { aggregateOccupancy } from "./core/occupancy/aggregate";
import { PlanRenderer } from "./core/render/plan-renderer";
import { fitBounds, screenToWorld, panBy, zoomAt } from "./core/render/viewport";

const doc = await loadDxf("/plano.dxf");
const snapshot = aggregateOccupancy(personas, doc.zoneLayers);

const renderer = new PlanRenderer(doc);          // una vez por documento
renderer.render(ctx, { viewport, width, height, zoneStyles, showBaseText });
const capa = renderer.hitTest(mundo);            // clic → nombre de capa | null
```

`PlanRenderer` recibe un `CanvasRenderingContext2D` y nada más: no conoce React,
ni el DOM más allá del canvas, ni de dónde vienen los datos.

Los colores están todos en `src/core/render/theme.ts` (`PlanTheme`), incluida la
rampa de densidad. Pásele otro tema al constructor y listo.

---

## Rendimiento — lo que conviene no romper

Medido sobre `public/plano.dxf` (13 MB, 35.046 entidades):

| Paso                        | Costo             |
| --------------------------- | ----------------- |
| Descarga + parseo           | ~200 ms, una vez  |
| Horneado de `Path2D`        | ~50 ms, una vez   |
| Frame de pan/zoom           | pocos ms          |
| Agregación de 240 personas  | despreciable      |

Las dos cosas que sostienen esto:

1. **El horneado ocurre una vez por documento**, no por frame. `PlanRenderer` se
   construye dentro de un `useMemo` sobre `doc`. Si lo reconstruye en cada
   render, el visor se arrastra.
2. **El texto se recorta por viewport y por tamaño en pantalla.** Dibujar 3.795
   textos sin filtrar cuesta cientos de ms por frame.

El parseo es síncrono y no toca el DOM: si el bloqueo inicial molesta, mueva
`parseDxf` a un Web Worker sin tocar nada más.
