/**
 * Normalized DXF model.
 *
 * The whole point of this module is that NOTHING downstream ever touches a raw
 * dxf-parser entity. We collapse the ~15 DXF entity types we care about into 3
 * primitives (path / circle / text). A renderer only has to handle 3 cases, and
 * swapping `dxf-parser` for another parser only means rewriting `parse-dxf.ts`.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type TextAnchor = "left" | "center" | "right";

/** A polyline. Curves (arcs, bulges, ellipses, splines) arrive here pre-flattened. */
export interface PathPrimitive {
  kind: "path";
  layer: string;
  points: Vec2[];
  closed: boolean;
}

/** Kept as a primitive instead of flattened so small circles stay round at any zoom. */
export interface CirclePrimitive {
  kind: "circle";
  layer: string;
  center: Vec2;
  radius: number;
}

export interface TextPrimitive {
  kind: "text";
  layer: string;
  /** Baseline origin, in world units. */
  at: Vec2;
  text: string;
  /** Cap height in world units. */
  height: number;
  /** Counter-clockwise, degrees, as DXF stores it. */
  rotationDeg: number;
  anchor: TextAnchor;
}

export type Primitive = PathPrimitive | CirclePrimitive | TextPrimitive;

/**
 * A closed ring belonging to a zone layer.
 *
 * One layer can own several rings (in the sample plan, layer "15-212" owns 4).
 * Rings are always closed here even when the DXF stored them open.
 */
export interface ZoneRing {
  layer: string;
  points: Vec2[];
  bounds: Bounds;
  /** Signed area x 2, used for centroid math and to drop degenerate rings. */
  area: number;
}

/**
 * One DXF layer that maps to one or more zone IDs.
 *
 * Layer "85"    -> zoneIds ["85"]
 * Layer "81-82" -> zoneIds ["81", "82"]  (the drawn shape covers both zones)
 */
export interface ZoneLayer {
  layer: string;
  zoneIds: string[];
  rings: ZoneRing[];
  /** Centroid of the largest ring — where the count badge is anchored. */
  labelPoint: Vec2;
  /** Union of every ring. Use for culling. */
  bounds: Bounds;
  /**
   * Bounds of the largest ring alone — the one the badge sits on. Use this to
   * frame the camera: a layer can own rings on different levels of the plan
   * (in the sample plan "15-212" and "186" both do, ~2700 units apart), and
   * framing their union zooms out far enough to show nothing useful.
   */
  focusBounds: Bounds;
}

export interface DxfDocument {
  /** Everything on the base layer, ready to draw as the plan background. */
  base: Primitive[];
  /** Zone layers, in the order they appeared in the file. */
  zoneLayers: ZoneLayer[];
  /** Bounds of every primitive, including far-flung outliers. */
  bounds: Bounds;
  /** Outlier-trimmed bounds. Use this one to auto-fit the camera. */
  fitBounds: Bounds;
  /** Layer names that were neither the base layer nor a valid zone layer. */
  ignoredLayers: string[];
}
