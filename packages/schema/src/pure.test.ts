import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * "@elochair/schema/pure" is for the browser bundle: nothing it reaches may import Zod at
 * runtime. Type-only imports are erased at build time and are allowed.
 */
describe("the pure entry point", () => {
  it("never imports zod at runtime, directly or transitively", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const seen = new Set<string>();
    const offenders: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(join(dir, file), "utf8");
      for (const m of src.matchAll(/^(import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gms)) {
        const [, , typeOnly, spec] = m;
        if (typeOnly || !spec) continue;
        if (spec === "zod") offenders.push(file);
        else if (spec.startsWith("./")) visit(`${spec.slice(2)}.ts`);
      }
    };
    visit("pure.ts");
    expect(offenders).toEqual([]);
    expect(seen.size).toBeGreaterThan(5);
  });
});
