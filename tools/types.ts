import type { McpServer } from "@modelcontextprotocol/server";

export type RegisterTool = (server: McpServer) => void;

/** Shared annotations for tools that never modify ArcGIS content. */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;
