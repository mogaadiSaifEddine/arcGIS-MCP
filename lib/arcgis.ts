import { ApiKeyManager } from "@esri/arcgis-rest-request";

/** ArcGIS Online by default; override for ArcGIS Enterprise. */
export const PORTAL_URL =
  process.env.ARCGIS_PORTAL_URL?.replace(/\/+$/, "") ||
  "https://www.arcgis.com/sharing/rest";

let manager: ApiKeyManager | undefined;

/**
 * Server-side authentication for ArcGIS calls. The key never leaves the
 * server: it is read from the environment and only attached to outbound
 * requests to ArcGIS. Returns undefined when no key is configured, which is
 * fine for public portal items and public layers.
 */
export function getAuth(): ApiKeyManager | undefined {
  const key = process.env.ARCGIS_API_KEY;
  if (!key) return undefined;
  if (!manager) manager = ApiKeyManager.fromKey({ key, portal: PORTAL_URL });
  return manager;
}

/** Like getAuth, but for services (geocoding, routing) that always need a key. */
export function requireAuth(): ApiKeyManager {
  const auth = getAuth();
  if (!auth) {
    throw new Error(
      "ARCGIS_API_KEY is not configured on the server; geocoding and routing require it. Set it in .env.local (local) or the hosting provider's environment variables.",
    );
  }
  return auth;
}

/**
 * Validates that a layer URL points at a single Feature/Map Server layer,
 * e.g. https://services.arcgis.com/.../FeatureServer/0
 */
export function normalizeLayerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "").replace(/\/query$/i, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`"${url}" is not a valid URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Layer URLs must use https.");
  }
  if (!/\/(FeatureServer|MapServer)\/\d+$/i.test(parsed.pathname)) {
    throw new Error(
      `"${url}" is not a layer URL. Expected something ending in /FeatureServer/<layerId> or /MapServer/<layerId>. Use search_items to find a service, then append the layer index (usually 0).`,
    );
  }
  return trimmed;
}
