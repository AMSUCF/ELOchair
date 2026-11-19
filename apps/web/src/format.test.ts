import { describe, expect, it } from "vitest";
import { numberLimits } from "./format";

describe("the limits a number input shows", () => {
  it("are the field's own for a number that may have a fraction", () => {
    expect(numberLimits({ min: 0.5, max: 2.5 })).toEqual({ min: 0.5, max: 2.5, step: "any" });
    expect(numberLimits({})).toEqual({ min: undefined, max: undefined, step: "any" });
  });

  it("are whole numbers for a whole-number field, as the call's workshop has them", () => {
    expect(numberLimits({ min: 15, max: 30, integer: true })).toEqual({
      min: 15,
      max: 30,
      step: 1,
    });
  });

  it("are the whole numbers inside a range whose ends have fractions", () => {
    // 15 is the one answer the server takes; the control must offer it and nothing beside it.
    expect(numberLimits({ min: 14.5, max: 15.5, integer: true })).toEqual({
      min: 15,
      max: 15,
      step: 1,
    });
    expect(numberLimits({ min: -2.5, max: 2.5, integer: true })).toEqual({
      min: -2,
      max: 2,
      step: 1,
    });
  });

  it("leave an end that is not set open", () => {
    expect(numberLimits({ min: 0.2, integer: true })).toEqual({ min: 1, max: undefined, step: 1 });
    expect(numberLimits({ max: 9.9, integer: true })).toEqual({ min: undefined, max: 9, step: 1 });
    expect(numberLimits({ integer: true })).toEqual({ min: undefined, max: undefined, step: 1 });
  });
});
