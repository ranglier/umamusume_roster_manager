import "./_domshim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  asArray,
  normalizeProfilesIndex,
  normalizeRosterDocument,
  normalizeBuildEntry,
  normalizeBuildsDocument,
  getSupportLevelCap,
  hasFilterOption,
  defaultEntityKeyForMode,
  allowedEntityKeys,
  currentRouteState,
} from "../../src/ui/assets/js/core.js";

test("asArray wraps scalars, passes arrays through, and treats null/undefined as empty", () => {
  assert.deepEqual(asArray(null), []);
  assert.deepEqual(asArray(undefined), []);
  assert.deepEqual(asArray("x"), ["x"]);
  const arr = [1, 2];
  assert.equal(asArray(arr), arr);
});

test("normalizeProfilesIndex falls back to a default index for invalid payloads", () => {
  assert.deepEqual(normalizeProfilesIndex(null), { version: 1, last_profile_id: null, profiles: [] });
});

test("normalizeProfilesIndex drops profiles missing an id or name and resets a dangling last_profile_id", () => {
  const result = normalizeProfilesIndex({
    last_profile_id: "p_999",
    profiles: [
      { id: "p_001", name: "Main" },
      { id: "p_002" },
      { name: "No id" },
    ],
  });
  assert.deepEqual(result.profiles.map((p) => p.id), ["p_001"]);
  assert.equal(result.last_profile_id, null);
});

test("normalizeRosterDocument defaults missing buckets to empty objects", () => {
  assert.deepEqual(normalizeRosterDocument(null), {
    version: 1,
    updated_at: "",
    characters: {},
    supports: {},
  });
});

test("normalizeBuildEntry fills defaults for a bare object", () => {
  const entry = normalizeBuildEntry({});
  assert.equal(entry.mode, "champions_meeting");
  assert.equal(entry.status, "draft");
  assert.deepEqual(entry.support_deck, []);
  assert.deepEqual(entry.legacy_pair, {});
});

test("normalizeBuildEntry caps support_deck at 6 entries", () => {
  const entry = normalizeBuildEntry({ support_deck: ["a", "b", "c", "d", "e", "f", "g"] });
  assert.equal(entry.support_deck.length, 6);
});

test("normalizeBuildsDocument stamps the profile id and drops entries without one", () => {
  const doc = normalizeBuildsDocument({ updated_at: "t", entries: [{ id: "build_001" }, {}] }, "p_001");
  assert.equal(doc.profile_id, "p_001");
  assert.equal(doc.entries.length, 1);
  assert.equal(doc.entries[0].id, "build_001");
});

test("getSupportLevelCap matches the known rarity base caps", () => {
  assert.equal(getSupportLevelCap(1, 0), 20);
  assert.equal(getSupportLevelCap(2, 0), 25);
  assert.equal(getSupportLevelCap(3, 0), 30);
});

test("getSupportLevelCap adds 5 per limit break and caps at 50", () => {
  assert.equal(getSupportLevelCap(3, 1), 35);
  assert.equal(getSupportLevelCap(3, 10), 50);
});

test("getSupportLevelCap defaults unknown rarities to the base-30 cap", () => {
  assert.equal(getSupportLevelCap(99, 0), 30);
});

test("hasFilterOption looks up a value among an entity's filter options", () => {
  const entity = { filter_options: { rarity: [{ value: "3" }, { value: "4" }] } };
  assert.equal(hasFilterOption(entity, "rarity", "3"), true);
  assert.equal(hasFilterOption(entity, "rarity", "9"), false);
  assert.equal(hasFilterOption({}, "rarity", "3"), false);
});

test("defaultEntityKeyForMode picks characters for roster mode", () => {
  assert.equal(defaultEntityKeyForMode("roster"), "characters");
});

test("allowedEntityKeys returns the roster-specific set for roster mode", () => {
  assert.deepEqual(allowedEntityKeys("roster"), ["characters", "supports", "legacy", "builds"]);
});

test("currentRouteState parses empty/known hashes into page routes", () => {
  const cases = [
    ["", { page: "profiles" }],
    ["#/profiles", { page: "profiles" }],
    ["#/wizard", { page: "wizard" }],
    ["#/admin", { page: "admin" }],
  ];
  for (const [hash, expected] of cases) {
    window.location.hash = hash;
    assert.deepEqual(currentRouteState(), expected);
  }
});

test("currentRouteState falls back to the default entity key for an unknown roster entity", () => {
  window.location.hash = "#/roster/bogus";
  assert.deepEqual(currentRouteState(), {
    page: "browse",
    mode: "roster",
    entityKey: "characters",
    itemId: null,
  });
});

test("currentRouteState treats a bare top-level entity key as reference mode", () => {
  window.location.hash = "#/characters/999";
  assert.deepEqual(currentRouteState(), {
    page: "browse",
    mode: "reference",
    entityKey: "characters",
    itemId: "999",
  });
});
