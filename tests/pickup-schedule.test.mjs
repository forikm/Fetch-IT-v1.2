import assert from "node:assert/strict";
import test from "node:test";
import { parsePickupSchedule, pickupScheduleIso, pickupScheduleInput } from "../src/lib/pickup-schedule.ts";

test("Philippine pickup time is the same instant on UTC and overseas servers", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ["UTC", "Asia/Manila", "America/Los_Angeles"]) {
      process.env.TZ = zone;
      assert.equal(pickupScheduleIso("2026-10-11T17:09"), "2026-10-11T09:09:00.000Z");
      assert.equal(pickupScheduleIso("2026-10-11T17:09:00+08:00"), "2026-10-11T09:09:00.000Z");
      assert.equal(pickupScheduleIso("2026-10-11T09:09:00.000Z"), "2026-10-11T09:09:00.000Z");
      assert.equal(pickupScheduleInput(new Date("2026-10-11T09:09:00Z")), "2026-10-11T17:09");
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
test("Now does not schedule a job; invalid dates are rejected rather than rolled over", () => {
  for (const value of [undefined, null, ""]) assert.equal(parsePickupSchedule(value), null);
  for (const value of [false, 123, {}, "2026-02-30T17:09", "2026-13-01T17:09", "2026-01-01T24:00", "2026-01-01T17:60", "2026-01-01", "tomorrow"]) assert.throws(() => parsePickupSchedule(value));
  assert.equal(pickupScheduleIso("2028-02-29T00:00"), "2028-02-28T16:00:00.000Z");
});
