import { test } from "node:test";
import assert from "node:assert/strict";
import { esriToGeoJSON, explainError, ok, trimAttributes, MAX_OUTPUT_CHARS } from "../lib/format.ts";

test("point and polyline conversion", () => {
  assert.deepEqual(esriToGeoJSON({ x: 1.123456789, y: 2 }), { type: "Point", coordinates: [1.123457, 2] });
  assert.equal(esriToGeoJSON({ paths: [[[0, 0], [1, 1]]] })?.type, "LineString");
  assert.equal(esriToGeoJSON({ paths: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] })?.type, "MultiLineString");
});

test("polygon: clockwise outer + ccw hole become one Polygon with CCW outer", () => {
  const outer = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]; // clockwise
  const hole = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]; // counter-clockwise
  const g = esriToGeoJSON({ rings: [outer, hole] });
  assert.equal(g?.type, "Polygon");
  const coords = (g as { coordinates: number[][][] }).coordinates;
  assert.equal(coords.length, 2);
  assert.deepEqual(coords[0], [...outer].reverse());
});

test("polygon: two clockwise rings become a MultiPolygon", () => {
  const a = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
  const b = [[5, 5], [5, 6], [6, 6], [6, 5], [5, 5]];
  assert.equal(esriToGeoJSON({ rings: [a, b] })?.type, "MultiPolygon");
});

test("trimAttributes drops empties and truncates long strings", () => {
  const out = trimAttributes({ a: null, b: "", c: 0, d: "x".repeat(1000) });
  assert.deepEqual(Object.keys(out), ["c", "d"]);
  assert.ok((out.d as string).length < 600);
});

test("ok() caps output size", () => {
  const r = ok("s", { big: "y".repeat(MAX_OUTPUT_CHARS * 2) });
  assert.ok(r.content[0].text.length < MAX_OUTPUT_CHARS + 200);
  assert.match(r.content[0].text, /truncated/);
});

test("explainError adds field hints", () => {
  const msg = explainError(
    { originalMessage: "Invalid field: FOO", code: 400 },
    { validFields: ["OBJECTID", "ZONING"] },
  );
  assert.match(msg, /does not exist/);
  assert.match(msg, /OBJECTID, ZONING/);
  assert.match(explainError({ code: 498, message: "Invalid token." }), /API key/);
});

test("truncate strips double-encoded HTML", async () => {
  const { truncate } = await import("../lib/format.ts");
  assert.equal(truncate("&lt;span style=&quot;x&quot;&gt;Hello&amp;nbsp;world&lt;/span&gt;"), "Hello world");
  assert.equal(truncate("<p></p>"), undefined);
});
