import { expect, test } from "bun:test";
import { holdoutFixtures } from "./corpus.ts";

const frozenHoldoutDigest =
  "052c8cc9ce929b02eb74adcf6b64b65281c97685ac369854d38205156368fe63";

test("the Phase 0 holdout remains frozen before analyzer tuning", () => {
  const digest = new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(holdoutFixtures))
    .digest("hex");

  expect(digest).toBe(frozenHoldoutDigest);
});
