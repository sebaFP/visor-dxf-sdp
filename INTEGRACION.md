# Guía de integración

Todo lo que su equipo necesita cambiar para conectar el visor al sistema real.
Son cinco puntos, en orden de importancia; los dos primeros son los
obligatorios.

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
      zoneId: String(r.ID_ZONA),
      detectedAt: r.fecha,
      extra: {
        gerencia: r.gerencia,
        tag: r.tagid,
        lector: r.reader,
        // Con esto las zonas se muestran por nombre y no por id — ver punto 2.
        ZONA: r.ZONA,
        ZONA_DESCRIPCION: r.ZONA_DESCRIPCION,
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

**`Person.zoneId` (o sea `ID_ZONA`) tiene que usar exactamente los mismos
identificadores que los nombres de capa del DXF.** Si la capa se llama `81-82`,
el visor busca personas con `zoneId === "81"` o `zoneId === "82"`. Son strings:
`"85"` no es `85`.

Esto vale para el cruce y solo para el cruce. Lo que se muestra en pantalla es
el nombre de la zona, no el id — ver el punto 2.

Cualquier `zoneId` que no corresponda a una capa dibujada cae en **"Otras
zonas"** — no se pierde ni se descarta. Ese panel es el primer lugar donde mirar
si un conteo no cuadra.

### Cuando terminen

Borren `src/data/sample-people-provider.tsx` y `src/data/mock-people-source.ts`.
No los importa nada más que `App.tsx`.

---

## 2. Cómo se llaman las zonas — `zones`

El plano solo conoce identificadores: la capa `85` es la zona `"85"` y nada más.
Un id no le dice nada a quien mira la pantalla, así que **todo lo que se muestra
pasa por un resolvedor** que intenta, en este orden:

```
descripción  →  nombre  →  id
```

Hay dos formas de darle esos datos, y funcionan juntas.

### a) Ya vienen en las lecturas — no hay que hacer nada

Su esquema trae `ID_ZONA`, `ZONA` y `ZONA_DESCRIPCION`. Con mapearlos así ya
está todo hecho:

```ts
return filas.map((r) => ({
  id: r.rut,
  name: r.nombre ?? r.rut,
  zoneId: String(r.ID_ZONA),        // ← lo que se cruza con las capas del DXF
  detectedAt: r.fecha,
  extra: {
    ZONA: r.ZONA,                   // ← nombre
    ZONA_DESCRIPCION: r.ZONA_DESCRIPCION,  // ← descripción, la que se muestra
  },
}));
```

`ID_ZONA` va en `zoneId` porque es lo que ata la persona al plano. Los otros dos
van en `extra` tal cual: el visor los busca ahí y rotula la zona con ellos.

**La comparación de claves ignora mayúsculas, guiones, espacios y acentos**, así
que `ZONA_DESCRIPCION`, `zonaDescripcion`, `zona_descripcion` y
`"Zona Descripción"` son la misma cosa. Las formas que reconoce:

| Campo       | Claves aceptadas en `extra` (en cualquier grafía)                  |
| ----------- | ------------------------------------------------------------------ |
| descripción | `ZONA_DESCRIPCION`, `DESCRIPCION_ZONA`, `zoneDescription`          |
| nombre      | `ZONA`, `ZONA_NOMBRE`, `NOMBRE_ZONA`, `zoneName`, `zone`           |

Un valor vacío o en blanco cuenta como ausente y cae al siguiente escalón.

### b) Un catálogo explícito — `zones`

Cuando el nombre no viaja con las lecturas, o cuando quieren que mande el
maestro de zonas y no lo que llegue en el último refresco:

```tsx
<PlanOccupancyViewer
  planUrl="/plano.dxf"
  zones={{
    "85": { description: "Galería 4 Norte — Nivel 320" },
    "81": { name: "Rampa Principal" },
  }}
/>
```

Acepta un objeto o un `Map`. El catálogo **manda** sobre lo que traigan las
lecturas; las lecturas rellenan lo que el catálogo no tenga; el id es el último
recurso, así que una zona nunca queda sin rótulo.

Los ids crudos no desaparecen: siguen en el subtítulo del modal, en la segunda
línea del panel lateral y en el tooltip de la insignia, que es donde sirven para
cruzar con el sistema de detección.

Todo esto son ~40 líneas en
[`src/core/occupancy/zone-names.ts`](src/core/occupancy/zone-names.ts).

---

## 3. Qué muestra la tabla — `src/ui/person-columns.ts`

Hoy la tabla muestra el mínimo: nombre, RUT, zona y hora de detección (más
permanencia, calculada). Para agregar un campo:

1. Póngalo en `Person.extra` desde su `PeopleSource`.
2. Agregue una entrada a `PERSON_COLUMNS`:

```ts
export const PERSON_COLUMNS: PersonColumn[] = [
  { key: "name",   header: "Nombre", value: (p) => p.name },
  { key: "id",     header: "RUT",    value: (p) => p.id, variant: "mono", width: "8.5rem" },
  { key: "zoneId", header: "Zona",   value: (p, ctx) => ctx.zoneLabel(p.zoneId), variant: "chip" },

  // agregado:
  { key: "gerencia", header: "Gerencia", value: (p) => String(p.extra?.gerencia ?? "—") },
];
```

`variant` decide cómo se pinta la celda: `text` (por defecto), `mono`
(monoespaciado y a la derecha, para RUT/horas/códigos) o `chip` (pastilla, para
categorías cortas). `width` fija el ancho; sin él la columna reparte el
sobrante. `secondary: true` la oculta en pantallas chicas. El filtro del modal
busca sobre todas las columnas declaradas, sin configuración extra.

El segundo argumento (`ctx`) es lo que la columna no puede deducir sola. Hoy
tiene un solo campo, `zoneLabel`, el resolvedor de nombres de zona del punto 2.
Ignórenlo si su columna no lo necesita.

La columna de iniciales y la de permanencia no salen de acá: son fijas.

### Usar otra tabla completa — `table`

Si necesitan su propio data-grid (ordenar por columna, agrupar, exportar a
Excel, virtualizar diez mil filas), no hay que tocar el visor: pásenle el
componente.

```tsx
import type { PeopleTableProps } from "./ui/PeopleTable";

function MiTabla({ people, emptyMessage, zoneLabel }: PeopleTableProps) {
  // lo que sea: AG Grid, TanStack Table, MUI DataGrid…
}

<PlanOccupancyViewer planUrl="/plano.dxf" table={MiTabla} />;
```

El contrato es `PeopleTableComponent`, o sea un componente que recibe:

```ts
interface PeopleTableProps {
  people: Person[];              // ya filtradas y ordenadas por detección
  emptyMessage: string;          // qué decir cuando no hay nadie
  zoneLabel?: ZoneLabeller;      // (zoneId) => rótulo legible
}
```

La tabla del repo cumple esa firma, así que es literalmente intercambiable. El
modal, su encabezado, el conteo y el cierre siguen siendo del visor: ustedes
solo ponen lo de adentro.

---

## 4. El componente y su caché

`<PlanOccupancyViewer>` es lo que montan. Su API completa:

```tsx
interface PlanOccupancyViewerProps {
  planUrl: string;               // ruta del DXF (la misma que reciba el proveedor)
  title?: string | null;         // null oculta la cabecera y deja plano + panel
  className?: string;
  zones?: ZoneCatalog;           // nombres de zona; ver punto 2
  table?: PeopleTableComponent;  // otra tabla para el modal; ver punto 3
  allowFullscreen?: boolean;     // botón de pantalla completa (por defecto true)
}
```

Requiere un `<QueryClientProvider>` y un `<PeopleProvider>` por encima. Si falta
el segundo, `usePeople()` tira un error que lo dice explícitamente en vez de
renderizar vacío.

### Pantalla completa

El botón de la cabecera expande **el componente**, no la pestaña: pide
`requestFullscreen()` sobre su propio nodo raíz, así que el visor embebido en
una página ajena se lleva a pantalla completa su cabecera, su panel lateral y su
modal, y nada más. Se sale con el mismo botón o con Escape.

Dos cosas a tener presentes:

- El estado del botón se lee del documento (`fullscreenchange`), no se guarda al
  pedirlo. Es lo único que se entera de que el usuario salió con Escape o de que
  el navegador rechazó la petición.
- **Dentro de un `<iframe>` hace falta `allow="fullscreen"`.** Sin eso
  `document.fullscreenEnabled` es `false` y el botón directamente no se dibuja,
  en vez de quedar ahí sin hacer nada.

Con `allowFullscreen={false}` no aparece nunca. Con `title={null}` no hay
cabecera donde ponerlo, así que flota sobre el plano arriba a la derecha.

### Controles del plano

Abajo a la derecha del plano hay un panel de cámara: acercar, alejar, ajustar al
plano completo y centrar en la zona seleccionada, más un indicador de zoom. El
indicador es relativo al encuadre completo (`1×` = todo el plano en pantalla) y
no un porcentaje, porque un DXF está en unidades de mundo y un "100%" no
significaría nada.

Los mismos comandos por teclado cuando el plano tiene el foco: `+` / `−` para
zoom, `0` para ajustar, `F` para centrar en la zona seleccionada. Son atajos del
contenedor del plano y no del documento, así que nunca le roban una tecla al
filtro de la tabla ni a un input de su aplicación.

Las claves de query viven en [`src/data/query-keys.ts`](src/data/query-keys.ts).
Están centralizadas para que dos consumidores del mismo dato compartan caché sin
coordinarse: es lo que permite que el proveedor de ejemplo lea el plano ya
parseado por el visor en vez de descargar 13 MB dos veces. Si escriben su propio
proveedor y necesitan las zonas del plano, usen `usePlanQuery(planUrl)` y
obtienen lo mismo gratis.

El plano usa `staleTime: Infinity` a propósito: un DXF no cambia bajo los pies.
Si cambia, cambia su URL.

---

## 5. Si su convención de capas es distinta — `src/core/dxf/zones.ts`

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
