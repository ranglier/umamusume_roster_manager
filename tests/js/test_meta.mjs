import { test } from "node:test";
import assert from "node:assert/strict";

import { buildMetaWeights, hasMetaSignal, META_SUPPORT_BONUS_MAX, metaPopularityLabel } from "../../src/ui/assets/js/meta.js";

const SNAPSHOT = {
  schema_version: 1,
  source: "uma.moe",
  generated_at: "2026-07-13T00:00:00Z",
  sample_size: 3000,
  supports: {
    "30010": { count: 400, popularity: 1.0 },
    "30020": { count: 120, popularity: 0.3 },
    "10001": { count: 0, popularity: 0 }, // dropped
  },
  characters: {
    "105101": { count: 388, popularity: 0.97 },
  },
};

test("buildMetaWeights maps popularity to a capped support bonus and keeps the source", () => {
  const weights = buildMetaWeights(SNAPSHOT);
  assert.equal(weights.supportMeta["30010"].bonus, META_SUPPORT_BONUS_MAX); // popularity 1.0 -> cap
  assert.equal(weights.supportMeta["30010"].label, "top");
  assert.equal(weights.supportMeta["30020"].bonus, Math.round(0.3 * META_SUPPORT_BONUS_MAX));
  assert.equal(weights.supportMeta["30020"].label, "seen");
  assert.ok(!("10001" in weights.supportMeta)); // zero popularity dropped
  assert.equal(weights.characterMeta["105101"].label, "top");
  assert.equal(weights.meta.source, "uma.moe");
  assert.equal(weights.meta.sampleSize, 3000);
});

test("buildMetaWeights never exceeds the documented cap and clamps out-of-range popularity", () => {
  const weights = buildMetaWeights({ supports: { a: { popularity: 5 }, b: { popularity: -1 } } });
  assert.equal(weights.supportMeta["a"].bonus, META_SUPPORT_BONUS_MAX); // clamped to 1.0
  assert.ok(!("b" in weights.supportMeta)); // negative dropped
});

test("buildMetaWeights is a no-op on a missing/empty snapshot", () => {
  const weights = buildMetaWeights(null);
  assert.deepEqual(weights.supportMeta, {});
  assert.deepEqual(weights.characterMeta, {});
  assert.equal(hasMetaSignal(weights), false);
});

test("hasMetaSignal detects a loaded snapshot", () => {
  assert.equal(hasMetaSignal(buildMetaWeights(SNAPSHOT)), true);
  assert.equal(hasMetaSignal({}), false);
  assert.equal(hasMetaSignal(null), false);
});

test("metaPopularityLabel buckets by relative percentile", () => {
  assert.equal(metaPopularityLabel(0.9), "top");
  assert.equal(metaPopularityLabel(0.5), "high");
  assert.equal(metaPopularityLabel(0.1), "seen");
  assert.equal(metaPopularityLabel(0), "");
});
