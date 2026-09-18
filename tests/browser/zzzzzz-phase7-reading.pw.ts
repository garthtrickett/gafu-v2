import { expect, test } from "@playwright/test";

// Writing a tale is one generation per sentence. Under the fake AI each is
// instant, so this journey is about the plumbing and the promise: every
// sentence lands, the tale's own word is marked and glossed where it is met,
// and a word worth keeping becomes a Card without leaving the page.
test.setTimeout(120_000);

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

  await page.goto("/?view=read");

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

  await momotaro.getByRole("button", { name: "Write it" }).click();
  await expect(page.getByTestId("reading")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("status")).toContainText("written in");

  // One sentence per beat, each of them shown.
  const sentences = page.getByTestId("reading-sentence");
  await expect(sentences).toHaveCount(11);

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

  // The reading was kept, so the tale can be carried on rather than rewritten.
  await page.getByRole("button", { name: "All tales" }).click();
  const again = page
    .getByTestId("tale-list")
    .locator(".bank-card[data-tale-id='momotaro']");
  await expect(again.getByRole("button", { name: "Read it" })).toBeVisible();
  await again.getByRole("button", { name: "Read it" }).click();
  await expect(page.getByTestId("reading-sentence")).toHaveCount(11);

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
