import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSavedPlaces } from "../src/lib/signup-onboarding.ts";

const home = { id: "home", name: "Home", label: "Home street", lat: 16, lng: 120 };
const work = { id: "work", name: "Work", label: "Office street", lat: 16.1, lng: 120.1 };

test("editing a destination nickname replaces its original entry and retains other saved places", () => {
  const renamed = { ...work, name: "School", details: "Building B" };
  const result = mergeSavedPlaces([home, work], [renamed]);
  assert.deepEqual(result, [home, renamed]);
});

test("setup replaces matching names without dropping unrelated places or address details", () => {
  const updated = { ...home, id: "new-home", label: "New street", details: "Unit 4B" };
  const result = mergeSavedPlaces([home, work], [updated]);
  assert.deepEqual(result, [work, updated]);
});

test("skipping both places preserves existing favorites", () => {
  assert.deepEqual(mergeSavedPlaces([home, work], []), [home, work]);
});
