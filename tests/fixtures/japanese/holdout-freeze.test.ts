import { expect, test } from "bun:test";
import { holdoutFixtures } from "./corpus.ts";

const frozenHoldoutDigest =
  "09766ca766082fcc3a08e84b3f1370e860749584f25fa494efe6fba9c15ac600";

test("the Phase 0 holdout remains frozen before analyzer tuning", () => {
  const digest = new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(holdoutFixtures))
    .digest("hex");

  expect(digest).toBe(frozenHoldoutDigest);
});
