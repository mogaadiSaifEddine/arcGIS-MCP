import { z } from "zod";
import { explainError, fail, ok, truncate } from "@/lib/format";
import { getLayerDefinition } from "@/lib/layers";
import { READ_ONLY, type RegisterTool } from "./types";

export const registerGetLayerInfo: RegisterTool = (server) => {
  server.registerTool(
    "get_layer_info",
    {
      title: "Get layer info",
      description:
        "Describe a feature layer: its fields (name, type, alias, coded-value domains), geometry type, spatial reference, record limits and capabilities. Call this before query_layer so you use valid field names.",
      inputSchema: z.object({
        url: z
          .string()
          .describe("Layer URL ending in /FeatureServer/<id> or /MapServer/<id>."),
      }),
      annotations: READ_ONLY,
    },
    async ({ url }) => {
      try {
        const def = await getLayerDefinition(url);
        const fields = (def.fields ?? []).map((f) => {
          const domain = f.domain as
            | { type?: string; codedValues?: Array<{ name: string; code: unknown }>; range?: number[] }
            | undefined;
          return {
            name: f.name,
            type: String(f.type).replace(/^esriFieldType/, ""),
            alias: f.alias && f.alias !== f.name ? f.alias : undefined,
            values:
              domain?.codedValues?.slice(0, 50).map((c) => `${c.code}=${c.name}`) ?? undefined,
            range: domain?.range,
          };
        });
        const d = def as typeof def & {
          maxRecordCount?: number;
          supportsStatistics?: boolean;
          advancedQueryCapabilities?: { supportsStatistics?: boolean; supportsOrderBy?: boolean };
        };
        const info = {
          name: def.name,
          type: def.type,
          description: truncate(def.description, 400),
          geometryType: def.geometryType?.replace(/^esriGeometry/, ""),
          spatialReference: def.extent?.spatialReference,
          extent: def.extent,
          objectIdField: def.objectIdField,
          displayField: def.displayField,
          maxRecordCount: d.maxRecordCount,
          capabilities: def.capabilities,
          supportsStatistics:
            d.advancedQueryCapabilities?.supportsStatistics ?? d.supportsStatistics,
          supportsOrderBy: d.advancedQueryCapabilities?.supportsOrderBy,
          fields,
        };
        return ok(
          `Layer "${def.name}" (${info.geometryType ?? "table"}) with ${fields.length} field(s).`,
          info,
        );
      } catch (err) {
        return fail(explainError(err));
      }
    },
  );
};
