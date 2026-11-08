/**
 * Leak detection shared by policy, API and MCP tests: serialize what a viewer received and
 * report every forbidden marker that appears anywhere in it.
 */
export function findLeaks(output: unknown, forbidden: Iterable<string>): string[] {
  const text = JSON.stringify(output) ?? "";
  return [...new Set(forbidden)].filter((m) => m.length > 0 && text.includes(m));
}
