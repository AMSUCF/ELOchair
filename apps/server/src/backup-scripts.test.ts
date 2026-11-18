/**
 * The backup scripts in deploy/, run for real with sh and bash. They are tested here so that
 * `npm run check` covers the retention policy and the backup's failure paths. The round trip
 * against Postgres, and the policy under dash/mawk and busybox, are in deploy/test/backup-e2e.sh.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RETENTION = fileURLToPath(new URL("../../../deploy/backup-retention.sh", import.meta.url));
const BACKUP = fileURLToPath(new URL("../../../deploy/backup.sh", import.meta.url));
const PATH = process.env.PATH ?? "";

/** Neither script is for Windows; elsewhere a missing shell is a failure, not a skip. */
const posix = process.platform !== "win32";
/** backup.sh locks only where flock is installed (the postgres image has it; macOS does not). */
const hasFlock = posix && spawnSync("flock", ["--version"]).status === 0;

interface Keep {
  hourly: number;
  daily: number;
  weekly: number;
  monthly: number;
}
const DEFAULTS: Keep = { hourly: 48, daily: 14, weekly: 8, monthly: 12 };
const OFF: Keep = { hourly: 0, daily: 0, weekly: 0, monthly: 0 };

const keepEnv = (k: Partial<Record<keyof Keep, number | string>>) => ({
  ...(k.hourly === undefined ? {} : { BACKUP_KEEP_HOURLY: String(k.hourly) }),
  ...(k.daily === undefined ? {} : { BACKUP_KEEP_DAILY: String(k.daily) }),
  ...(k.weekly === undefined ? {} : { BACKUP_KEEP_WEEKLY: String(k.weekly) }),
  ...(k.monthly === undefined ? {} : { BACKUP_KEEP_MONTHLY: String(k.monthly) }),
});

/** Runs the policy script; `names` go in on standard input, one per line. */
function retention(
  mode: string,
  names: string[],
  keep: Partial<Record<keyof Keep, number | string>> = {},
) {
  const r = spawnSync("sh", [RETENTION, mode], {
    input: names.map((n) => `${n}\n`).join(""),
    env: { PATH, ...keepEnv(keep) },
    encoding: "utf8",
  });
  // A script that refuses its settings may exit before it has read every name: not an error here.
  if (r.error && (r.error as NodeJS.ErrnoException).code !== "EPIPE") throw r.error;
  return { status: r.status, out: r.stdout.split("\n").filter(Boolean), err: r.stderr };
}

const name = (iso: string) => `elochair-${iso.replace(/[-:]/g, "")}.dump`;
const at = (seconds: number) => name(`${new Date(seconds * 1000).toISOString().slice(0, 19)}Z`);
const seconds = (iso: string) => Date.parse(iso) / 1000;

// The policy again, written independently and with real calendar dates, to check the script by.
const NAME = /^elochair-(\d{4})(\d{2})(\d{2})T(\d{2})\d{4}Z\.dump$/;
function isoWeek(year: number, month: number, day: number): string {
  // ISO 8601: weeks start on Monday, and a week belongs to the year that holds its Thursday.
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const week = Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${week}`;
}
function expectedToStay(names: string[], k: Keep): string[] {
  const newestFirst = [...new Set(names.filter((n) => NAME.test(n)))].sort().reverse();
  const stay = new Set(newestFirst.slice(0, 1));
  const tiers: [number, (m: RegExpExecArray) => string][] = [
    [k.hourly, (m) => `${m[1]}${m[2]}${m[3]}T${m[4]}`],
    [k.daily, (m) => `${m[1]}${m[2]}${m[3]}`],
    [k.weekly, (m) => isoWeek(Number(m[1]), Number(m[2]), Number(m[3]))],
    [k.monthly, (m) => `${m[1]}${m[2]}`],
  ];
  for (const [limit, periodOf] of tiers) {
    const periods: string[] = [];
    for (const n of newestFirst) {
      const period = periodOf(NAME.exec(n)!);
      if (periods.includes(period)) continue;
      if (periods.length >= limit) break;
      periods.push(period);
      stay.add(n);
    }
  }
  return [...stay].sort().reverse();
}
const bound = (k: Keep) => Math.max(1, k.hourly + k.daily + k.weekly + k.monthly);

/** A small deterministic generator, so the long simulations are the same on every run. */
function random(seed: number) {
  let s = seed;
  return (below: number) => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return Math.floor((s / 2_147_483_648) * below);
  };
}

describe.skipIf(!posix)("deploy/backup-retention.sh: which dumps stay", () => {
  it("keeps the newest dump of each of the latest N hours, days, weeks and months that have one", () => {
    const names = [
      name("2027-03-10T14:20:00Z"), // newest of its hour: hourly 1, daily 1, weekly 1, monthly 1
      name("2027-03-10T14:05:00Z"), // same hour, older: goes
      name("2027-03-10T13:00:00Z"), // hourly 2
      name("2027-03-10T09:00:00Z"), // a third hour: goes
      name("2027-03-09T23:00:00Z"), // daily 2
      name("2027-03-09T08:00:00Z"), // goes
      name("2027-03-07T23:00:00Z"), // Sunday, so the week before: weekly 2
      name("2027-03-01T23:00:00Z"), // Monday of that same week: goes
      name("2027-02-28T23:00:00Z"), // a third week, but monthly 2
      name("2027-02-01T00:00:00Z"), // goes
      name("2027-01-31T23:00:00Z"), // a third month: goes
    ];
    const keep = { hourly: 2, daily: 2, weekly: 2, monthly: 2 };
    const stay = [
      name("2027-03-10T14:20:00Z"),
      name("2027-03-10T13:00:00Z"),
      name("2027-03-09T23:00:00Z"),
      name("2027-03-07T23:00:00Z"),
      name("2027-02-28T23:00:00Z"),
    ];
    expect(retention("keep", names, keep)).toMatchObject({ status: 0, out: stay });
    expect(retention("prune", names, keep).out).toEqual(names.filter((n) => !stay.includes(n)));
    expect(expectedToStay(names, keep)).toEqual(stay);
  });

  it("uses 48 hourly, 14 daily, 8 weekly and 12 monthly unless told otherwise: 82 at most", () => {
    // Three years of hourly dumps, with a burst of manual ones every so often.
    const names: string[] = [];
    for (let t = seconds("2025-01-01T00:00:00Z"); t < seconds("2028-01-01T00:00:00Z"); t += 3600) {
      names.push(at(t));
      if ((t / 3600) % 101 === 0) names.push(at(t + 600), at(t + 1200), at(t + 1800));
    }
    const { status, out } = retention("keep", names);
    expect(status).toBe(0);
    expect(out).toEqual(expectedToStay(names, DEFAULTS));
    expect(out.length).toBeLessThanOrEqual(82);
    expect(out.length).toBeGreaterThan(60);
    expect(retention("prune", names).out).toHaveLength(names.length - out.length);
  });

  it("counts periods that hold a dump, not time on the clock: a gap ages nothing out", () => {
    const names = [
      name("2027-06-20T10:00:00Z"),
      name("2027-06-05T10:00:00Z"),
      name("2027-06-01T10:00:00Z"),
      name("2027-05-31T10:00:00Z"),
    ];
    expect(retention("keep", names, { ...OFF, daily: 3 }).out).toEqual(names.slice(0, 3));
    expect(retention("keep", names, { ...OFF, hourly: 4 }).out).toEqual(names);
  });

  it("with only the hourly tier on, keeps the newest dump of each of the latest N hours", () => {
    const hourly = Array.from({ length: 30 }, (_, i) =>
      at(seconds("2027-03-10T12:00:00Z") - i * 3600),
    );
    // One dump an hour: exactly the latest N dumps.
    expect(retention("keep", hourly, { ...OFF, hourly: 7 }).out).toEqual(hourly.slice(0, 7));
    expect(retention("prune", hourly, { ...OFF, hourly: 7 }).out).toEqual(hourly.slice(7));
    // Extra dumps inside an hour do not take a place each: that hour still counts once.
    const extra = [name("2027-03-10T12:40:00Z"), name("2027-03-10T12:20:00Z"), ...hourly];
    expect(retention("keep", extra, { ...OFF, hourly: 7 }).out).toEqual([
      name("2027-03-10T12:40:00Z"),
      ...hourly.slice(1, 7),
    ]);
  });

  it("turns a tier off at 0, and always keeps the single newest dump", () => {
    const names = Array.from({ length: 90 * 24 }, (_, i) =>
      at(seconds("2027-03-10T12:00:00Z") - i * 3600),
    );
    expect(retention("keep", names, OFF).out).toEqual([names[0]]);
    expect(retention("prune", names, OFF).out).toEqual(names.slice(1));
    for (const tier of ["hourly", "daily", "weekly", "monthly"] as const) {
      const only = { ...OFF, [tier]: 3 };
      const { out } = retention("keep", names, only);
      expect(out).toEqual(expectedToStay(names, only));
      expect(out).toHaveLength(3);
    }
  });

  it("groups by ISO 8601 week, across the turn of the year", () => {
    const names = [
      name("2027-01-04T00:00:00Z"), // Monday: 2027-W01
      name("2027-01-03T23:59:59Z"), // Sunday: still 2026-W53
      name("2027-01-01T00:00:00Z"), // 2026-W53
      name("2026-12-28T00:00:00Z"), // Monday: 2026-W53
      name("2026-12-27T23:59:59Z"), // Sunday: 2026-W52
      name("2025-01-01T00:00:00Z"), // 2025-W01, which began on Monday 2024-12-30
      name("2024-12-30T00:00:00Z"), // 2025-W01
      name("2024-12-29T23:59:59Z"), // Sunday: 2024-W52
    ];
    const weekly = { ...OFF, weekly: 5 };
    expect(retention("keep", names, weekly).out).toEqual([
      name("2027-01-04T00:00:00Z"),
      name("2027-01-03T23:59:59Z"),
      name("2026-12-27T23:59:59Z"),
      name("2025-01-01T00:00:00Z"),
      name("2024-12-29T23:59:59Z"),
    ]);
    expect(expectedToStay(names, weekly)).toEqual(retention("keep", names, weekly).out);
  });

  it("agrees with the policy written out independently, and never keeps more than the sum of the tiers", () => {
    const setting = fc.integer({ min: 0, max: 6 });
    const moment = fc
      .record({
        base: fc.constantFrom("2024-12-20", "2026-12-20", "2027-02-20", "2028-02-20", "2027-06-01"),
        day: fc.integer({ min: 0, max: 100 }),
        hour: fc.constantFrom(0, 1, 11, 23),
        second: fc.constantFrom(0, 1, 900, 3599),
      })
      .map((m) => at(seconds(`${m.base}T00:00:00Z`) + m.day * 86_400 + m.hour * 3600 + m.second));
    fc.assert(
      fc.property(
        fc.array(moment, { maxLength: 60 }),
        fc.record({ hourly: setting, daily: setting, weekly: setting, monthly: setting }),
        (names, keep) => {
          const stay = retention("keep", names, keep).out;
          const go = retention("prune", names, keep).out;
          expect(stay).toEqual(expectedToStay(names, keep));
          expect([...stay, ...go].sort()).toEqual([...new Set(names)].sort());
          expect(stay.length).toBeLessThanOrEqual(bound(keep));
          if (names.length > 0) expect(stay[0]).toBe([...names].sort().reverse()[0]);
        },
      ),
      { numRuns: 150 },
    );
  }, 120_000);

  it.each([
    ["a small set", { hourly: 4, daily: 3, weekly: 2, monthly: 2 }, 400],
    ["the defaults", DEFAULTS, 400],
  ])(
    "stays within the bound over many backup runs, with manual dumps in between: %s",
    (_, keep, runs) => {
      // What the backup service does, run after run: add a dump, then delete what the policy says.
      const next = random(runs + keep.hourly);
      let present: string[] = [];
      let model: string[] = [];
      let t = seconds("2026-11-01T00:00:00Z");
      let most = 0;
      for (let run = 0; run < runs; run++) {
        const kind = next(20);
        // Mostly the hourly schedule; sometimes a manual dump minutes later, inside the same hour;
        // sometimes the service was down for days or weeks.
        t += kind < 12 ? 3600 : kind < 17 ? 60 + next(900) : (1 + next(40)) * 86_400 + next(86_400);
        present = [...present, at(t)];
        const go = retention("prune", present, keep);
        expect(go.status).toBe(0);
        present = present.filter((n) => !go.out.includes(n));
        model = expectedToStay([...model, at(t)], keep);
        expect([...present].sort().reverse()).toEqual(model);
        expect(present.length).toBeLessThanOrEqual(bound(keep));
        expect(present).toContain(at(t));
        most = Math.max(most, present.length);
      }
      // The simulation must come close to the bound, or it shows nothing.
      expect(most).toBeGreaterThan(bound(keep) / 2);
    },
    120_000,
  );

  it("ignores every name that is not exactly one of ours, and never prints it", () => {
    const ours = [name("2027-03-10T12:00:00Z"), name("2027-03-09T12:00:00Z")];
    const others = [
      "elochair-manual.dump",
      "elochair-before-upgrade-20270310T120000Z.dump",
      "elochair-20270310T120000Z.dump.partial",
      "elochair-20270310T120000Z.dump.bak",
      "elochair-2027031T0120000Z.dump",
      "elochair-20270310t120000z.dump",
      "elochair-20270310T120000.dump",
      "elochair-20270310T1200000Z.dump",
      "other-20270310T120000Z.dump",
      "backups/elochair-20270310T120000Z.dump",
      "elochair-20270310T120000Z.dump ",
      " elochair-20270310T120000Z.dump",
      "elochair-20270310T12000xZ.dump",
      "notes.txt",
      "",
    ];
    const names = [...others, ...ours, ...others];
    expect(retention("keep", names, { ...OFF, hourly: 1 }).out).toEqual([ours[0]]);
    expect(retention("prune", names, { ...OFF, hourly: 1 }).out).toEqual([ours[1]]);
    expect(retention("keep", others, DEFAULTS)).toMatchObject({ status: 0, out: [] });
    expect(retention("prune", others, OFF)).toMatchObject({ status: 0, out: [] });
    expect(retention("keep", [], DEFAULTS)).toMatchObject({ status: 0, out: [] });
  });

  it("counts a name once however often it is listed", () => {
    const names = [name("2027-03-10T12:00:00Z"), name("2027-03-09T12:00:00Z")];
    expect(retention("keep", [...names, ...names], { ...OFF, hourly: 2 }).out).toEqual(names);
  });

  it("prints nothing and fails on a setting that is not a whole number", () => {
    const names = Array.from({ length: 200 }, (_, i) =>
      at(seconds("2027-03-10T12:00:00Z") - i * 3600),
    );
    for (const bad of ["many", "-1", "1.5", "3 ", "1e2", "0x10"]) {
      for (const tier of ["hourly", "daily", "weekly", "monthly"] as const) {
        for (const mode of ["keep", "prune"]) {
          const r = retention(mode, names, { [tier]: bad });
          expect(r.status, `${tier}=${bad}`).not.toBe(0);
          expect(r.out).toEqual([]);
          expect(r.err).toContain("whole numbers");
        }
      }
    }
    // Leading zeros are still whole numbers.
    expect(retention("keep", names, { ...OFF, hourly: "007" }).out).toHaveLength(7);
  });

  it("prints nothing and fails when it is not told whether to keep or prune", () => {
    const names = [name("2027-03-10T12:00:00Z"), name("2027-03-09T12:00:00Z")];
    for (const mode of ["", "delete", "--help"]) {
      const r = retention(mode, names, OFF);
      expect(r.status).not.toBe(0);
      expect(r.out).toEqual([]);
    }
  });
});

describe.skipIf(!posix)("deploy/backup.sh: taking, pruning and watching dumps", () => {
  let dir: string;
  let backups: string;
  const NOW = seconds("2027-03-10T12:00:00Z");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "elochair-backup-test-"));
    backups = join(dir, "backups");
    mkdirSync(backups);
    // Stand-ins for the Postgres tools: the real ones are exercised by deploy/test/backup-e2e.sh.
    mkdirSync(join(dir, "bin"));
    const stub = (tool: string, body: string) => {
      writeFileSync(join(dir, "bin", tool), `#!/bin/sh\n${body}\n`);
      chmodSync(join(dir, "bin", tool), 0o755);
    };
    stub(
      "pg_dump",
      [
        'for a in "$@"; do case "$a" in --file=*) out=$(printf "%s" "$a" | cut -d= -f2-) ;; esac; done',
        'echo "half a dump" > "$out"',
        'if [ -n "$STUB_PG_DUMP_FAILS" ]; then exit 1; fi',
        'echo "a whole dump" > "$out"',
      ].join("\n"),
    );
    stub("pg_restore", '[ -z "$STUB_PG_RESTORE_FAILS" ]');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function backup(args: string[], env: Record<string, string> = {}) {
    const r = spawnSync("bash", [BACKUP, ...args], {
      env: {
        PATH: `${join(dir, "bin")}:${PATH}`,
        BACKUP_DIR: backups,
        BACKUP_TEST_NOW: String(NOW),
        ...env,
      },
      encoding: "utf8",
      // A command that waits for a lock it has no business waiting for fails here, not hangs.
      timeout: 20_000,
    });
    if (r.error) throw r.error;
    return { status: r.status, out: r.stdout, err: r.stderr };
  }
  const touch = (...names: string[]) => {
    for (const n of names) writeFileSync(join(backups, n), "x");
  };
  const present = () => readdirSync(backups).sort().reverse();
  const ago = (s: number) => at(NOW - s);

  it("writes a dump named for the moment, private to its owner, and leaves no .partial", () => {
    const r = backup(["now"]);
    expect(r).toMatchObject({ status: 0 });
    expect(present()).toEqual([name("2027-03-10T12:00:00Z")]);
    expect(statSync(join(backups, present()[0]!)).mode & 0o777).toBe(0o600);
    expect(statSync(backups).mode & 0o777).toBe(0o700);
    expect(r.out).toContain(`wrote ${join(backups, name("2027-03-10T12:00:00Z"))}`);
  });

  it("applies the retention policy after a dump, and only to its own files", () => {
    const old = Array.from({ length: 10 }, (_, i) => ago((i + 1) * 3600));
    touch(...old, "elochair-before-upgrade.dump", "notes.txt");
    const keep = { ...OFF, hourly: 3 };
    expect(backup(["now"], keepEnv(keep)).status).toBe(0);
    expect(present()).toEqual(
      ["notes.txt", "elochair-before-upgrade.dump", at(NOW), old[0], old[1]].sort().reverse(),
    );
  });

  it("never holds more than the sum of the tiers, run after run", () => {
    const keep = { hourly: 3, daily: 2, weekly: 1, monthly: 1 };
    const next = random(7);
    let t = NOW;
    for (let run = 0; run < 60; run++) {
      t += [3600, 3600, 300, 86_400 * (1 + next(20))][next(4)]!;
      expect(backup(["now"], { ...keepEnv(keep), BACKUP_TEST_NOW: String(t) }).status).toBe(0);
      expect(present().length).toBeLessThanOrEqual(7);
      expect(present()[0]).toBe(at(t));
    }
  }, 60_000);

  it("leaves no dump, deletes nothing and says so when pg_dump fails", () => {
    const old = Array.from({ length: 5 }, (_, i) => ago((i + 1) * 3600));
    touch(...old);
    const r = backup(["now"], { ...keepEnv({ ...OFF, hourly: 1 }), STUB_PG_DUMP_FAILS: "1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("FAILED");
    expect(present()).toEqual(old);
  });

  /** A stand-in for sync that records what it was asked to write through, and can refuse. */
  const stubSync = () => {
    writeFileSync(
      join(dir, "bin", "sync"),
      [
        "#!/bin/sh",
        `echo "$1" >> "${join(dir, "synced")}"`,
        'if [ "$STUB_SYNC_FAILS" = file ] && [ -f "$1" ]; then echo "sync: error syncing" >&2; exit 1; fi',
        'if [ "$STUB_SYNC_FAILS" = directory ] && [ -d "$1" ]; then echo "sync: error syncing" >&2; exit 1; fi',
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(join(dir, "bin", "sync"), 0o755);
  };

  it("writes the dump through to the disk, then its name, before anything older goes", () => {
    stubSync();
    const old = Array.from({ length: 5 }, (_, i) => ago((i + 1) * 3600));
    touch(...old);
    expect(backup(["now"], keepEnv({ ...OFF, hourly: 1 })).status).toBe(0);
    expect(readFileSync(join(dir, "synced"), "utf8").split("\n").filter(Boolean)).toEqual([
      `${join(backups, at(NOW))}.partial`,
      backups,
    ]);
    expect(present()).toEqual([at(NOW)]);
  });

  it("discards a dump the disk did not take, and deletes nothing", () => {
    stubSync();
    const old = Array.from({ length: 5 }, (_, i) => ago((i + 1) * 3600));
    touch(...old);
    const r = backup(["now"], { ...keepEnv({ ...OFF, hourly: 1 }), STUB_SYNC_FAILS: "file" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("FAILED: the new dump could not be written through to the disk");
    // No final name, no .partial left behind, and every older dump still there.
    expect(present()).toEqual(old);
  });

  it("deletes nothing when the new dump's name could not be written through to the disk", () => {
    stubSync();
    const old = Array.from({ length: 5 }, (_, i) => ago((i + 1) * 3600));
    touch(...old);
    const r = backup(["now"], { ...keepEnv({ ...OFF, hourly: 1 }), STUB_SYNC_FAILS: "directory" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("no older dump was deleted");
    expect(present()).toEqual([at(NOW), ...old]);
  });

  it("discards a dump that does not read back, and deletes nothing", () => {
    const old = Array.from({ length: 5 }, (_, i) => ago((i + 1) * 3600));
    touch(...old);
    const r = backup(["now"], { ...keepEnv({ ...OFF, hourly: 1 }), STUB_PG_RESTORE_FAILS: "1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("FAILED");
    expect(present()).toEqual(old);
  });

  it("still takes the dump, but deletes nothing, when a retention setting is not valid", () => {
    const old = Array.from({ length: 5 }, (_, i) => ago((i + 1) * 3600));
    touch(...old);
    const r = backup(["now"], { BACKUP_KEEP_DAILY: "lots" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("ERROR");
    expect(present()).toEqual([at(NOW), ...old]);
    expect(backup(["prune"], { BACKUP_KEEP_DAILY: "lots" }).status).not.toBe(0);
    expect(present()).toEqual([at(NOW), ...old]);
  });

  it("prune --dry-run names what would go and deletes nothing", () => {
    const old = Array.from({ length: 5 }, (_, i) => ago(i * 3600));
    touch(...old);
    const r = backup(["prune", "--dry-run"], keepEnv({ ...OFF, hourly: 2 }));
    expect(r.status).toBe(0);
    expect(r.out.trim().split("\n")).toEqual(
      old.slice(2).map((n) => `would delete ${join(backups, n)}`),
    );
    expect(present()).toEqual(old);
    expect(backup(["prune"], keepEnv({ ...OFF, hourly: 2 })).status).toBe(0);
    expect(present()).toEqual(old.slice(0, 2));
  });

  it.skipIf(!hasFlock)(
    "a prune run by hand waits for a dump or a restore that holds the directory; a dry run does not",
    async () => {
      const old = Array.from({ length: 4 }, (_, i) => ago(i * 3600));
      touch(...old);
      const keep = keepEnv({ ...OFF, hourly: 1 });
      const held = join(dir, "held");
      const release = join(dir, "release");
      // Stands in for a dump in progress: it holds the directory's lock until it is told to let go.
      const holder = spawn("flock", [
        backups,
        "sh",
        "-c",
        `touch "${held}"; while [ ! -e "${release}" ]; do sleep 0.05; done`,
      ]);
      const holderGone = new Promise((resolve) => holder.on("exit", resolve));
      try {
        while (!existsSync(held)) await new Promise((resolve) => setTimeout(resolve, 20));

        // A dry run only reads: it answers at once, lock or no lock.
        const dry = backup(["prune", "--dry-run"], keep);
        expect(dry.status).toBe(0);
        expect(dry.out.trim().split("\n")).toHaveLength(3);
        expect(present()).toEqual(old);

        const pruning = spawn("bash", [BACKUP, "prune"], {
          env: {
            PATH: `${join(dir, "bin")}:${PATH}`,
            BACKUP_DIR: backups,
            BACKUP_TEST_NOW: String(NOW),
            ...keep,
          },
        });
        let ended = false;
        const status = new Promise<number | null>((resolve) =>
          pruning.on("exit", (code) => {
            ended = true;
            resolve(code);
          }),
        );
        // Long enough for an unlocked prune to have finished many times over.
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(ended).toBe(false);
        expect(present()).toEqual(old);

        writeFileSync(release, "");
        expect(await status).toBe(0);
        expect(present()).toEqual(old.slice(0, 1));
      } finally {
        writeFileSync(release, "");
        await holderGone;
      }
    },
    20_000,
  );

  it("prunes nothing, and waits for nothing, where there is no backup directory yet", () => {
    const r = backup(["prune"], { BACKUP_DIR: join(dir, "not-there") });
    expect(r.status).toBe(0);
    expect(existsSync(join(dir, "not-there"))).toBe(false);
  });

  it("removes a .partial left over for more than a day, going by its name and not its file time", () => {
    const stale = `${ago(86_400 + 60)}.partial`;
    const recent = `${ago(86_400 - 60)}.partial`;
    touch(stale, recent, ago(0));
    // File times say the opposite of the names, as they would after a copy.
    utimesSync(join(backups, stale), NOW, NOW);
    utimesSync(join(backups, recent), NOW - 10 * 86_400, NOW - 10 * 86_400);
    expect(backup(["prune"]).status).toBe(0);
    expect(present()).toEqual([recent, ago(0)].sort().reverse());
  });

  it("takes a dump from the loop only when the newest is older than the interval", () => {
    touch(ago(59 * 60));
    expect(backup(["tick"]).status).toBe(0);
    expect(present()).toEqual([ago(59 * 60)]);
    expect(backup(["tick"], { BACKUP_INTERVAL_MINUTES: "30" }).status).toBe(0);
    expect(present()).toEqual([at(NOW), ago(59 * 60)]);
  });

  it("takes the first dump at once, and reports a failed attempt to the loop", () => {
    expect(backup(["tick"], { STUB_PG_DUMP_FAILS: "1" }).status).not.toBe(0);
    expect(present()).toEqual([]);
    expect(backup(["tick"]).status).toBe(0);
    expect(present()).toEqual([at(NOW)]);
  });

  it("is healthy while the newest dump is within two intervals and five minutes", () => {
    expect(backup(["healthy"])).toMatchObject({
      status: 1,
      out: expect.stringContaining("no dump"),
    });
    touch(ago(125 * 60));
    expect(backup(["healthy"]).status).toBe(0);
    rmSync(join(backups, ago(125 * 60)));
    touch(ago(126 * 60));
    expect(backup(["healthy"])).toMatchObject({
      status: 1,
      out: expect.stringContaining("126 min old"),
    });
    expect(backup(["healthy"], { BACKUP_INTERVAL_MINUTES: "120" }).status).toBe(0);
    expect(backup(["healthy"], { BACKUP_MAX_AGE_MINUTES: "10" }).status).toBe(1);
  });

  it("is unhealthy when a retention setting is not valid, because dumps then pile up", () => {
    touch(ago(60));
    expect(backup(["healthy"]).status).toBe(0);
    expect(backup(["healthy"], { BACKUP_KEEP_WEEKLY: "-2" })).toMatchObject({
      status: 1,
      out: expect.stringContaining("retention settings are not valid"),
    });
  });

  it("does not take a dump stamped in the future, from a clock that was wrong, for a recent one", () => {
    touch(at(NOW + 400 * 86_400));
    expect(backup(["healthy"]).status).toBe(1);
    expect(backup(["tick"]).status).toBe(0);
    expect(existsSync(join(backups, at(NOW)))).toBe(true);
    expect(backup(["healthy"]).status).toBe(0);
  });

  it("says so, and fails, when dumps from a wrong clock crowd out the one just written", () => {
    touch(at(NOW + 400 * 86_400), at(NOW + 401 * 86_400));
    const r = backup(["now"], keepEnv({ ...OFF, hourly: 2 }));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("pruned as soon as it was written");
    expect(backup(["healthy"]).status).toBe(1);
  });

  it("refuses to run with an interval that is not a whole number of minutes", () => {
    for (const bad of ["soon", "0", "-5", "1.5"]) {
      expect(backup(["now"], { BACKUP_INTERVAL_MINUTES: bad }).status).toBe(2);
    }
    expect(present()).toEqual([]);
  });

  it("lists the dumps newest first", () => {
    touch(ago(7200), ago(0), ago(3600), "elochair-manual.dump");
    expect(backup(["list"]).out.trim().split("\n")).toEqual(
      [ago(0), ago(3600), ago(7200)].map((n) => `${n}  1 bytes`),
    );
  });
});
