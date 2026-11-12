import { z } from "zod";
import { solveRoute } from "@esri/arcgis-rest-routing";
import { requireAuth } from "@/lib/arcgis";
import { esriToGeoJSON, explainError, fail, ok } from "@/lib/format";
import { READ_ONLY, type RegisterTool } from "./types";

export const registerGetRoute: RegisterTool = (server) => {
  server.registerTool(
    "get_route",
    {
      title: "Get route",
      description:
        "Driving directions between two or more stops (WGS84 longitude/latitude, in visiting order). Returns total time and distance, turn-by-turn steps, and optionally the route line as GeoJSON. Use geocode first to turn addresses into coordinates.",
      inputSchema: z.object({
        stops: z
          .array(z.object({ longitude: z.number().min(-180).max(180), latitude: z.number().min(-90).max(90) }))
          .min(2)
          .max(25),
        units: z.enum(["km", "miles"]).default("km"),
        returnGeometry: z.boolean().default(false),
        maxSteps: z.number().int().min(0).max(200).default(50),
      }),
      annotations: READ_ONLY,
    },
    async ({ stops, units, returnGeometry, maxSteps }) => {
      try {
        const res = await solveRoute({
          stops: stops.map((s) => [s.longitude, s.latitude] as [number, number]),
          params: {
            directionsLengthUnits: units === "km" ? "esriNAUKilometers" : "esriNAUMiles",
            returnRoutes: true,
            outSR: 4326,
          },
          authentication: requireAuth(),
        });
        const route = res.routes.features[0];
        if (!route) return fail("No route found between these stops.");
        const attrs = route.attributes as Record<string, number>;
        const distance = units === "km" ? attrs.Total_Kilometers : attrs.Total_Miles;
        const minutes = attrs.Total_TravelTime ?? attrs.Total_Minutes;

        const steps = (res.directions?.[0]?.features ?? [])
          .map((f) => {
            const a = f.attributes as { text?: string; length?: number; time?: number };
            return {
              text: a.text,
              distance: a.length !== undefined ? Math.round(a.length * 100) / 100 : undefined,
              minutes: a.time !== undefined ? Math.round(a.time * 10) / 10 : undefined,
            };
          })
          .filter((s) => s.text);

        const data: Record<string, unknown> = {
          totalDistance: distance !== undefined ? Math.round(distance * 100) / 100 : undefined,
          units,
          totalMinutes: minutes !== undefined ? Math.round(minutes * 10) / 10 : undefined,
          steps: steps.slice(0, maxSteps),
        };
        if (steps.length > maxSteps) data.stepsOmitted = steps.length - maxSteps;
        if (returnGeometry) data.geometry = esriToGeoJSON(route.geometry as Parameters<typeof esriToGeoJSON>[0]);

        return ok(
          `Route over ${stops.length} stops: ${data.totalDistance ?? "?"} ${units}, about ${data.totalMinutes ?? "?"} min.`,
          data,
        );
      } catch (err) {
        return fail(explainError(err));
      }
    },
  );
};
