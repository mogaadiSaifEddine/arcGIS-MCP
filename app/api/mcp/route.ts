import { createMcpHandler } from "mcp-handler";
import { registerTools } from "@/tools";
import { checkBearer, clientKey, createRateLimiter } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const mcp = createMcpHandler(registerTools, {
  serverInfo: { name: "arcgis-mcp", version: "0.1.0" },
  instructions: [
    "Tools for ArcGIS Online / Enterprise (read-only).",
    "Typical flow: search_items to find a Feature Service -> append /0 (or another layer id) to its URL ->",
    "get_layer_info to learn fields -> query_layer (countOnly or statistics for aggregate questions).",
    "geocode/reverse_geocode/get_route use WGS84 longitude/latitude.",
  ].join(" "),
});

const rateLimit = createRateLimiter(Number(process.env.RATE_LIMIT_PER_MINUTE) || 60);

const json = (status: number, body: object, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

async function handler(req: Request): Promise<Response> {
  const auth = checkBearer(req, process.env.MCP_AUTH_TOKEN);
  if (auth === "missing-config" && process.env.NODE_ENV === "production") {
    return json(500, { error: "Server misconfigured: MCP_AUTH_TOKEN is not set." });
  }
  if (auth === "unauthorized") {
    return json(401, { error: "Unauthorized. Send Authorization: Bearer <MCP_AUTH_TOKEN>." }, {
      "WWW-Authenticate": 'Bearer realm="arcgis-mcp"',
    });
  }

  const { allowed, retryAfterSec } = rateLimit(clientKey(req));
  if (!allowed) {
    return json(429, { error: "Rate limit exceeded. Slow down." }, { "Retry-After": String(retryAfterSec) });
  }

  return mcp(req);
}

export { handler as GET, handler as POST, handler as DELETE };
