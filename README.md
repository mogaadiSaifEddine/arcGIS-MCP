# ArcGIS MCP Server (Next.js)

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI clients such as Claude search and query **ArcGIS Online / ArcGIS Enterprise** through the ArcGIS REST API. It's built on Next.js (App Router), [`mcp-handler`](https://www.npmjs.com/package/mcp-handler) 2.x, and [ArcGIS REST JS](https://developers.arcgis.com/arcgis-rest-js/).

All tools are read-only. ArcGIS Pro is out of scope.

## Tools

| Tool | Purpose | Needs API key |
|---|---|---|
| `search_items` | Find maps, layers, and apps in the portal | Only for private items |
| `get_layer_info` | Fields (with domains), geometry type, extent, and capabilities of a layer | Only for private layers |
| `query_layer` | Query by where clause, fields, or bbox. Also supports `countOnly`, and `statistics` + `groupBy`. Capped at 200 records, with paging | Only for private layers |
| `geocode` | Address or place → WGS84 coordinates | Yes |
| `reverse_geocode` | Coordinates → nearest address | Yes |
| `get_route` | Driving directions between 2–25 stops | Yes |

How outputs are shaped for an AI client:
- Each response starts with a one-line summary, followed by trimmed JSON. Empty values are dropped, long strings and HTML descriptions are shortened, and the total output is capped.
- Geometry is returned only when asked for, as GeoJSON in WGS84 with coordinates rounded to 6 decimal places.
- Errors say what to do next. `query_layer` checks field names against the layer before it queries. If ArcGIS rejects a where clause, the error lists the valid fields.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in values
npm run dev                  # MCP endpoint: http://localhost:3000/api/mcp
```

Environment variables:

| Variable | Description |
|---|---|
| `ARCGIS_API_KEY` | ArcGIS API key, kept server-side. Scope it to only the services you need: portal, feature services, geocoding, routing. |
| `ARCGIS_PORTAL_URL` | Optional. An Enterprise portal, e.g. `https://gis.example.com/portal/sharing/rest`. Defaults to ArcGIS Online. |
| `MCP_AUTH_TOKEN` | Bearer token that clients must send. **Required in production.** Generate one with `openssl rand -hex 32`. |
| `RATE_LIMIT_PER_MINUTE` | Requests per minute per client, default 60. This is an in-memory limit per instance. |

> The endpoint is `/api/mcp`. `mcp-handler` 2.x no longer uses the `[transport]` route. It serves the 2026-07-28 MCP spec and the 2025-era stateless Streamable HTTP from the same handler.

## Testing

```bash
npm test          # unit tests (geometry conversion, error hints, auth, rate limiting)
npm run typecheck
npx @modelcontextprotocol/inspector   # Transport: Streamable HTTP, URL: http://localhost:3000/api/mcp,
                                      # header Authorization: Bearer <MCP_AUTH_TOKEN>
```

A public layer you can try without a key:
`https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Counties_Generalized_Boundaries/FeatureServer/0`

Example prompts:
- *"How many counties in Texas?"*
- *"Total population by state for Ohio and Texas."*
- *"How many parcels in <layer> are zoned commercial?"*

## Connecting a client

Claude Desktop, or another stdio-only client, via `mcp-remote`:

```json
{
  "mcpServers": {
    "arcgis": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-app>.vercel.app/api/mcp",
               "--header", "Authorization: Bearer ${MCP_AUTH_TOKEN}"],
      "env": { "MCP_AUTH_TOKEN": "<token>" }
    }
  }
}
```

Clients that support Streamable HTTP can connect directly to the URL, sending the `Authorization` header.

## Deployment (Vercel)

1. Import the repo into Vercel.
2. Set `ARCGIS_API_KEY` and `MCP_AUTH_TOKEN` (and optionally `ARCGIS_PORTAL_URL`) under Project → Settings → Environment Variables.
3. The function timeout is set to 60 s in `vercel.json` and `app/api/mcp/route.ts`, for routing and large queries. Raise it if your plan allows.

## Project structure

```
app/api/mcp/route.ts   MCP entry point: bearer auth, rate limit, createMcpHandler
lib/arcgis.ts          API key auth (server-side only), portal URL, layer URL validation
lib/layers.ts          Cached layer definitions
lib/fields.ts          Case-insensitive field-name resolution
lib/format.ts          Output trimming, Esri JSON → GeoJSON, actionable errors
lib/security.ts        Constant-time bearer check, in-memory rate limiter
tools/*.ts             One file per MCP tool
test/*.test.ts         Unit tests (node:test)
```

## Roadmap

- Write tools (add, update, delete features) behind a feature flag, with confirmation
- Per-user OAuth for private content (`withMcpAuth` + protected resource metadata from `mcp-handler`)
- Spatial analysis (buffer, intersect, summarize within)
- A shared cache and rate-limit store (e.g. Redis/Upstash)
