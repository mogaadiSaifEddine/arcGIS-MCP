/** Match requested field names case-insensitively; report unknown ones. */
export function resolveFields(requested: string[], valid: string[]) {
  const byLower = new Map(valid.map((f) => [f.toLowerCase(), f]));
  const resolved: string[] = [];
  const unknown: string[] = [];
  for (const name of requested) {
    const hit = byLower.get(name.trim().toLowerCase());
    if (hit) resolved.push(hit);
    else unknown.push(name);
  }
  return { resolved, unknown };
}
