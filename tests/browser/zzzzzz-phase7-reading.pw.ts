import { expect, test } from "@playwright/test";

// Writing a tale is one generation per sentence. Under the fake AI each is
// instant, so this journey is about the plumbing and the promise: every
// sentence lands, the tale's own word is marked and glossed where it is met,
// and a word worth keeping becomes a Card without leaving the page.
test.setTimeout(180_000);

test("writes a tale in the learner's own words and reads it back", async ({ page }) => {
  // A tale is written out of what the learner knows, so the learner has to
  // know something. The journey supplies that itself rather than depending
  // on whichever journey happened to run before it.
  const made = await page.request.post("/api/study/cards", {
    headers: { "X-Gafu-Request": "gafu-v2" },
    data: {
      type: "vocabulary",
      content: {
        lemma: "犬",
        reading: "いぬ",
        partOfSpeech: "noun",
        meaning: "dog",
        usageNotes: "",
      },
    },
  });
  if (!made.ok() && made.status() !== 409) {
    throw new Error(`card create: ${made.status()}`);
  }
  const bank = await page.request.get("/api/study?search=%E7%8A%AC");
  const listed = (await bank.json()) as { cards: { id: string }[] };
  const cardId = listed.cards[0]?.id;
  if (cardId === undefined) throw new Error("no 犬 Card to mark");
  const ready = await page.request.post(`/api/study/cards/${cardId}/state`, {
    headers: { "X-Gafu-Request": "gafu-v2" },
    data: { action: "markSupportReady" },
  });
  if (!ready.ok()) throw new Error(`support-ready: ${ready.status()}`);

  // Reached the way a learner reaches it: from Study. A page with no way in
  // is a page nobody finds, which is how this one shipped.
  await page.goto("/");
  await page.getByRole("link", { name: "Read a tale" }).click();

  await expect(
    page.getByRole("heading", { name: "Tales told in the words you have." }),
  ).toBeVisible();

  // Every tale is offered, with what it will cost the reader in new words.
  const list = page.getByTestId("tale-list");
  await expect(list.locator(".bank-card")).toHaveCount(4);
  const momotaro = list.locator(".bank-card[data-tale-id='momotaro']");
  await expect(momotaro).toContainText("桃太郎");
  await expect(momotaro).toContainText("Peach Boy");
  await expect(momotaro).toContainText("New words:");

  // Nothing has been written yet, so there is nothing to read.
  await expect(momotaro.getByRole("button", { name: "Read it" })).toHaveCount(0);

  // How long the tale runs, so the assertion below is about the tale rather
  // than a number that goes stale when a beat is added.
  const advertised = ((await momotaro.textContent()) ?? "").match(
    /(\d+) sentences/u,
  )?.[1];
  expect(advertised).toBeDefined();
  const total = Number(advertised);
  expect(total).toBeGreaterThan(50);

  await momotaro.getByRole("button", { name: "Write it" }).click();
  // A hundred sentences is a hundred generations, so the wait is watched
  // rather than hidden: it says which sentence it is on.
  await expect(page.getByTestId("reading-progress")).toContainText("Writing sentence");
  await expect(page.getByTestId("reading")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("status")).toContainText("written in");

  // One sentence per beat, each of them shown.
  const sentences = page.getByTestId("reading-sentence");
  await expect(sentences).toHaveCount(total);

  // The tale's own words are marked where they are met, with their meaning,
  // so a reader is never left guessing at the one word that is new.
  const words = page.getByTestId("reading-word");
  expect(await words.count()).toBeGreaterThan(0);
  await expect(words.first()).toContainText("（");

  // The English is there when asked for, and not before.
  const first = sentences.first();
  await expect(first.getByTestId("reading-english")).toHaveCount(0);
  await first.getByRole("button", { name: "What does it say?" }).click();
  await expect(first.getByTestId("reading-english")).toBeVisible();

  // A word met here can be kept, without going to look for it.
  const firstWord = words.first();
  const kept = ((await firstWord.locator("strong").textContent()) ?? "").trim();
  expect(kept.length).toBeGreaterThan(0);
  await firstWord.getByRole("button", { name: "Add as a Card" }).click();
  await expect(page.getByRole("status")).toContainText("staged as a Card");
  await expect(firstWord).toContainText("staged");

  // Reading is where an unknown word is met, so the dictionary is here too.
  // Only the tale's own word is glossed under its sentence; every other word
  // is one the reader is supposed to know and sometimes does not. The
  // selection is made the way a drag ends, with the furigana excluded.
  await page.evaluate(() => {
    const sentences = document.querySelectorAll("[data-japanese-sentence]");
    const last = sentences[sentences.length - 1];
    if (last === undefined) throw new Error("no sentence");
    const span = last.querySelector("span, ruby");
    if (span === null) throw new Error("no word to highlight");
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  // The highlight alone does nothing; Alt does.
  await expect(page.getByTestId("jisho-lookup")).toHaveCount(0);
  await page.keyboard.press("Alt");
  const lookup = page.getByTestId("jisho-lookup");
  await expect(lookup).toBeVisible();
  await expect(lookup.getByRole("link", { name: /jisho\.org/u })).toHaveAttribute(
    "href",
    /^https:\/\/jisho\.org\/search\//u,
  );
  await page.keyboard.press("Escape");
  await expect(lookup).toHaveCount(0);

  // The reading was kept, so the tale can be carried on rather than rewritten.
  await page.getByRole("button", { name: "All tales" }).click();
  const again = page
    .getByTestId("tale-list")
    .locator(".bank-card[data-tale-id='momotaro']");
  await expect(again.getByRole("button", { name: "Read it" })).toBeVisible();
  await again.getByRole("button", { name: "Read it" }).click();
  await expect(page.getByTestId("reading-sentence")).toHaveCount(total);

  // And it reached the Card bank, where Study will serve it like any other.
  // Its state is not asserted: looking at Study admits under the daily
  // limit, so a Card staged a moment ago may already be in rotation.
  await page.goto("/");
  await page.getByLabel("Search").fill(kept);
  const banked = page.locator(".bank-card", { hasText: kept }).first();
  await expect(banked).toBeVisible();
  await expect(banked).toContainText(kept);
  await expect(page.getByTestId("bank-count")).toContainText("durable Cards");
});
