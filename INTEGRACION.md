# Guía de integración

Todo lo que su equipo necesita para conectar el visor al sistema real. En
orden de importancia; los dos primeros puntos son los obligatorios y caben en
diez minutos.

---

## 0. Lo mínimo: dos archivos

1. **`.env`** (copien `.env.example`): la URL del endpoint que devuelve las
   filas de la vista de detección.

   ```
   VITE_PEOPLE_API_URL=https://su-servidor/api/personas
   VITE_PLANS_URL=https://su-servidor/api/planos      # opcional, ver punto 5
   ```

2. **`src/data/source.ts`** → `PEOPLE_FIELD_MAP`: qué columna alimenta cada
   campo. Ya viene con los nombres de `dbo.SDP_V_TIEMPOREAL_GOM`; si les
   renombran una columna, se cambia el string y nada más.

Con eso el visor arranca contra el API. Sin `VITE_PEOPLE_API_URL` arranca con
datos de ejemplo, que tienen exactamente la forma que el API debe devolver.

---

## 1. El endpoint de personas

El navegador **no habla con SQL Server**: su backend expone un endpoint HTTP
que devuelve, en JSON, las filas de la vista. El visor las pide cada 15 s
(`REFRESH_INTERVAL_MS`) con `fetch`, así que hace falta CORS o el mismo origen.

### a) Qué devuelve

Un arreglo de objetos con las columnas de la vista (también se acepta
`{ "rows": [...] }` o `{ "data": [...] }`; para otra forma, `rowsFrom` en
`createApiPeopleSource`). Una fila real:

```json
{
  "FECHA": "2026-09-10T10:13:12.153",
  "NOMBRE": "BRAVO RIQUELME CONSTANZA DANIELA",
  "GERENCIA": "GMIN",
  "RUT": "19.016.879-4",
  "TAGID": "0.451.224.461",
  "CARGO": "OPERADOR MINAS",
  "EMPRESA": "CODELCO",
  "CONTRATO": "",
  "ID_ZONA": 205,
  "ZONA": "DR/F2",
  "ZONA_DESCRIPCION": "Diablo Rgto. Fase 2 - Producción",
  "ID_READER": 183,
  "READER": "P743-SDP-ESM-15.m"
}
```

Las columnas `ID_DESDE_ZONA`, `DESDE_ZONE` y `DESDE_ZONE_DESCRIPTION` vienen
siempre vacías y se ignoran. Cuando exista `ESPECIALIDAD`, agréguenla al
`SELECT`: ya está mapeada y la columna de la tabla la muestra sola.

### b) La vista es un log, no una foto

`SDP_V_TIEMPOREAL_GOM` trae **todas las lecturas** de la última hora y pico:
unas 11.000 filas para unas 1.700 personas, con hasta 58 lecturas por persona
y personas en dos o tres zonas distintas. «Quién está dónde» es la **última
lectura por persona**. Dedupliquen en SQL: pesa diez veces menos y es lo que
el visor espera.

```sql
SELECT FECHA, NOMBRE, GERENCIA, RUT, TAGID, CARGO, EMPRESA, CONTRATO,
       ID_ZONA, ZONA, ZONA_DESCRIPCION, ID_READER, READER
FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY TAGID ORDER BY FECHA DESC) AS rn
  FROM dbo.SDP_V_TIEMPOREAL_GOM
) t
WHERE rn = 1;
```

El visor deduplica igual del lado cliente (`latestOnly`, por defecto), así que
si mandan el log completo funciona; solo baja más datos. Se partió por `TAGID`
porque nunca es nulo; el cliente vuelve a agrupar por `RUT` (o `TAGID` si no
hay), así que una persona con dos tags queda una sola vez.

### c) Cosas de los datos que ya están resueltas

- **`FECHA` no trae zona horaria.** Es la hora local del servidor
  (`2026-09-10T10:13:12.153`). Mándenla **tal cual, sin `Z`**: el navegador la
  interpreta en su propia zona horaria, que es la correcta mientras servidor y
  navegador estén en Chile. Nunca le agreguen una `Z` a la hora local: la
  columna «Permanencia» saldría corrida tres o cuatro horas. Si hay navegadores
  en otra zona, lo limpio es mandarla con offset desde SQL
  (`FECHA AT TIME ZONE 'Pacific SA Standard Time'`) o, como parche, fijar
  `PEOPLE_TIME_OFFSET` en `source.ts` — ojo que Chile cambia de UTC-3 a UTC-4
  con el horario de verano, así que un offset fijo está mal medio año.
- **`RUT` puede ser nulo** (~6 % de las filas: el tag no tiene persona
  asignada). Esas filas se identifican por `TAGID` y se muestran como
  «Tag 0.451.224.461» (`PEOPLE_NAME_FALLBACK`). No se descartan: son gente en
  la mina.
- **`CONTRATO` es `''`** para el personal propio. La celda muestra «—» y ese
  valor no aparece en el desplegable de contratos.
- **`ESPECIALIDAD` todavía no existe** en la vista. Está mapeada; la columna
  muestra «—» hasta que la agreguen. No hay que cambiar nada ese día.
- **Nombres de columna en otra grafía** (`id_zona`, `idZona`, `Id Zona`) se
  reconocen igual. Lo que no se reconoce se ignora, y si falta una columna
  obligatoria (`RUT`+`TAGID`, `ID_ZONA` o `FECHA`) la fila se descarta y se
  avisa en la consola: `[people] N fila(s) descartadas`.
- **`FOR JSON` omite las columnas nulas.** Da lo mismo: la resolución de
  columnas mira varias filas hasta encontrarlas todas. Si quieren filas
  uniformes, `FOR JSON PATH, INCLUDE_NULL_VALUES`.
- **El formato del `RUT` tiene que ser uno solo** entre filas
  (`12.345.678-9` y `123456789` serían dos personas). Normalícenlo en SQL.

### d) Cómo llega al visor

`src/App.tsx` ya lo hace: con `VITE_PEOPLE_API_URL` definida monta

```tsx
const fuente = createApiPeopleSource({
  url: PEOPLE_API_URL,
  fieldMap: PEOPLE_FIELD_MAP,
  assumeOffset: PEOPLE_TIME_OFFSET,
  nameFallback: PEOPLE_NAME_FALLBACK,
});

<PeopleProvider source={fuente} sourceId="api" refreshIntervalMs={15_000}>
  <PlanOccupancyViewer planUrl="/plano.dxf" plans={PROJECTS} />
</PeopleProvider>;
```

`createApiPeopleSource` (en `src/data/api-people-source.ts`) es `fetch` +
`mapRowsToPeople`, treinta líneas; acepta `headers` y `credentials` para
autenticación. Si su acceso no es HTTP —WebSocket, SSE, un SDK— escriban su
propio `PeopleSource` y usen el mismo adaptador sobre lo que reciban:

```ts
const fuente: PeopleSource = {
  label: "Detección",
  async fetchPeople(signal) {
    const filas = await miCliente.ultimasLecturas({ signal });
    return mapRowsToPeople(filas, PEOPLE_FIELD_MAP).people;
  },
};
```

Para un sistema push, guarden el snapshot y avísenle a React Query:

```tsx
const queryClient = useQueryClient();
useEffect(() => {
  const socket = new WebSocket("wss://…/presencia");
  socket.onmessage = (ev) => {
    const { people } = mapRowsToPeople(JSON.parse(ev.data), PEOPLE_FIELD_MAP);
    queryClient.setQueryData(queryKeys.people("tiempo-real"), people);
  };
  return () => socket.close();
}, [queryClient]);
```

Con `refreshIntervalMs={0}` desactivan el polling y queda solo el push.

### e) Lo único que hay que respetar

**`ID_ZONA` tiene que usar los mismos identificadores que los nombres de capa
del DXF.** Si la capa se llama `81-82`, el visor busca personas con zona `81`
o `82`. El adaptador convierte el número a texto; `85` y `"85"` son lo mismo.

Cualquier zona que no corresponda a una capa dibujada cae en **«Otras zonas»**:
no se pierde ni se descarta. Ese panel es el primer lugar donde mirar si un
conteo no cuadra.

### f) Cuando terminen

Borren `src/data/sample-people-provider.tsx` y `src/data/mock-people-source.ts`
y la rama sin API de `App.tsx`. Nada más los importa.

---

## 2. Renombrar columnas — `PEOPLE_FIELD_MAP`

El contrato entre sus datos y el visor es un objeto en `src/data/source.ts`:

| Campo             | Columna (por defecto) | Dónde se ve                                   |
| ----------------- | --------------------- | --------------------------------------------- |
| `id`              | `RUT`                 | identidad de la fila; no se muestra           |
| `idFallback`      | `TAGID`               | identidad cuando `RUT` viene nulo             |
| `name`            | `NOMBRE`              | columna «Nombre»                              |
| `zoneId`          | `ID_ZONA`             | cruce con las capas del DXF                   |
| `detectedAt`      | `FECHA`               | «Detección», «Permanencia», orden de la tabla |
| `company`         | `EMPRESA`             | columna y filtro «Empresa»                    |
| `contract`        | `CONTRATO`            | columna y filtro «Contrato»                   |
| `role`            | `CARGO`               | columna «Cargo»                               |
| `specialty`       | `ESPECIALIDAD`        | columna «Especialidad»                        |
| `zoneName`        | `ZONA`                | rótulo de zona cuando no hay descripción      |
| `zoneDescription` | `ZONA_DESCRIPCION`    | rótulo de zona                                |
| `extra`           | `GERENCIA`, `TAGID`, `READER` | quedan en `Person.extra` con ese nombre |

Los tipos viven en `src/core/occupancy/field-map.ts` (`PersonFieldMap`,
`mapRowsToPeople`) y `src/core/occupancy/types.ts` (`Person`). Ninguno importa
React: sirven desde cualquier código.

```ts
interface Person {
  id: string;             // RUT, o TAGID cuando no hay persona asignada
  name: string;
  zoneId: string;         // el token de la capa del DXF
  detectedAt: string;     // ISO-8601 en UTC, siempre con la misma forma
  company?: string | null;
  contract?: string | null;
  role?: string | null;
  specialty?: string | null;
  zoneName?: string | null;
  zoneDescription?: string | null;
  extra?: Record<string, string | number | null | undefined>;
}
```

---

## 3. Cómo se llaman las zonas

El plano solo conoce identificadores: la capa `85` es la zona `"85"` y nada
más. Un id no le dice nada a quien mira la pantalla, así que **todo lo que se
muestra pasa por un resolvedor** que intenta, en este orden:

```
descripción  →  nombre  →  id
```

### a) Ya vienen en las lecturas — no hay que hacer nada

`ZONA` y `ZONA_DESCRIPCION` llegan en cada fila; el field map las pone en
`zoneName` y `zoneDescription`, y el visor rotula la zona con ellas. Es lo que
pasa con la vista de referencia sin configurar nada.

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
cruzar con el sistema de detección. Todo esto son ~40 líneas en
[`src/core/occupancy/zone-names.ts`](src/core/occupancy/zone-names.ts).

---

## 4. Qué muestra la tabla — `src/ui/person-columns.ts`

Hoy la tabla muestra nombre, cargo, especialidad, empresa, contrato, zona y
fecha y hora de detección (`10-09-26 09:34`), más permanencia, calculada. El
RUT no se muestra: sigue siendo `Person.id`, la identidad del registro, pero no
aporta nada a quien mira una zona en pantalla. Cargo y especialidad se ocultan
bajo el breakpoint `md`, donde no cabrían siete columnas.

Los campos tipados se leen con `readRole`, `readSpecialty`, `readCompany` y
`readContract` (`src/core/occupancy/person-fields.ts`); un campo que su fuente
no trae muestra «—». Para mostrar otra columna del API:

1. Agreguen su nombre a `PEOPLE_FIELD_MAP.extra` (si no está ya).
2. Agreguen una entrada a `PERSON_COLUMNS`:

```ts
import { extraField } from "../core/occupancy/extra-fields";

export const PERSON_COLUMNS: PersonColumn[] = [
  { key: "name",     header: "Nombre",   value: (p) => p.name },
  { key: "cargo",    header: "Cargo",    value: (p) => readRole(p) ?? "—", secondary: true },
  …
  // agregado:
  { key: "gerencia", header: "Gerencia", value: (p) => extraField(p, "GERENCIA") ?? "—" },
];
```

`variant` decide cómo se pinta la celda: `text` (por defecto), `mono`
(monoespaciado y a la derecha, para códigos y horas) o `chip` (pastilla, para
categorías cortas). `width` fija el ancho; sin él la columna reparte el
sobrante. `secondary: true` la oculta en pantallas chicas. El filtro del modal
busca sobre todas las columnas declaradas, sin configuración extra.

El segundo argumento (`ctx`) es lo que la columna no puede deducir sola. Hoy
tiene un solo campo, `zoneLabel`, el resolvedor de nombres de zona del punto 3.

El contador del encabezado del modal sigue al filtro: muestra cuántas filas
quedan visibles y, cuando hay filtro puesto, agrega «de N personas en total».

### Usar otra tabla completa — `table`

Si necesitan su propio data-grid (ordenar por columna, agrupar, exportar a
Excel, virtualizar diez mil filas), no hay que tocar el visor: pásenle el
componente.

```tsx
import type { PeopleTableProps } from "./ui/PeopleTable";

function MiTabla({ people, emptyMessage, zoneLabel, onVisibleCountChange }: PeopleTableProps) {
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
  onVisibleCountChange?: (n: number) => void;  // cuántas filas deja ver su filtro
}
```

---

## 5. La barra de arriba — proyecto, sector, empresa, contrato

Cuatro desplegables que se ven iguales y hacen **dos cosas distintas**:

| Desplegable | Qué hace                    | Dónde vive                                |
| ----------- | --------------------------- | ----------------------------------------- |
| Proyecto    | Elige **qué DXF se carga**  | `src/core/dxf/plan-catalog.ts`            |
| Sector      | Elige **qué DXF se carga**  | `src/core/dxf/plan-catalog.ts`            |
| Empresa     | Filtra **qué gente se ve**  | `src/core/occupancy/people-filters.ts`    |
| Contrato    | Filtra **qué gente se ve**  | `src/core/occupancy/people-filters.ts`    |

Cada par es su propia cascada —el sector depende del proyecto, el contrato
depende de la empresa— y entre pares no hay relación.

### a) Proyecto y sector — el catálogo de planos

Elegir un proyecto **cambia el dibujo**: el visor descarga y parsea otro DXF.
Las zonas son las que ese archivo traiga; una zona que no esté dibujada en el
plano cargado cae en «Otras zonas», exactamente como siempre.

El catálogo es el JSON del sistema: un arreglo de proyectos, cada uno con su
`dxf` (el plano general, el que se dibuja sin sector elegido) y sus
`sectores`, cada uno con el suyo. `id` es opcional.

```json
[
  { "id": "exp", "nombre": "Expansión Nivel 320", "dxf": "/planos/exp.dxf",
    "sectores": [
      { "id": "mina",   "nombre": "Interior Mina", "dxf": "/planos/exp-mina.dxf" },
      { "id": "planta", "nombre": "Planta",        "dxf": "/planos/exp-planta.dxf" }
    ] },
  { "id": "cont", "nombre": "Continuidad Operacional", "dxf": "/planos/cont.dxf" }
]
```

Puede venir de un endpoint (`VITE_PLANS_URL` en `.env`; `usePlansQuery` lo
descarga una vez y lo valida) o ir escrito en `PROJECTS`, en
`src/data/source.ts`. `<PlanOccupancyViewer plans={…} />` acepta esa forma
anidada o la lista plana `PlanOption[]` equivalente.

Las reglas, todas en `plan-catalog.ts`:

- **Sin proyecto elegido** se dibuja el `planUrl` que recibe el visor.
- **Con proyecto y sin sector** se dibuja el `dxf` del proyecto.
- **Cambiar de proyecto limpia el sector.**
- **Sin proyecto elegido no se ofrecen sectores.**
- **Sin catálogo** los dos desplegables salen apagados, no vacíos.

Al cambiar el plano, la zona que estuviera abierta se deselecciona.

`onPlanUrlChange(url, plan)` avisa cada vez que cambia el DXF dibujado, por si
su fuente de personas quiere pedir solo las de ese proyecto. La fuente del
punto 1 no depende del plano y lo ignora.

### b) Empresa y contrato — el filtro de personas

Filtran gente **antes** de repartirla por zona: el plano, los conteos del
panel y la tabla del modal miran siempre el mismo subconjunto.

No hay que configurarlos: se llenan con `person.company` y `person.contract`.
Con nada puesto, «Empresa» lista las empresas de todos los datos; elegida una,
«Contrato» ofrece solo los contratos de esa empresa. Cambiar de empresa limpia
el contrato. Un campo que su fuente no manda deja su desplegable apagado.

El panel lateral avisa que hay filtro: «Total detectadas» muestra `340 de 1652`.

### Agregar o cambiar un filtro de personas

El visor recibe la lista por prop; el orden **es** el orden de la cascada:

```tsx
import { PEOPLE_FILTERS } from "./core/occupancy/people-filters";
import { extraField } from "./core/occupancy/extra-fields";

<PlanOccupancyViewer
  planUrl="/plano.dxf"
  filters={[
    ...PEOPLE_FILTERS,
    { key: "gerencia", label: "Gerencia", allLabel: "Todas",
      read: (p) => extraField(p, "GERENCIA") },
  ]}
/>;
```

`read` es cualquier `(person) => string | null`. Con `showFilters={false}` no
hay barra: dibuja `planUrl` y muestra a todo el mundo.

---

## 6. El componente y su caché

`<PlanOccupancyViewer>` es lo que montan. Su API completa:

```tsx
interface PlanOccupancyViewerProps {
  planUrl: string;                       // DXF por defecto, sin proyecto elegido
  plans?: ProjectEntry[] | PlanOption[]; // catálogo de proyecto/sector; punto 5
  onPlanUrlChange?: (url: string, plan: PlanOption | null) => void;
  title?: string | null;                 // null oculta la cabecera
  className?: string;
  zones?: ZoneCatalog;                   // nombres de zona; punto 3
  table?: PeopleTableComponent;          // otra tabla para el modal; punto 4
  filters?: PeopleFilterDef[];           // desplegables de personas; punto 5
  totalLabel?: string;                   // rótulo del total del panel lateral
  allowFullscreen?: boolean;             // botón de pantalla completa (true)
  showFilters?: boolean;                 // barra de arriba (true)
}
```

Requiere un `<QueryClientProvider>` y un `<PeopleProvider>` por encima. Si falta
el segundo, `usePeople()` tira un error que lo dice explícitamente.

### Pantalla completa

El botón de la cabecera expande **el componente**, no la pestaña. Dentro de un
`<iframe>` hace falta `allow="fullscreen"`; sin eso el botón no se dibuja.
Con `allowFullscreen={false}` no aparece nunca.

### Controles del plano

Abajo a la derecha: acercar, alejar, ajustar al plano completo y centrar en la
zona seleccionada, con indicador de zoom relativo al encuadre completo. Por
teclado, con el plano enfocado: `+` / `−`, `0`, `F`.

Al alejar el zoom, las insignias de conteo que se amontonan **se agrupan en
una sola** con la suma de personas distintas y la leyenda «N zonas agrupadas»
(doble borde). Ninguna persona deja de contarse. Un clic en una insignia
agrupada acerca la cámara hasta que se separan; la zona seleccionada nunca se
absorbe en un grupo. La lógica está en `src/core/render/badge-clusters.ts`.

### Caché

Las claves de query viven en `src/data/query-keys.ts`. Están centralizadas para
que dos consumidores del mismo dato compartan caché: es lo que permite que el
proveedor de ejemplo lea el plano ya parseado por el visor. El plano usa
`staleTime: Infinity`: un DXF no cambia bajo los pies; si cambia, cambia su URL.

---

## 7. Si su convención de capas es distinta — `src/core/dxf/zones.ts`

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
usa, por ejemplo, `ZONA_85` o separa con `_`, es acá y en ningún otro lado. Las
capas ignoradas quedan listadas en `doc.ignoredLayers`.

---

## 8. Los recorridos (modo oculto)

Además del plano, el repo trae dos **recorridos** sobre el DXF: uno en primera
persona (`src/ui/PerspectiveView.tsx`) y uno cenital por rondas
(`src/ui/OverheadView.tsx`), con un HUD común (`src/ui/mode-hud.tsx`) y su
motor en `src/core/render/perspective.ts`, `placement.ts` y `sprites.ts`. Usan
el mismo `DxfDocument`, la misma ocupación (ya filtrada) y los mismos nombres
de zona que el plano.

No están en la interfaz: se abren con una secuencia de teclas **con el plano
enfocado** (un clic sobre él):

- `↑ ↑ ↓ ↓ ← → ← → B A` → recorrido en perspectiva
- `↑ ↑ ↓ ↓ ← → ← → A B` → recorrido cenital

`Escape` vuelve al plano. Se cargan por `lazy()` en chunks aparte, así que no
pesan en el bundle de quien solo mira el plano (~8 kB gzip cada uno, solo al
abrirlos).

Son opcionales. Para sacarlos del todo: borren los seis archivos de arriba y,
en `src/ui/PlanCanvas.tsx`, los dos `lazy(...)`, el estado `mode`, las
constantes `SEQUENCE_PREFIX`/`MODE_SEQUENCES` y el bloque `{mode && …}` del
JSX. `tsc` señala cualquier resto.

---

## Cambiar la UI completa

`src/core` no importa nada de `src/ui` ni de React. Si su stack de UI es otro,
lleve `core` tal cual y reescriba la capa de presentación (y `src/data`, que sí
es React Query). La superficie que necesita es:

```ts
import { loadDxf } from "./core/dxf/parse-dxf";
import { mapRowsToPeople } from "./core/occupancy/field-map";
import { aggregateOccupancy } from "./core/occupancy/aggregate";
import { PlanRenderer } from "./core/render/plan-renderer";
import { fitBounds, screenToWorld, panBy, zoomAt } from "./core/render/viewport";

const doc = await loadDxf("/plano.dxf");
const { people } = mapRowsToPeople(filasDelApi, PEOPLE_FIELD_MAP);
const snapshot = aggregateOccupancy(people, doc.zoneLayers);

const renderer = new PlanRenderer(doc);          // una vez por documento
renderer.render(ctx, { viewport, width, height, zoneStyles, showBaseText });
const capa = renderer.hitTest(mundo);            // clic → nombre de capa | null
```

Los colores están todos en `src/core/render/theme.ts` (`PlanTheme`), incluida
la rampa de densidad. Pásele otro tema al constructor y listo.

---

## Rendimiento — lo que conviene no romper

Medido sobre `public/plano.dxf` (13 MB, 35.046 entidades) y sobre 9.381 filas
reales de la vista:

| Paso                              | Costo             |
| --------------------------------- | ----------------- |
| Descarga + parseo del DXF         | ~200 ms, una vez  |
| Horneado de `Path2D`              | ~50 ms, una vez   |
| Frame de pan/zoom                 | pocos ms          |
| `mapRowsToPeople` de 9.381 filas  | ~66 ms            |
| Agregación de 1.500 personas      | despreciable      |

Lo que sostiene esto:

1. **El horneado ocurre una vez por documento**, no por frame. `PlanRenderer` se
   construye dentro de un `useMemo` sobre `doc`.
2. **El texto se recorta por viewport y por tamaño en pantalla.**
3. **Los campos de `Person` son tipados.** Filtros, columnas y rótulos leen
   `person.company`, no buscan entre claves: el costo por refresco es lineal en
   personas, no en personas × columnas.
4. **Deduplicar en SQL.** El cliente lo hace igual, pero 1.500 filas cada 15 s
   son mejor que 11.000.

El parseo del DXF es síncrono y no toca el DOM: si el bloqueo inicial molesta,
mueva `parseDxf` a un Web Worker sin tocar nada más.
