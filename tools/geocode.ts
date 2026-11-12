import { z } from "zod";
import { geocode } from "@esri/arcgis-rest-geocoding";
import { requireAuth } from "@/lib/arcgis";
import { explainError, fail, ok } from "@/lib/format";
import { READ_ONLY, type RegisterTool } from "./types";

export const registerGeocode: RegisterTool = (server) => {
  server.registerTool(
    "geocode",
    {
      title: "Geocode address",
      description:
        "Convert an address, place name or point of interest into coordinates (WGS84 longitude/latitude) using the ArcGIS World Geocoding Service. Returns the best candidates with match scores (0-100).",
      inputSchema: z.object({
        address: z.string().min(1).describe('e.g. "380 New York St, Redlands, CA" or "Eiffel Tower".'),
        countryCode: z
          .string()
          .optional()
          .describe("Limit to a country (ISO 3166 alpha-2 or alpha-3, e.g. US, FRA)."),
        limit: z.number().int().min(1).max(10).default(3),
      }),
      annotations: READ_ONLY,
    },
    async ({ address, countryCode, limit }) => {
      try {
        const res = await geocode({
          singleLine: address,
          ...(countryCode ? { countryCode } : {}),
          outFields: ["Match_addr", "Addr_type", "Type", "City", "Region", "Country"],
          params: { maxLocations: limit, outSR: 4326 },
          authentication: requireAuth(),
        });
        const candidates = res.candidates.slice(0, limit).map((c) => {
          const a = c.attributes as Record<string, string>;
          return {
            address: c.address,
            longitude: round(c.location.x),
            latitude: round(c.location.y),
            score: c.score,
            matchType: a.Addr_type || undefined,
            placeType: a.Type || undefined,
            city: a.City || undefined,
            region: a.Region || undefined,
            country: a.Country || undefined,
          };
        });
        if (!candidates.length) {
          return ok(`No matches for "${address}". Try adding a city, region, or country.`);
        }
        const best = candidates[0];
        return ok(
          `Best match: ${best.address} at (${best.longitude}, ${best.latitude}), score ${best.score}.`,
          candidates,
        );
      } catch (err) {
        return fail(explainError(err));
      }
    },
  );
};

const round = (n: number) => Math.round(n * 1e6) / 1e6;
