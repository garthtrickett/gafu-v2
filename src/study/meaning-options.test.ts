import { expect, test } from "bun:test";
import { meaningOptions } from "./meaning-options.ts";

test("comma-separated vocabulary glosses keep their delimiter and skip bracketed commas", () => {
  expect(meaningOptions("unfolding, development", "vocabulary")).toEqual({
    separator: ",",
    options: ["unfolding", "development"],
  });
  expect(meaningOptions("orange (fruit, colour)", "vocabulary").options).toEqual([
    "orange (fruit, colour)",
  ]);
  expect(
    meaningOptions(
      "exit [of a building (school, office), for example], way out",
      "vocabulary",
    ).options,
  ).toEqual(["exit [of a building (school, office), for example]", "way out"]);
});

test("semicolon lists and grammar explanation commas keep their existing behavior", () => {
  expect(meaningOptions("and me, of all people; how unlike me", "vocabulary")).toEqual({
    separator: ";",
    options: ["and me, of all people", "how unlike me"],
  });
  expect(
    meaningOptions("When talking to a friend, this softens a request", "grammar")
      .options,
  ).toEqual(["When talking to a friend, this softens a request"]);
});
