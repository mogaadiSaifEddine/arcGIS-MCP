import { z } from "zod";
import { queryFeatures } from "@esri/arcgis-rest-feature-service";
import { getAuth, normalizeLayerUrl } from "@/lib/arcgis";
import { esriToGeoJSON, explainError, fail, ok, trimAttributes } from "@/lib/format";
import { fieldNames, getLayerDefinition } from "@/lib/layers";
import { resolveFields } from "@/lib/fields";
import { READ_ONLY, type RegisterTool } from "./types";

export const MAX_RECORDS = 200;

const statisticSchema = z.object({
  type: z.enum(["count", "sum", "min", "max", "avg", "stddev", "var"]),
  field: z.string().describe("Field to aggregate. For count, any non-null field (e.g. the objectId field)."),
  as: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional().describe("Output name."),
});

export const registerQueryLayer: RegisterTool = (server) => {
  server.registerTool(
    "query_layer",
    {
      title: "Query layer",
      description: [
        "Query features from a feature layer with a SQL where clause, a field list, and/or a bounding box.",
        "Use countOnly=true to answer 'how many' questions cheaply.",
        "Use statistics (+ groupBy) for sums/averages/counts per category instead of fetching records.",
        `Records are capped at ${MAX_RECORDS} per call; page with offset.`,
        "Set returnGeometry=true only when shapes/locations matter; geometry is returned as GeoJSON (WGS84).",
        "Call get_layer_info first to learn valid field names.",
      ].join(" "),
      inputSchema: z.object({
        url: z.string().describe("Layer URL ending in /FeatureServer/<id> or /MapServer/<id>."),
        where: z
          .string()
          .default("1=1")
          .describe("SQL where clause, e.g. ZONING = 'C-1' AND ACRES > 2. Strings use single quotes."),
        outFields: z
          .array(z.string())
          .optional()
          .describe("Fields to return. Omit for all fields (avoid on wide layers)."),
        bbox: z
          .tuple([z.number(), z.number(), z.number(), z.number()])
          .optional()
          .describe("Bounding box in WGS84 longitude/latitude: [xmin, ymin, xmax, ymax]."),
        orderBy: z
          .string()
          .optional()
          .describe('One field plus optional ASC/DESC, e.g. "ACRES DESC". With statistics, may use an output name (default "<type>_<field>", e.g. "sum_POPULATION").'),
        limit: z.number().int().min(1).max(MAX_RECORDS).default(25),
        offset: z.number().int().min(0).default(0),
        returnGeometry: z.boolean().default(false),
        countOnly: z.boolean().default(false),
        statistics: z.array(statisticSchema).max(10).optional(),
        groupBy: z.array(z.string()).max(5).optional().describe("Fields to group statistics by."),
      }),
      annotations: READ_ONLY,
    },
    async (args) => {
      let valid: string[] = [];
      try {
        const url = normalizeLayerUrl(args.url);
        const def = await getLayerDefinition(url);
        valid = fieldNames(def);

        // Validate field names up front so the model gets a precise correction.
        const check = (label: string, names: string[] | undefined) => {
          if (!names?.length) return names;
          const { resolved, unknown } = resolveFields(names, valid);
          if (unknown.length) {
            throw new FieldError(
              `${label}: field(s) ${unknown.map((u) => `"${u}"`).join(", ")} don't exist on layer "${def.name}". Valid fields are: ${valid.join(", ")}.`,
            );
          }
          return resolved;
        };
        const outFields = check("outFields", args.outFields);
        const groupBy = check("groupBy", args.groupBy);
        const usedNames = new Set<string>();
        const statistics = args.statistics?.map((s) => {
          const field = check("statistics", [s.field])![0];
          let name = s.as ?? `${s.type}_${field}`.replace(/\W/g, "_").slice(0, 30);
          for (let n = 2; usedNames.has(name.toLowerCase()); n++) name = `${name}_${n}`;
          usedNames.add(name.toLowerCase());
          return { statisticType: s.type, onStatisticField: field, outStatisticFieldName: name };
        });
        // orderBy may reference layer fields or statistic output names.
        const orderByField = args.orderBy?.trim().split(/\s+/)[0];
        if (orderByField && !usedNames.has(orderByField.toLowerCase())) check("orderBy", [orderByField]);

        const common = {
          url,
          where: args.where || "1=1",
          authentication: getAuth(),
          ...(args.bbox
            ? {
                geometry: {
                  xmin: args.bbox[0],
                  ymin: args.bbox[1],
                  xmax: args.bbox[2],
                  ymax: args.bbox[3],
                  spatialReference: { wkid: 4326 },
                },
                geometryType: "esriGeometryEnvelope" as const,
                inSR: "4326",
                spatialRel: "esriSpatialRelIntersects" as const,
              }
            : {}),
        };

        if (args.countOnly && !statistics?.length) {
          const res = (await queryFeatures({ ...common, returnCountOnly: true })) as { count: number };
          return ok(`${res.count} feature(s) in "${def.name}" match where: ${common.where}${args.bbox ? " within the bbox" : ""}.`, {
            count: res.count,
          });
        }

        if (statistics?.length) {
          const res = (await queryFeatures({
            ...common,
            outStatistics: statistics,
            ...(groupBy?.length ? { groupByFieldsForStatistics: groupBy.join(",") } : {}),
            ...(args.orderBy ? { orderByFields: args.orderBy } : {}),
          })) as { features: Array<{ attributes: Record<string, unknown> }> };
          const rows = res.features.slice(0, MAX_RECORDS).map((f) => f.attributes);
          return ok(
            `Statistics for "${def.name}" (${rows.length} row(s)${groupBy?.length ? `, grouped by ${groupBy.join(", ")}` : ""}).`,
            rows,
          );
        }

        const res = (await queryFeatures({
          ...common,
          outFields: outFields?.length ? outFields : "*",
          returnGeometry: args.returnGeometry,
          ...(args.returnGeometry ? { outSR: "4326", geometryPrecision: 6 } : {}),
          ...(args.orderBy ? { orderByFields: args.orderBy } : {}),
          resultOffset: args.offset,
          resultRecordCount: args.limit,
        })) as {
          features: Array<{ attributes: Record<string, unknown>; geometry?: object }>;
          exceededTransferLimit?: boolean;
        };

        const features = res.features.slice(0, args.limit);
        const more =
          res.exceededTransferLimit || features.length === args.limit
            ? ` More may exist: call again with offset=${args.offset + features.length}, or use countOnly=true for a total.`
            : "";
        const summary = `Returned ${features.length} feature(s) from "${def.name}".${more}`;

        if (args.returnGeometry) {
          return ok(summary, {
            type: "FeatureCollection",
            features: features.map((f) => ({
              type: "Feature",
              properties: trimAttributes(f.attributes),
              geometry: esriToGeoJSON(f.geometry as Parameters<typeof esriToGeoJSON>[0]),
            })),
          });
        }
        return ok(summary, features.map((f) => trimAttributes(f.attributes)));
      } catch (err) {
        if (err instanceof FieldError) return fail(err.message);
        return fail(explainError(err, { validFields: valid }));
      }
    },
  );
};

class FieldError extends Error {}
