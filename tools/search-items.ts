import { z } from "zod";
import { searchItems } from "@esri/arcgis-rest-portal";
import { getAuth, PORTAL_URL } from "@/lib/arcgis";
import { explainError, fail, ok, truncate } from "@/lib/format";
import { READ_ONLY, type RegisterTool } from "./types";

const ITEM_PAGE = (id: string) =>
  `${PORTAL_URL.replace(/\/sharing\/rest$/, "")}/home/item.html?id=${id}`;

export const registerSearchItems: RegisterTool = (server) => {
  server.registerTool(
    "search_items",
    {
      title: "Search portal items",
      description:
        "Search ArcGIS Online/Enterprise for maps, layers, apps and other items. Returns item IDs, types and service URLs. For a Feature Service, append /<layerId> (usually /0) to the URL before calling get_layer_info or query_layer.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe('Free-text search, e.g. "parcels Austin". Portal search syntax is allowed (e.g. owner:esri, tags:zoning).'),
        type: z
          .string()
          .optional()
          .describe('Restrict to an item type, e.g. "Feature Service", "Web Map", "Map Service", "Web Mapping Application".'),
        limit: z.number().int().min(1).max(50).default(10),
        start: z.number().int().min(1).default(1).describe("1-based offset for paging (use nextStart from a previous call)."),
        sortField: z.enum(["relevance", "title", "modified", "numViews", "avgRating"]).optional(),
      }),
      annotations: READ_ONLY,
    },
    async ({ query, type, limit, start, sortField }) => {
      const q = type ? `(${query}) AND type:"${type.replace(/"/g, "")}"` : query;
      try {
        const res = await searchItems({
          q,
          num: limit,
          start,
          ...(sortField && sortField !== "relevance"
            ? { sortField, sortOrder: sortField === "title" ? "asc" : "desc" }
            : {}),
          portal: PORTAL_URL,
          authentication: getAuth(),
        });
        const items = res.results.map((it) => ({
          id: it.id,
          title: it.title,
          type: it.type,
          owner: it.owner,
          url: it.url || undefined,
          snippet: truncate(it.snippet || it.description, 200),
          tags: it.tags?.slice(0, 8),
          modified: it.modified ? new Date(it.modified).toISOString().slice(0, 10) : undefined,
          access: it.access,
          page: ITEM_PAGE(it.id),
        }));
        const more = res.nextStart > 0 ? ` More available: call again with start=${res.nextStart}.` : "";
        return ok(`Found ${res.total} item(s); showing ${items.length}.${more}`, items);
      } catch (err) {
        return fail(explainError(err));
      }
    },
  );
};
