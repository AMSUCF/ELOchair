import { describe, expect, it } from "vitest";
import { statedDeadline } from "./deadline";

/** The date and time a deadline reads as, written out the way ISO does. */
const reads = (iso: string, timeZone: string) =>
  statedDeadline(iso, timeZone).wallClock.toISOString().slice(0, 16);

describe("a deadline as its call states it", () => {
  it("reads as written, whatever offset it was written in", () => {
    for (const [iso, written] of [
      ["2031-02-14T23:59:00-12:00", "2031-02-14T23:59"],
      ["2031-01-11T00:00:00-05:00", "2031-01-11T00:00"],
      ["2031-04-30T23:59:00Z", "2031-04-30T23:59"],
      ["2031-04-30T23:59:59.999+05:30", "2031-04-30T23:59"],
      ["2031-12-31T23:59:00+14:00", "2031-12-31T23:59"],
    ] as const) {
      expect(reads(iso, "America/Bogota"), iso).toBe(written);
    }
  });

  it("twelve hours behind UTC is anywhere on Earth", () => {
    // 23:59 anywhere on Earth is 6:59 the next morning in Bogotá: the page must not say that.
    expect(statedDeadline("2031-02-14T23:59:00-12:00", "America/Bogota")).toEqual({
      wallClock: new Date("2031-02-14T23:59:00Z"),
      clock: "aoe",
      offset: "UTC\u221212:00",
    });
    expect(statedDeadline("2031-02-14T23:59:00-12:00", "UTC").clock).toBe("aoe");
    // Twelve hours ahead is a place, not everywhere.
    expect(statedDeadline("2031-02-14T23:59:00+12:00", "America/Bogota").clock).toBe("offset");
  });

  it("the offset of the conference's own time zone is conference time", () => {
    expect(statedDeadline("2031-01-11T00:00:00-05:00", "America/Bogota")).toEqual({
      wallClock: new Date("2031-01-11T00:00:00Z"),
      clock: "conference",
      offset: "UTC\u221205:00",
    });
    expect(statedDeadline("2031-06-30T17:00:00+05:30", "Asia/Kolkata").clock).toBe("conference");
    expect(statedDeadline("2031-06-30T17:00:00Z", "UTC").clock).toBe("conference");
    expect(statedDeadline("2031-06-30T17:00:00+00:00", "UTC").clock).toBe("conference");
  });

  it("any other offset is named by itself, with a minus sign and not a hyphen", () => {
    const offset = (iso: string) => statedDeadline(iso, "America/Bogota");
    expect(offset("2031-04-30T23:59:00Z")).toMatchObject({ clock: "offset", offset: "UTC" });
    expect(offset("2031-04-30T23:59:00+00:00").offset).toBe("UTC");
    expect(offset("2031-04-30T23:59:00-08:00")).toMatchObject({
      clock: "offset",
      offset: "UTC\u221208:00",
    });
    expect(offset("2031-04-30T23:59:00+05:30").offset).toBe("UTC+05:30");
    expect(offset("2031-04-30T23:59:00-08:00").offset).not.toContain("-");
  });

  it("follows daylight saving: the conference's offset is the one in force at that instant", () => {
    const clock = (iso: string) => statedDeadline(iso, "America/New_York").clock;
    // 2031-03-09, 2:00 in New York: the clocks go from UTC-5 to UTC-4.
    expect(clock("2031-03-09T01:59:00-05:00")).toBe("conference");
    expect(clock("2031-03-09T03:00:00-04:00")).toBe("conference");
    // Written with the winter offset for a summer instant, and the other way round: not the
    // time on a clock in New York, so it is not called conference time.
    expect(clock("2031-03-09T03:30:00-05:00")).toBe("offset");
    expect(clock("2031-03-09T00:30:00-04:00")).toBe("offset");
    expect(clock("2031-07-01T23:59:00-05:00")).toBe("offset");
    expect(clock("2031-07-01T23:59:00-04:00")).toBe("conference");
    // 2031-11-02, 2:00: back to UTC-5. 1:30 happens twice, and both are New York time.
    expect(clock("2031-11-02T01:30:00-04:00")).toBe("conference");
    expect(clock("2031-11-02T01:30:00-05:00")).toBe("conference");
    expect(reads("2031-11-02T01:30:00-04:00", "America/New_York")).toBe("2031-11-02T01:30");
    expect(reads("2031-11-02T01:30:00-05:00", "America/New_York")).toBe("2031-11-02T01:30");
  });

  it("asks the conference's clock first: a conference twelve hours behind UTC keeps its own", () => {
    expect(statedDeadline("2031-02-14T23:59:00-12:00", "Etc/GMT+12").clock).toBe("conference");
  });

  it("a text without a written offset is read on the conference's clock", () => {
    // Not a stored deadline (the schema refuses it), but nothing here may throw on one.
    const local = statedDeadline("2031-02-14T23:59:00", "UTC");
    expect(local.clock).toBe("conference");
    expect(Number.isNaN(statedDeadline("not a date", "America/Bogota").wallClock.getTime())).toBe(
      true,
    );
  });
});
