import { expect, test } from "@playwright/test";
import { buildTeaching } from "../../scripts/authored-teaching.ts";
import { createKuromojiAnalyzer } from "../../src/analysis/kuromoji-analyzer.ts";
import { loadKuromojiFromDirectory } from "../../src/analysis/loaders.ts";
import { LOCAL_MUTATION_HEADER, LOCAL_MUTATION_VALUE } from "../../src/local-api.ts";

// This test creates fourteen background Grammar Cards one at a time, marks
// each known, teaches two Cards from attached sentences, batches their first
// reviews, and works the batch through. Generation is local and instant, but
// the fourteen creations dominate; the budget stays generous so shared
// machines do not flake it.
test.setTimeout(120_000);

test("configures a key and teaches before the first generated review", async ({
  page,
}) => {
  await page.goto("/");

  const earlierStagedGrammar = page.locator(".bank-card", { hasText: "〜てしまう" });
  if ((await earlierStagedGrammar.count()) > 0) {
    await earlierStagedGrammar.getByRole("button", { name: "Support-ready" }).click();
  }

  // The key is a deployment value now, so there is nothing to enter: the
  // panel reports what the environment supplied.
  await expect(
    page.getByText("API key supplied by the server environment."),
  ).toBeVisible();

  const vocabulary = page.getByTestId("vocabulary-form");
  await vocabulary.getByLabel("Lemma").fill("鳥");
  await vocabulary.getByLabel("Reading").fill("とり");
  await vocabulary.getByLabel("Part of speech").fill("noun");
  await vocabulary.getByLabel("One meaning").fill("bird");
  await vocabulary.getByLabel("Usage notes").fill("A general word for a bird.");
  await vocabulary.getByRole("button", { name: "Create Vocabulary Card" }).click();
  // The form resets only when the create round-trips, so wait for it before
  // filling the next Card — otherwise the reset lands mid-fill and wipes it.
  await expect(page.getByRole("status")).toContainText("Vocabulary Card created");

  await vocabulary.getByLabel("Lemma").fill("猫");
  await vocabulary.getByLabel("Reading").fill("ねこ");
  await vocabulary.getByLabel("Part of speech").fill("noun");
  await vocabulary.getByLabel("One meaning").fill("cat");
  await vocabulary.getByLabel("Usage notes").fill("A general word for a cat.");
  await vocabulary.getByRole("button", { name: "Create Vocabulary Card" }).click();
  await expect(page.getByRole("status")).toContainText("Vocabulary Card created");

  // The deterministic teach/review sentences use background particles the
  // learner is expected to know. A real learner marks them known first; the
  // journey does the same through the public card bank. 鳥 stays due first
  // because it was created before these background cards.
  const grammar = page.getByTestId("grammar-form");
  for (const form of [
    "か",
    "な",
    "かな",
    "で",
    "も",
    "だ",
    "よ",
    "ね",
    "〜て",
    "って",
    "だけ",
    "でも",
  ]) {
    await grammar.getByLabel("Canonical form").fill(form);
    await grammar.getByLabel("Meaning or function").fill(`background ${form}`);
    await grammar.getByLabel("Formation").fill(form);
    await grammar.getByRole("button", { name: "Create Grammar Card" }).click();
    await expect(page.getByRole("status")).toContainText("Grammar Card created");
    // :text-is matches the card title exactly; substring hasText would confuse
    // か with かな, だ with だけ, and も with でも.
    const background = page.locator(`.bank-card:has(h3:text-is("${form}"))`);
    await background.getByRole("button", { name: "Support-ready" }).click();
    await expect(background).toContainText("support-ready");
  }

  const review = page.getByTestId("review-panel");

  // First exposure shows only what was stored when the Card was made, so the
  // journey attaches teaching the way the cards CLI does. Study then shows it
  // without touching the provider; only the later review generates.
  const studyState = await page.request.get("/api/study");
  if (!studyState.ok()) throw new Error(`study read: ${studyState.status()}`);
  const studyBody = (await studyState.json()) as {
    cards: { id: string; content: { lemma?: string } }[];
    knowledge: {
      vocabulary: { lemma: string; reading: string; partOfSpeech: string | null }[];
      grammar: { canonicalForm: string }[];
    };
  };
  const analyzer = createKuromojiAnalyzer(() =>
    loadKuromojiFromDirectory("node_modules/@faanau/kuromoji/dict"),
  );
  const attachTeaching = async (
    lemma: string,
    reading: string,
    meaning: string,
    usageNotes: string,
    example: string,
  ): Promise<void> => {
    const target = studyBody.cards.find((card) => card.content.lemma === lemma);
    if (target === undefined) throw new Error(`missing ${lemma} card`);
    const built = await buildTeaching(
      analyzer,
      {
        type: "vocabulary",
        lemma,
        reading,
        partOfSpeech: "noun",
        meaning,
        usageNotes,
        example,
      },
      {
        vocabulary: studyBody.knowledge.vocabulary,
        grammar: new Set(studyBody.knowledge.grammar.map((item) => item.canonicalForm)),
      },
    );
    if ("reason" in built) throw new Error(`authored teach: ${built.reason}`);
    const attached = await page.request.put(`/api/study/cards/${target.id}/teaching`, {
      headers: { [LOCAL_MUTATION_HEADER]: LOCAL_MUTATION_VALUE },
      data: built.value,
    });
    if (!attached.ok()) throw new Error(`attach teaching: ${attached.status()}`);
  };
  await attachTeaching("鳥", "とり", "bird", "A general word for a bird.", "鳥かな。");
  await attachTeaching("猫", "ねこ", "cat", "A general word for a cat.", "猫かな。");

  // Queue order is by Card id, so either Card can come first. One Learn press
  // teaches both: Seen it records the first and serves the second without a
  // trip back to the buttons. Seen it changes no state and no schedule, so
  // the visible proof it landed is the Card moving from the "to learn" tile
  // to the "to review" tile. The baseline is read after Learn opens, because
  // admission happens on that first press.
  const tile = async (name: string): Promise<number> =>
    Number(
      (await page.getByTestId(`tile-${name}`).locator("strong").textContent()) ?? "",
    );
  const learned: string[] = [];
  await review.getByRole("button", { name: "Learn new" }).click();
  for (let round = 0; round < 2; round += 1) {
    await expect(review.getByText("teach", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    const toLearn = await tile("learn");
    const toReview = await tile("review");
    const taught = (await review.getByTestId("material-answer").textContent()) ?? "";
    learned.push(taught.includes("cat") ? "cat" : "bird");
    await expect(review.getByRole("button", { name: "good" })).toHaveCount(0);
    await review.getByRole("button", { name: "Seen it — next Card" }).click();
    await expect(page.getByRole("status")).toContainText("Teaching seen");
    await expect(page.getByTestId("tile-learn").locator("strong")).toHaveText(
      String(toLearn - 1),
    );
    await expect(page.getByTestId("tile-review").locator("strong")).toHaveText(
      String(toReview + 1),
    );
  }
  expect(learned.sort()).toEqual(["bird", "cat"]);

  // Both taught Cards are out of the learn queue now. What remains untaught
  // has no stored teaching anywhere, so the chain ends on the buttons with a
  // plain message, and a fresh Learn press walks past all of it and says so
  // instead of idling on the first gap.
  await expect(page.getByRole("status")).toContainText("Nothing more to learn");
  await review.getByRole("button", { name: "Learn new" }).click();
  await expect(page.getByRole("status")).toContainText("has no teaching yet");

  // The review session dispatches one batch through the UI and pumps it to
  // done; work-through then serves from banked reserves through Review.
  await review.getByRole("button", { name: "Review batch" }).click();
  await expect(review.getByTestId("batch-progress")).toContainText("Batch ready: 2", {
    timeout: 30_000,
  });

  // Work through in whatever order the queue serves. A review shows the
  // scene and the sentence with the target coloured; the explanation opens
  // on request, and only then is the Card marked correct or incorrect. After
  // each grade the next batched Card arrives on its own; when none remains
  // the batch closes. The first grade holds the answer request to prove the
  // buttons stay disabled until it resolves.
  let releaseAnswer = (): void => {};
  const answerGate = new Promise<void>((resolve) => {
    releaseAnswer = resolve;
  });
  await page.route("**/api/study/session/answer", async (route) => {
    await answerGate;
    await route.continue();
  });
  const worked: string[] = [];
  const reviewOne = async (grade: "Correct" | "Incorrect"): Promise<void> => {
    await expect(review.getByText("review", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    // Nothing to recall from, and the target word stands out.
    await expect(review.getByTestId("material-answer")).toHaveCount(0);
    await expect(review.locator(".japanese .target").first()).toBeVisible();
    await review.getByRole("button", { name: "Explanation" }).click();
    const shown = (await review.getByTestId("material-answer").textContent()) ?? "";
    worked.push(shown.includes("cat") ? "cat" : "bird");
    await review.getByRole("button", { name: grade, exact: true }).click();
  };
  // The first Card is served by hand; the second arrives chained.
  await review.getByRole("button", { name: "Review", exact: true }).click();
  await reviewOne("Correct");
  await expect(
    review.getByRole("button", { name: "Correct", exact: true }),
  ).toBeDisabled();
  await expect(
    review.getByRole("button", { name: "Incorrect", exact: true }),
  ).toBeDisabled();
  releaseAnswer();
  await expect(page.getByRole("status")).toContainText("Next batched Card");
  await reviewOne("Incorrect");
  await expect(page.getByRole("status")).toContainText("Batch complete.");
  expect(worked.sort()).toEqual(["bird", "cat"]);
  expect(worked.sort()).toEqual(["bird", "cat"]);
  await expect(page.locator(".bank-card", { hasText: "鳥" })).toContainText("1 review");
  await expect(page.locator(".bank-card", { hasText: "猫" })).toContainText("1 review");

  await page.reload();
  await expect(
    page.getByText("API key supplied by the server environment."),
  ).toBeVisible();
  await expect(page.locator(".bank-card", { hasText: "鳥" })).toContainText("1 review");
  await expect(page.locator(".bank-card", { hasText: "猫" })).toContainText("1 review");
});
