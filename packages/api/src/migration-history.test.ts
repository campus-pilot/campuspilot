import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";
/** Parallel worktrees must reconcile ordered migrations and their snapshots,
 * rather than creating duplicate ordinals that only fail on the next generation.
 */
describe("committed migration history", () => {
  it("has consecutive ordinals, unique tags, and one connected snapshot chain", () => {
    const folder = resolve(cwd(), "../db/src/migrations");
    const journal = JSON.parse(
      readFileSync(resolve(folder, "meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string; when: number }[] };
    expect(new Set(journal.entries.map((entry) => entry.tag)).size).toBe(
      journal.entries.length,
    );
    let previousId: string | undefined;
    for (const [index, entry] of journal.entries.entries()) {
      expect(entry.idx).toBe(index);
      expect(entry.tag.startsWith(`${String(index).padStart(4, "0")}_`)).toBe(
        true,
      );
      expect(
        readFileSync(resolve(folder, `${entry.tag}.sql`), "utf8").trim(),
      ).not.toBe("");
      const snapshot = JSON.parse(
        readFileSync(
          resolve(
            folder,
            `meta/${String(index).padStart(4, "0")}_snapshot.json`,
          ),
          "utf8",
        ),
      ) as { id: string; prevId: string };
      if (previousId) expect(snapshot.prevId).toBe(previousId);
      previousId = snapshot.id;
      if (index)
        expect(entry.when).toBeGreaterThan(journal.entries[index - 1]!.when);
    }
  });
});
