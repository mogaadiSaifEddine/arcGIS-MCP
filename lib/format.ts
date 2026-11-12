/**
 * Helpers that keep tool output small, predictable, and useful to an LLM:
 * a one-line summary, trimmed JSON, GeoJSON when geometry matters, and
 * errors rewritten into actionable messages.
 */

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/** Hard ceiling on the text returned by a single tool call. */
export const MAX_OUTPUT_CHARS = 60_000;
const MAX_STRING_CHARS = 500;

export function ok(summary: string, data?: unknown): ToolResult {
  let text = summary;
  if (data !== undefined) {
    const json = JSON.stringify(data, null, 2);
    text += "\n\n" + json;
    if (text.length > MAX_OUTPUT_CHARS) {
      text =
        text.slice(0, MAX_OUTPUT_CHARS) +
        "\n\n[Output truncated. Request fewer records, fewer fields, or set returnGeometry=false.]";
    }
  }
  return { content: [{ type: "text", text }] };
}

export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Truncate long strings and drop null/empty values from an attribute map. */
export function trimAttributes(
  attrs: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!attrs) return out;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] =
      typeof v === "string" && v.length > MAX_STRING_CHARS
        ? v.slice(0, MAX_STRING_CHARS) + "…"
        : v;
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
const decodeEntities = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, e) => ENTITIES[e]);

/** Strip HTML (portal descriptions are often HTML, sometimes double-encoded) and shorten. */
export function truncate(s: string | undefined | null, max = 300): string | undefined {
  if (!s) return undefined;
  const plain = decodeEntities(decodeEntities(s)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return undefined;
  return plain.length > max ? plain.slice(0, max) + "…" : plain;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

type ArcGISLikeError = {
  name?: string;
  message?: string;
  originalMessage?: string;
  code?: string | number;
  response?: { error?: { details?: string[]; message?: string; code?: number } };
};

/**
 * Turn an ArcGIS REST error into a message that tells the model what to do
 * next. `validFields` is appended when the error looks field-related.
 */
export function explainError(err: unknown, opts: { validFields?: string[] } = {}): string {
  const e = (err ?? {}) as ArcGISLikeError;
  const details = e.response?.error?.details?.filter(Boolean) ?? [];
  const raw = [e.originalMessage || e.message || String(err), ...details].join(" ");
  const lower = raw.toLowerCase();
  const code = String(e.code ?? e.response?.error?.code ?? "");

  const hints: string[] = [];

  if (code === "498" || code === "499" || /invalid token|token required/.test(lower)) {
    hints.push(
      "The ArcGIS API key was rejected or is missing a required privilege. Check that ARCGIS_API_KEY is valid and scoped for this service.",
    );
  } else if (code === "403" || /permission|not authorized|do not have permissions/.test(lower)) {
    hints.push(
      "Access denied. The item or layer is not shared with this API key (it may be private to its owner or organization).",
    );
  } else if (/invalid field|field .* not found|unknown field|invalid column/.test(lower)) {
    hints.push("A field name in the request does not exist on this layer.");
  } else if (/where clause|invalid sql|unable to complete operation|unable to perform query/.test(lower)) {
    hints.push(
      "The query was rejected. Check the where clause syntax (standard SQL: strings in single quotes, e.g. ZONING = 'C-1'), and that every field it uses exists. Call get_layer_info for the field list and types.",
    );
  } else if (code === "404" || /not found|does not exist|invalid url/.test(lower)) {
    hints.push("The item or service was not found. Verify the ID or URL, e.g. via search_items.");
  } else if (/timeout|timed out|aborted/.test(lower)) {
    hints.push("The request timed out. Narrow the query (where clause, bounding box, fewer records).");
  } else if (/fetch failed|enotfound|econnrefused|network/.test(lower)) {
    hints.push("Could not reach the ArcGIS service. Check the URL and that the server is online.");
  }

  if (opts.validFields?.length && /field|where|sql|query|column/.test(lower)) {
    hints.push(`Valid fields: ${opts.validFields.join(", ")}.`);
  }

  const fromArcGIS = e.name === "ArcGISRequestError" || e.name === "ArcGISAuthError" || code !== "";
  return [fromArcGIS ? `ArcGIS error${code ? ` (${code})` : ""}: ${raw}` : raw, ...hints].join("\n");
}

// ---------------------------------------------------------------------------
// Esri JSON geometry -> GeoJSON
// ---------------------------------------------------------------------------

type Position = number[];
type EsriGeometry = {
  x?: number;
  y?: number;
  z?: number;
  points?: Position[];
  paths?: Position[][];
  rings?: Position[][];
};

export type GeoJSONGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "MultiPoint"; coordinates: Position[] }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

/** Round coordinates to keep payloads small (6 dp ≈ 0.1 m in WGS84). */
const r = (p: Position, dp = 6): Position => p.map((n) => Math.round(n * 10 ** dp) / 10 ** dp);

/** Signed ring area: positive for clockwise rings (Esri outer rings). */
function ringArea(ring: Position[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[i][0] - ring[j][0]) * (ring[i][1] + ring[j][1]);
  }
  return a / 2;
}

export function esriToGeoJSON(g: EsriGeometry | null | undefined): GeoJSONGeometry | null {
  if (!g) return null;
  if (typeof g.x === "number" && typeof g.y === "number") {
    return { type: "Point", coordinates: r(g.z !== undefined ? [g.x, g.y, g.z] : [g.x, g.y]) };
  }
  if (g.points) {
    return { type: "MultiPoint", coordinates: g.points.map((p) => r(p)) };
  }
  if (g.paths) {
    const lines = g.paths.map((path) => path.map((p) => r(p)));
    return lines.length === 1
      ? { type: "LineString", coordinates: lines[0] }
      : { type: "MultiLineString", coordinates: lines };
  }
  if (g.rings) {
    // Esri: outer rings clockwise, holes counter-clockwise. GeoJSON (RFC 7946)
    // wants outer CCW, holes CW, so each ring is reversed.
    const polygons: Position[][][] = [];
    for (const ring of g.rings) {
      const coords = ring.map((p) => r(p)).reverse();
      // ringArea > 0 means clockwise in the original orientation => outer ring.
      if (ringArea(ring) > 0 || polygons.length === 0) polygons.push([coords]);
      else polygons[polygons.length - 1].push(coords);
    }
    return polygons.length === 1
      ? { type: "Polygon", coordinates: polygons[0] }
      : { type: "MultiPolygon", coordinates: polygons };
  }
  return null;
}
