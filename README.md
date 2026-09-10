# Visor DXF — ocupación por zonas

Visor de planos DXF que superpone, sobre cada polígono de zona, cuánta gente hay
según un sistema de detección de personas. Al hacer clic en una zona se abre la
tabla con las personas que están dentro.

Este repo es una **base de referencia para integrar**, no un producto cerrado.
La lógica que importa vive en `src/core` y no depende de React.

```bash
pnpm install     # o npm install
pnpm dev         # http://localhost:5173
```

Arranca con datos de ejemplo generados en el navegador. Para conectar el sistema
real hacen falta dos cosas, y están explicadas paso a paso en
[INTEGRACION.md](INTEGRACION.md):

1. `.env` → `VITE_PEOPLE_API_URL`: el endpoint que devuelve las filas de la
   vista de detección en JSON.
2. `src/data/source.ts` → `PEOPLE_FIELD_MAP`: qué columna alimenta cada campo.
   Si les renombran una columna, se cambia un string.

```tsx
const fuente = createApiPeopleSource({ url: PEOPLE_API_URL, fieldMap: PEOPLE_FIELD_MAP });

<QueryClientProvider client={queryClient}>
  <PeopleProvider source={fuente} sourceId="api">
    <PlanOccupancyViewer planUrl="/plano.dxf" plans={PROJECTS} />
  </PeopleProvider>
</QueryClientProvider>
```

`<PlanOccupancyViewer>` es el componente que montan en su aplicación. No sabe de
dónde salen las personas: las lee del contexto que le da el proveedor.

---

## Qué hace

- Dibuja **todo** el contenido de la capa `0` del DXF: polilíneas, líneas, arcos,
  círculos, elipses, splines, textos y bloques (`INSERT`) expandidos.
- Interpreta el resto de capas como **zonas**, las rellena con un color según su
  densidad de personas y les pone encima una insignia con el conteo.
- Muestra cada zona por su **nombre**, no por su id: usa la descripción, o el
  nombre si no hay descripción, o el id si no hay ninguno de los dos.
- **Barra de arriba** con cuatro desplegables, que hacen dos cosas distintas:
  **proyecto** y **sector** eligen qué DXF se carga (de un catálogo JSON:
  proyectos, cada uno con su plano y sus sectores con el suyo); **empresa** y
  **contrato** filtran las personas antes de repartirlas por zona, así que el
  plano, los conteos y la tabla miran siempre el mismo subconjunto. Cada par es
  su propia cascada: el sector depende del proyecto, el contrato depende de la
  empresa.
- **Insignias que se agrupan**: al alejar el zoom, las que se amontonan se
  funden en una sola con la suma de personas; nadie deja de contarse. Clic en
  una agrupada acerca la cámara hasta que se separan.
- Clic en una zona (en el plano o en la lista lateral) → modal con la tabla de
  personas, filtrable por columna, con el recuento «N de M» arriba a la derecha.
  La tabla es reemplazable por la suya.
- Panel **"Otras zonas"**: total de personas cuya zona no está dibujada en el
  plano, con su propia tabla. Nunca se descartan en silencio.
- Pan, zoom, ajuste a la vista y enfoque automático a la zona seleccionada, más
  un panel de cámara con indicador de zoom y atajos de teclado (`+`, `−`, `0`, `F`).
- **Pantalla completa** del componente entero, no de la pestaña.
- Refresco automático con TanStack Query, manteniendo los últimos conteos
  buenos mientras la petición está en vuelo.

## La convención de capas

| Nombre de capa   | Significado                                                |
| ---------------- | ---------------------------------------------------------- |
| `0`              | Plano base. Se dibuja tal cual, en gris.                   |
| `85`             | Zona 85.                                                   |
| `81-82`          | Una sola figura que cubre las zonas 81 **y** 82.           |
| `75-142-128-207` | Ídem, cuatro zonas.                                        |

Una capa puede tener **varias polilíneas**; todas pertenecen al mismo grupo de
zonas. En `public/plano.dxf` la capa `15-212` tiene 4 anillos.

Cuando una capa agrupa varias zonas, su conteo es la **suma** de las personas de
todas ellas — el dibujo no permite distinguirlas. La tabla sí muestra la zona
individual de cada persona.

Está implementado en [`src/core/dxf/zones.ts`](src/core/dxf/zones.ts), en unas 20
líneas. Si su convención es otra, ese es el archivo a cambiar.

## Estructura

```
src/
  core/                     ← TypeScript puro, sin React. Esto es lo reutilizable.
    dxf/
      types.ts              Modelo normalizado (3 primitivas: path, circle, text)
      geometry.ts           Bulges, arcos, elipses, splines, centroides, hit-test
      parse-dxf.ts          dxf-parser → modelo normalizado + expansión de bloques
      zones.ts              Convención de nombres de capa
      plan-catalog.ts       Proyecto/sector → qué DXF se carga
    occupancy/
      types.ts              Person, PeopleSource — EL CONTRATO con su sistema
      field-map.ts          Columnas del API → Person (field map, dedupe, fechas)
      aggregate.ts          personas[] → conteo por capa + "otras zonas"
      zone-names.ts         id de zona → descripción / nombre / id
      extra-fields.ts       normalizeKey, textValue, extraField(person, "COL")
      person-fields.ts      readCompany / readContract / readRole / readSpecialty
      people-filters.ts     Filtros en cascada (empresa, contrato…), sin React
    render/
      viewport.ts           Matemática de pan/zoom (world ↔ screen)
      theme.ts              Todos los colores
      plan-renderer.ts      Renderer Canvas 2D + hit-testing
      badge-clusters.ts     Agrupación de insignias al alejar el zoom
      perspective.ts        Motor de los recorridos (raycast, colisiones)
      placement.ts          Personas → puntos del mundo (recorridos)
      sprites.ts            Pixel art de los recorridos
  data/                     ← React Query. La capa que se configura al integrar.
    source.ts               ← LO QUE SE EDITA: URLs, PEOPLE_FIELD_MAP, PROJECTS
    api-people-source.ts    PeopleSource real: fetch + mapRowsToPeople
    query-keys.ts           Claves centralizadas (permiten compartir caché)
    use-plan-query.ts       Descarga + parseo del DXF, una vez por URL
    use-plans-query.ts      Descarga del catálogo de proyectos (VITE_PLANS_URL)
    people-context.tsx      PeopleProvider genérico + hook usePeople()
    sample-people-provider.tsx  ← ANDAMIO: envuelve al visor con datos falsos
    mock-people-source.ts   Filas de ejemplo con la forma de la vista (borrable)
  ui/                       ← React. Reemplazable por completo.
    PlanOccupancyViewer.tsx ← EL COMPONENTE que montan en su app
    PlanCanvas.tsx          Canvas + insignias HTML + panel de cámara
    FilterBar.tsx           Los cuatro desplegables de arriba
    Sidebar.tsx             Resumen, "otras zonas", lista de zonas
    PeopleDialog.tsx        Modal (<dialog> nativo)
    PeopleTable.tsx         Tabla por defecto + el contrato para reemplazarla
    person-columns.ts       Columnas de la tabla (agregar campos acá)
    use-fullscreen.ts       Pantalla completa sobre la raíz del componente
    PerspectiveView.tsx     Recorrido en primera persona (modo oculto)
    OverheadView.tsx        Recorrido cenital por rondas (modo oculto)
    mode-hud.tsx            HUD común de los recorridos
```

Regla que se respeta en todo el repo: **`src/core` no importa nada de `src/ui`**.
Si su equipo usa Vue, Svelte, Angular o React con otra librería de UI, `core` se
lleva tal cual y solo se reescribe `ui`.

## Decisiones técnicas

**Canvas 2D en vez de `dxf-viewer` + three.js.** El plano de ejemplo tiene 35.000
entidades. Se hornean una sola vez en un puñado de objetos `Path2D`, así que un
frame de pan/zoom son unas pocas llamadas a `stroke()` en vez de 35.000. El
bundle queda en ~80 kB gzip en total; con three.js serían ~700 kB. Además no hay
contexto WebGL que se pierda, y superponer HTML sobre el canvas es trivial.

**Las insignias de conteo son HTML, no canvas.** Texto nítido, hover y foco
reales, accesibles por teclado, y se estilan con CSS normal.

**El detalle es un `<dialog>` nativo, no una librería de modales.** El navegador
ya da trampa de foco, cierre con Escape, fondo inerte y semántica de modal. Una
dependencia menos que sacar, y accesible por defecto. De yapa vive en la *top
layer*, así que sigue apareciendo por encima del visor en pantalla completa —
un modal hecho con divs quedaría tapado.

**La pantalla completa se pide sobre la raíz del componente, no sobre el
documento.** Embebido en una página ajena, el visor se expande solo él y se
lleva su cabecera, su panel y su modal. Dentro de un `<iframe>` hace falta
`allow="fullscreen"`; sin eso el botón no se dibuja en vez de quedar inerte.

**La tabla del modal es intercambiable.** El visor recibe el componente por
prop (`table`), así que un equipo que necesite su propio data-grid no tiene que
bifurcar nada. El contrato es de tres campos.

**El proveedor de datos envuelve al visor.** Así el andamio de datos de ejemplo
se borra sin tocar el visor: se cambia un componente por el suyo y listo. El
proveedor de ejemplo lee el plano con la misma query que el visor, así que los
13 MB se descargan y parsean una sola vez pese a tener dos consumidores.

**El contrato con los datos es un field map, no un adaptador escrito a mano.**
`Person` tiene campos tipados (`company`, `contract`, `role`, `specialty`,
`zoneName`, `zoneDescription`) y `mapRowsToPeople` los llena desde las filas
del API según `PEOPLE_FIELD_MAP`. Renombrar una columna es cambiar un string;
los datos de ejemplo pasan por el mismo adaptador, así que se prueba en cada
refresco. El adaptador además deduplica (la vista real es un log de lecturas,
no una foto), cae a `TAGID` cuando `RUT` viene nulo y normaliza las fechas a
ISO UTC para que ordenar sea comparar strings.

**Los recorridos están ocultos a propósito.** Se abren con una secuencia de
teclas y se cargan en chunks aparte; INTEGRACION.md §8 explica cómo activarlos
y cómo quitarlos.

**El parseo es síncrono** (~200 ms para 13 MB). No toca el DOM, así que si les
molesta el bloqueo, `parseDxf` se puede mover a un Web Worker sin cambios.

## Detalles del formato que ya están resueltos

Cosas que cuestan encontrar cuando uno parte de cero, y que ya vienen manejadas:

- **Polígonos de zona guardados abiertos.** 7 de los 21 anillos de `plano.dxf`
  tienen el flag de cerrado en `false`. Se cierran igual: si no, desaparecen.
- **Una entidad muy lejana rompe el encuadre inicial.** `plano.dxf` tiene un
  `ARC` en x = −42.432. El auto-ajuste usa un bounding box recortado por
  percentiles (`fitBounds`), no el bounding box crudo.
- **`bulge` en polilíneas**: son arcos, no segmentos rectos. Se expanden.
- **Bloques (`INSERT`)**: se expanden con su transformación (posición, escala,
  rotación, punto base), hasta 4 niveles de anidamiento.
- **Ejes Y invertidos**: DXF crece hacia arriba, canvas hacia abajo. El texto se
  dibuja en espacio de pantalla para que no salga espejado.
- **Texto ilegible**: se descarta bajo 6 px en pantalla, y se recorta por
  viewport. Sin esto, alejar el zoom cuesta cientos de ms por frame.
- **Insignias superpuestas**: el plano son 4 niveles apilados verticalmente, así
  que alejado se amontonan. Las que se taparían se funden en una insignia
  agrupada que suma personas distintas; al acercar se separan solas.
- **Una capa puede tener anillos en niveles distintos.** En `plano.dxf`, las
  capas `15-212` y `186` tienen anillos separados ~2.700 unidades en Y, o sea en
  dos niveles distintos de la mina. Por eso la cámara enfoca el anillo más
  grande (`zoneLayer.focusBounds`) y no la unión de todos: encuadrar la unión
  aleja tanto que no se ve nada. La insignia también se ancla ahí; el conteo es
  de la capa completa.

## Cómo cambiar el plano

Reemplazar `public/plano.dxf`, cambiar `PLAN_URL` en `src/data/source.ts`, o
declarar varios en el catálogo de proyectos (`PROJECTS` o `VITE_PLANS_URL`).
No hay nada específico de este plano en el código.

## Variables de entorno

Copiar `.env.example` a `.env` (no se versiona):

| Variable              | Qué hace                                                        |
| --------------------- | --------------------------------------------------------------- |
| `VITE_PEOPLE_API_URL` | Endpoint con las filas de personas en JSON. Vacío → datos de ejemplo. |
| `VITE_PLANS_URL`      | Endpoint con el catálogo de proyectos/sectores/planos. Vacío → `PROJECTS`. |

## Scripts

| Comando          | Qué hace                        |
| ---------------- | ------------------------------- |
| `pnpm dev`       | Servidor de desarrollo          |
| `pnpm build`     | Typecheck + build de producción |
| `pnpm typecheck` | Solo `tsc --noEmit`             |
| `pnpm preview`   | Sirve el build                  |

## Dependencias

`react`, `react-dom`, `dxf-parser`, `@tanstack/react-query`. Tailwind CSS solo
para los estilos de la carpeta `ui`. Nada más — a propósito.

La tipografía (IBM Plex Sans/Mono) entra por un `<link>` a Google Fonts en
`index.html`: una línea, bórrenla si usan otra familia o si el visor corre sin
salida a internet — el CSS ya cae a `system-ui`. Todos los colores y fuentes
son tokens en `src/index.css`.
