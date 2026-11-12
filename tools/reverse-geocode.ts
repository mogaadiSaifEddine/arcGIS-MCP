import { z } from "zod";
import { reverseGeocode } from "@esri/arcgis-rest-geocoding";
import { requireAuth } from "@/lib/arcgis";
import { explainError, fail, ok, trimAttributes } from "@/lib/format";
import { READ_ONLY, type RegisterTool } from "./types";

export const registerReverseGeocode: RegisterTool = (server) => {
  server.registerTool(
    "reverse_geocode",
    {
      title: "Reverse geocode",
      description: "Convert a WGS84 longitude/latitude into the nearest address or place.",
      inputSchema: z.object({
        longitude: z.number().min(-180).max(180),
        latitude: z.number().min(-90).max(90),
      }),
      annotations: READ_ONLY,
    },
    async ({ longitude, latitude }) => {
      try {
        const res = await reverseGeocode([longitude, latitude], { authentication: requireAuth() });
        const a = trimAttributes(res.address);
        const label = (a.LongLabel || a.Match_addr || a.Address || "unknown address") as string;
        const keep = ["Match_addr", "LongLabel", "PlaceName", "AddNum", "Address", "Neighborhood", "City", "Subregion", "Region", "Postal", "CountryCode", "Addr_type", "Type"];
        return ok(
          `(${longitude}, ${latitude}) is near: ${label}.`,
          Object.fromEntries(keep.filter((k) => a[k] !== undefined).map((k) => [k, a[k]])),
        );
      } catch (err) {
        return fail(explainError(err));
      }
    },
  );
};
