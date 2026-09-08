import { expect, test } from "bun:test";
import { holdoutFixtures } from "./corpus.ts";

const frozenHoldoutDigest =
  "9c5437404df6ab72b50ef66f9acb753da6629ee9379b158c6706fd718f598da6";

test("the Phase 0 holdout remains frozen before analyzer tuning", () => {
  const digest = new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(holdoutFixtures))
    .digest("hex");

  expect(digest).toBe(frozenHoldoutDigest);
});
