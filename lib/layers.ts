import { getLayer } from "@esri/arcgis-rest-feature-service";
import { getAuth, normalizeLayerUrl } from "./arcgis";

type LayerDefinition = Awaited<ReturnType<typeof getLayer>>;

const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 200;
const cache = new Map<string, { at: number; def: LayerDefinition }>();

/** Fetch (and briefly cache) a layer definition; used for field validation. */
export async function getLayerDefinition(url: string): Promise<LayerDefinition> {
  const layerUrl = normalizeLayerUrl(url);
  const hit = cache.get(layerUrl);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.def;
  const def = await getLayer({ url: layerUrl, authentication: getAuth() });
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(layerUrl, { at: Date.now(), def });
  return def;
}

export function fieldNames(def: LayerDefinition): string[] {
  return (def.fields ?? []).map((f) => f.name);
}

