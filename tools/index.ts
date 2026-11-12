import type { McpServer } from "@modelcontextprotocol/server";
import { registerSearchItems } from "./search-items";
import { registerGetLayerInfo } from "./get-layer-info";
import { registerQueryLayer } from "./query-layer";
import { registerGeocode } from "./geocode";
import { registerReverseGeocode } from "./reverse-geocode";
import { registerGetRoute } from "./get-route";

export function registerTools(server: McpServer) {
  registerSearchItems(server);
  registerGetLayerInfo(server);
  registerQueryLayer(server);
  registerGeocode(server);
  registerReverseGeocode(server);
  registerGetRoute(server);
}
