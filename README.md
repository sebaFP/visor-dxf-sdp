# Visor DXF — ocupación por zonas

Visor de planos DXF que superpone, sobre cada polígono de zona, cuánta gente hay
según un sistema de detección de personas. Al hacer clic en una zona se abre la
tabla con las personas que están dentro.

Este repo es una **base de referencia para integrar**, no un producto cerrado.
La lógica que importa vive en `src/core` y no depende de React.

```bash
npm install
npm run dev      # http://localhost:5173
```

Arranca con datos de ejemplo generados en el navegador. Para conectar el sistema
real se reemplaza **un componente**: el proveedor que envuelve al visor.
Ver [INTEGRACION.md](INTEGRACION.md).

```tsx
<QueryClientProvider client={queryClient}>
  <SamplePeopleProvider planUrl="/plano.dxf">   {/* ← esto se reemplaza */}
    <PlanOccupancyViewer planUrl="/plano.dxf" />
  </SamplePeopleProvider>
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
- Clic en una zona (en el plano o en la lista lateral) → modal con la tabla de
  personas, filtrable. La tabla es reemplazable por la suya.
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
    occupancy/
      types.ts              Person, PeopleSource — EL CONTRATO con su sistema
      aggregate.ts          personas[] → conteo por capa + "otras zonas"
      zone-names.ts         id de zona → descripción / nombre / id
    render/
      viewport.ts           Matemática de pan/zoom (world ↔ screen)
      theme.ts              Todos los colores
      plan-renderer.ts      Renderer Canvas 2D + hit-testing
  data/                     ← React Query. La capa que se reemplaza al integrar.
    query-keys.ts           Claves centralizadas (permiten compartir caché)
    use-plan-query.ts       Descarga + parseo del DXF, una vez por URL
    people-context.tsx      PeopleProvider genérico + hook usePeople()
    sample-people-provider.tsx  ← ANDAMIO: envuelve al visor con datos falsos
    mock-people-source.ts   Generador de datos de ejemplo (borrable)
    source.ts               URL del plano e intervalo de refresco
  ui/                       ← React. Reemplazable por completo.
    PlanOccupancyViewer.tsx ← EL COMPONENTE que montan en su app
    PlanCanvas.tsx          Canvas + insignias HTML + panel de cámara
    Sidebar.tsx             Resumen, "otras zonas", lista de zonas
    PeopleDialog.tsx        Modal (<dialog> nativo)
    PeopleTable.tsx         Tabla por defecto + el contrato para reemplazarla
    person-columns.ts       Columnas de la tabla (agregar campos acá)
    use-fullscreen.ts       Pantalla completa sobre la raíz del componente
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
  que alejado se amontonan. Gana la zona con más gente; el resto aparece al
  acercar.
- **Una capa puede tener anillos en niveles distintos.** En `plano.dxf`, las
  capas `15-212` y `186` tienen anillos separados ~2.700 unidades en Y, o sea en
  dos niveles distintos de la mina. Por eso la cámara enfoca el anillo más
  grande (`zoneLayer.focusBounds`) y no la unión de todos: encuadrar la unión
  aleja tanto que no se ve nada. La insignia también se ancla ahí; el conteo es
  de la capa completa.

## Cómo cambiar el plano

Reemplazar `public/plano.dxf`, o cambiar `PLAN_URL` en `src/data/source.ts`.
No hay nada específico de este plano en el código.

## Scripts

| Comando             | Qué hace                        |
| ------------------- | ------------------------------- |
| `npm run dev`       | Servidor de desarrollo          |
| `npm run build`     | Typecheck + build de producción |
| `npm run typecheck` | Solo `tsc --noEmit`             |
| `npm run preview`   | Sirve el build                  |

## Dependencias

`react`, `react-dom`, `dxf-parser`, `@tanstack/react-query`. Tailwind CSS solo
para los estilos de la carpeta `ui`. Nada más — a propósito.

La tipografía (IBM Plex Sans/Mono) entra por un `<link>` a Google Fonts en
`index.html`: una línea, bórrenla si usan otra familia. Todos los colores y
fuentes son tokens en `src/index.css`.
