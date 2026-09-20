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

  // A first exposure normally defers its review to the next sitting, which
  // this journey cannot wait for. Zero asks for it straight away, which is
  // what the preference is for: the right gap is the learner's own rhythm.
  await page.request.put("/api/study/preferences", {
    headers: { "X-Gafu-Request": "gafu-v2" },
    data: { firstReviewAfterMinutes: 0 },
  });

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

  // A new Card is met as a bare word first, which needs no generation at
  // all. This journey is about the generated sentence, so both Cards are put
  // past that stage the way a learner would: by saying they already know it.
  for (const lemma of ["鳥", "猫"]) {
    const found = (await (
      await page.request.get(`/api/study?search=${encodeURIComponent(lemma)}`)
    ).json()) as { cards: { id: string; content: { lemma?: string } }[] };
    const card = found.cards.find((item) => item.content.lemma === lemma);
    if (card === undefined) throw new Error(`no Card for ${lemma}`);
    await page.request.post(`/api/study/cards/${card.id}/state`, {
      headers: { "X-Gafu-Request": "gafu-v2" },
      data: { action: "graduate" },
    });
  }

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
    knowledge?: unknown;
  };
  // Knowledge is no longer in the bank snapshot; it has its own route.
  expect(studyBody.knowledge).toBeUndefined();
  const knowledgeState = await page.request.get("/api/study/knowledge");
  if (!knowledgeState.ok())
    throw new Error(`knowledge read: ${knowledgeState.status()}`);
  const knowledgeBody = (await knowledgeState.json()) as {
    vocabulary: { lemma: string; reading: string; partOfSpeech: string | null }[];
    grammar: { canonicalForm: string }[];
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
        vocabulary: knowledgeBody.vocabulary,
        grammar: new Set(knowledgeBody.grammar.map((item) => item.canonicalForm)),
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

  // Nothing has taught the background Cards, and the bank says so before a
  // batch runs. Learn is gone: Prepare batch writes the first exposures and
  // opens the session itself, so one press covers every Card that is due.
  await expect(
    page.locator(".bank-card", { hasText: "no teaching yet" }).first(),
  ).toBeVisible();

  const tile = async (name: string): Promise<number> =>
    Number(
      (await page.getByTestId(`tile-${name}`).locator("strong").textContent()) ?? "",
    );
  const learned: string[] = [];
  // Seen it is instant: the acknowledgement goes to the outbox and the next
  // Card shows before the server has answered. The first acknowledgement is
  // held to prove it, and the syncing indicator names the queued write.
  let releaseTeach = (): void => {};
  const teachGate = new Promise<void>((resolve) => {
    releaseTeach = resolve;
  });
  let teachHeld = false;
  await page.route("**/api/study/session/teach", async (route) => {
    if (!teachHeld) {
      teachHeld = true;
      await teachGate;
    }
    await route.continue();
  });
  await review.getByRole("button", { name: "Prepare batch" }).click();
  await expect(review.getByTestId("batch-progress")).toContainText("Batch ready:", {
    timeout: 60_000,
  });

  // The session holds a first exposure for every untaught Card: the two
  // authored sentences served as they were written, the background Cards
  // generated. Work through until both authored Cards have been seen.
  let released = false;
  let inspected = false;
  for (let guard = 0; guard < 40 && learned.length < 2; guard += 1) {
    await expect(review.getByText("teach", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    const kind = ((await review.getByTestId("card-kind").textContent()) ?? "").trim();
    const toLearn = await tile("learn");
    const toReview = await tile("review");
    if (kind === "vocabulary" && !inspected) {
      inspected = true;
      // The authored sentence is spoken too: the clip is filled in on first
      // serve, the Listen button appears, and the clip itself is real audio.
      const listen = review.getByTestId("listen");
      await expect(listen).toBeVisible();
      const audioUrl = (await listen.getAttribute("data-audio-url")) ?? "";
      expect(audioUrl).toMatch(/^\/api\/study\/presentations\/.+\/audio$/u);
      const clip = await page.request.get(audioUrl);
      expect(clip.status()).toBe(200);
      expect(clip.headers()["content-type"]).toBe("audio/wav");
      expect((await clip.body()).byteLength).toBeGreaterThan(44);
      // Highlighting a word and pressing Alt opens Jisho for it. The selection
      // is made the way a drag ends: a range over the target's kanji with the
      // furigana excluded. The highlight alone does nothing; Alt does.
      await page.evaluate(() => {
        const target = document.querySelector("[data-japanese-sentence] .target");
        if (target === null) throw new Error("no target span");
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
      await expect(page.getByTestId("jisho-lookup")).toHaveCount(0);
      await page.keyboard.press("Alt");
      const lookup = page.getByTestId("jisho-lookup");
      await expect(lookup).toBeVisible();
      await expect(lookup).toContainText("deterministic sense of");
      // The word is one of the learner's own Cards, and the dialog says so.
      await expect(lookup.getByTestId("lookup-known")).toContainText(
        "one of your Cards",
      );
      await expect(lookup.getByRole("link", { name: /jisho\.org/u })).toHaveAttribute(
        "href",
        /^https:\/\/jisho\.org\/search\//u,
      );
      await page.keyboard.press("Escape");
      await expect(lookup).toHaveCount(0);
    }
    if (kind === "vocabulary") {
      // The target's own meaning is always there, whatever prose the model
      // wrote: it comes from the Card through the validated metadata.
      const gloss = review.getByTestId("answer-target");
      await expect(gloss).toBeVisible();
      await expect(gloss).toContainText(/[鳥猫]（(とり|ねこ)）/u);
      await expect(gloss).toContainText(/bird|cat/u);
      const taught = (await review.getByTestId("material-answer").textContent()) ?? "";
      learned.push(taught.includes("cat") ? "cat" : "bird");
    }
    await expect(review.getByRole("button", { name: "good" })).toHaveCount(0);
    await review.getByRole("button", { name: "Seen it — next Card" }).click();
    await expect(page.getByRole("status")).toContainText("Teaching seen");
    if (!released) {
      released = true;
      // The next Card is on screen while the first acknowledgement is still
      // held; the tiles cannot have moved yet.
      await expect(review.getByText("teach", { exact: true })).toBeVisible();
      await expect(page.getByTestId("syncing")).toContainText("Syncing 1");
      expect(await tile("learn")).toBe(toLearn);
      releaseTeach();
    }
    await expect(page.getByTestId("syncing")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId("tile-learn").locator("strong")).toHaveText(
      String(toLearn - 1),
    );
    await expect(page.getByTestId("tile-review").locator("strong")).toHaveText(
      String(toReview + 1),
    );
  }
  expect(learned.sort()).toEqual(["bird", "cat"]);

  // A Card can be shelved from where it is read, without going to the bank
  // to find it. The next Card shows at once and the suspension goes to the
  // outbox like any other write; no grade is recorded for it.
  await expect(review.getByText("teach", { exact: true })).toBeVisible();
  const shelved = (await review.getByTestId("answer-target").textContent()) ?? "";
  const shelvedTitle = (shelved.match(/^\s*([^（\s]+)/u) ?? [])[1] ?? "";
  expect(shelvedTitle.length).toBeGreaterThan(0);
  await review.getByTestId("suspend-current").click();
  await expect(page.getByRole("status")).toContainText("Suspended");
  await expect(page.getByTestId("syncing")).toHaveCount(0, { timeout: 20_000 });
  await expect(
    page.locator(".bank-card", { hasText: shelvedTitle }).first(),
  ).toContainText("suspended");

  // The batch also wrote first exposures for the background Cards. Read
  // through the rest so the session ends and the buttons come back.
  for (let guard = 0; guard < 40; guard += 1) {
    if (
      (await review.getByRole("button", { name: "Seen it — next Card" }).count()) === 0
    )
      break;
    await review.getByRole("button", { name: "Seen it — next Card" }).click();
    await expect(page.getByTestId("syncing")).toHaveCount(0, { timeout: 20_000 });
  }
  await expect(page.getByRole("status")).toContainText("Batch complete.");

  // A Card that has been taught carries no gap in the bank, and the batch
  // filled the gaps it found: what was flagged before it ran is not now.
  await expect(page.locator(".bank-card", { hasText: "鳥" })).not.toContainText(
    "no teaching yet",
  );
  await expect(page.locator(".bank-card", { hasText: "猫" })).not.toContainText(
    "no teaching yet",
  );

  // The offline shell: once the worker controls the page, a reload passes
  // through it and the signed-in page and its assets are kept.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect(page.getByTestId("tile-learn")).toBeVisible();
  await expect(page.locator(".bank-card", { hasText: "鳥" })).toBeVisible();

  // One batch prepares everything due, each Card in the mode it wants: a
  // first exposure for the background grammar nothing has taught yet, a
  // review for the pair already taught. Work-through then serves the banked
  // reviews on its own; the serve is held, with the hold armed before
  // dispatch, so the waiting state can be seen and named.
  let releaseFirst = (): void => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route("**/api/study/session/review-all", async (route) => {
    await firstGate;
    await route.continue();
  });
  await review.getByRole("button", { name: "Prepare batch" }).click();
  await expect(review.getByTestId("batch-progress")).toContainText("Batch ready:", {
    timeout: 30_000,
  });

  // Work through in whatever order the session arrived. A review shows the
  // scene and the sentence with the target coloured; the explanation opens
  // on request, and only then is the Card marked correct or incorrect. The
  // grade goes to the outbox and the next Card shows at once. The first grade
  // is given with the network gone: it waits in the outbox, the page is
  // reloaded from the worker's cache, the session resumes from this device,
  // and the grade is sent when the network returns.
  const worked: string[] = [];
  const reviewOne = async (grade: "Correct" | "Incorrect"): Promise<void> => {
    await expect(review.getByText("review", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    // Nothing to recall from, and the target word stands out.
    await expect(review.getByTestId("material-answer")).toHaveCount(0);
    await expect(review.locator(".japanese .target").first()).toBeVisible();
    // Generated reviews were spoken when they were banked. The target's
    // meaning is part of the answer, so it waits for the explanation.
    await expect(review.getByTestId("listen")).toBeVisible();
    await expect(review.getByTestId("answer-target")).toHaveCount(0);
    // One explanation by button, the other by its key.
    if (grade === "Correct") {
      await review.getByRole("button", { name: "Explanation" }).click();
    } else {
      await page.keyboard.press("e");
    }
    await expect(review.getByTestId("answer-target")).toBeVisible();
    const shown = (await review.getByTestId("material-answer").textContent()) ?? "";
    worked.push(shown.includes("cat") ? "cat" : "bird");
    // One grade by button, the other by its key.
    if (grade === "Correct") {
      await review.getByRole("button", { name: "Correct", exact: true }).click();
    } else {
      await page.keyboard.press("i");
    }
  };
  // Every taught Card is due, background grammar included, so the batch
  // prepared reviews for all of them. The assertions here are about the two
  // Vocabulary Cards, whose meanings the journey knows; the rest are graded
  // past. Only ever online: offline they would queue and the outbox count
  // below would stop meaning anything.
  const skipToVocabulary = async (): Promise<void> => {
    for (let guard = 0; guard < 40; guard += 1) {
      await expect(review.getByText("review", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      const kind = ((await review.getByTestId("card-kind").textContent()) ?? "").trim();
      if (kind === "vocabulary") return;
      await review.getByRole("button", { name: "Explanation" }).click();
      await review.getByRole("button", { name: "Correct", exact: true }).click();
      await expect(page.getByTestId("syncing")).toHaveCount(0, { timeout: 20_000 });
    }
    throw new Error("no Vocabulary Card came up");
  };

  const progress = page.getByTestId("session-progress");
  await expect(progress).toContainText("Opening the prepared");
  await expect(progress.locator(".pending-elapsed")).toHaveText(/^\d+s$/u);
  releaseFirst();
  await expect(progress).toHaveCount(0);
  // The batch also wrote first exposures for the background Cards nothing
  // had taught, but the reviews lead, so one is showing already.
  await expect(review.getByText("review", { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  await skipToVocabulary();

  // The next clip is fetched ahead while online, so it plays after the reload.
  await page.context().setOffline(true);
  await expect(page.getByTestId("offline")).toBeVisible();
  await reviewOne("Correct");
  // The second review is already showing and the grade waits in the outbox.
  await expect(page.getByRole("status")).toContainText("Next Card");
  await expect(review.getByText("review", { exact: true })).toBeVisible();
  await expect(review.getByTestId("material-answer")).toHaveCount(0);
  await expect(page.getByTestId("offline")).toContainText("1 update will sync");
  const secondSentence = (await review.locator(".japanese").textContent()) ?? "";

  // Reload with no network: the worker serves the page, the device supplies
  // the bank, the session, and the queued grade.
  await page.reload();
  await expect(review.getByText("review", { exact: true })).toBeVisible();
  expect((await review.locator(".japanese").textContent()) ?? "").toBe(secondSentence);
  await expect(page.getByRole("status")).toContainText("Offline");
  await expect(page.getByTestId("offline")).toContainText("1 update will sync");
  await expect(page.locator(".bank-card", { hasText: "鳥" })).toBeVisible();

  // The network returns: the grade goes up on its own.
  await page.context().setOffline(false);
  await expect(page.getByTestId("offline")).toHaveCount(0);
  await expect(page.getByTestId("syncing")).toHaveCount(0);
  await skipToVocabulary();
  await reviewOne("Incorrect");
  expect(worked.sort()).toEqual(["bird", "cat"]);
  // Both Vocabulary Cards are graded; whatever the batch also prepared is
  // read through to the end, so the session closes and says so.
  for (let guard = 0; guard < 40; guard += 1) {
    const seen = review.getByRole("button", { name: "Seen it — next Card" });
    if ((await seen.count()) > 0) {
      await seen.click();
    } else if (
      (await review.getByRole("button", { name: "Explanation" }).count()) > 0
    ) {
      await review.getByRole("button", { name: "Explanation" }).click();
      await review.getByRole("button", { name: "Correct", exact: true }).click();
    } else {
      break;
    }
    await expect(page.getByTestId("syncing")).toHaveCount(0, { timeout: 20_000 });
  }
  await expect(page.getByRole("status")).toContainText("Batch complete.");
  // Once the outbox drains the bank is refetched and shows both reviews.
  await expect(page.locator(".bank-card", { hasText: "鳥" })).toContainText("1 review");
  await expect(page.locator(".bank-card", { hasText: "猫" })).toContainText("1 review");

  await page.reload();
  await expect(
    page.getByText("API key supplied by the server environment."),
  ).toBeVisible();
  await expect(page.locator(".bank-card", { hasText: "鳥" })).toContainText("1 review");
  await expect(page.locator(".bank-card", { hasText: "猫" })).toContainText("1 review");
});
