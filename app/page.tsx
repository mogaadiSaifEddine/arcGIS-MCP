export default function Home() {
  return (
    <main>
      <h1>ArcGIS MCP Server</h1>
      <p>
        MCP endpoint: <code>/api/mcp</code> (Streamable HTTP, bearer token required).
      </p>
      <p>
        Tools: search_items, get_layer_info, query_layer, geocode, reverse_geocode, get_route.
      </p>
    </main>
  );
}
