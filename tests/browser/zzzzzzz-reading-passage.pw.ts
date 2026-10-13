import { expect, test } from "@playwright/test";

const file = {
  name: "river-passage.json",
  mimeType: "application/json",
  buffer: Buffer.from(
    JSON.stringify({
      format: "gafu-passage",
      version: 1,
      title: "川の話",
      titleReading: "かわのはなし",
      titleEnglish: "A river story",
      paragraphs: [
        [
          {
            japanese: "女は川を眺める。",
            english: "The woman gazes at the river.",
            segments: [
              { written: "女", reading: "おんな" },
              { written: "は", reading: "は" },
              { written: "川", reading: "かわ" },
              { written: "を眺める。", reading: "をながめる。" },
            ],
          },
          { japanese: "川は輝く。", english: "The river shines." },
        ],
        [
          {
            japanese: "女は輝く川を眺める。",
            english: "She gazes at the shining river.",
          },
        ],
      ],
    }),
  ),
};

test("imports a connected passage into the Story reader and reopens it", async ({
  page,
}) => {
  for (const [lemma, reading, partOfSpeech] of [
    ["女", "おんな", "noun"],
    ["川", "かわ", "noun"],
    ["眺める", "ながめる", "verb"],
    ["輝く", "かがやく", "verb"],
  ] as const) {
    const made = await page.request.post("/api/study/cards", {
      headers: { "X-Gafu-Request": "gafu-v2" },
      data: {
        type: "vocabulary",
        content: {
          lemma,
          reading,
          partOfSpeech,
          meaning: lemma,
          usageNotes: "",
        },
      },
    });
    if (!made.ok() && made.status() !== 409) throw new Error(`card: ${made.status()}`);
    const found = await page.request.get(
      `/api/study?search=${encodeURIComponent(lemma)}`,
    );
    const bank = (await found.json()) as {
      cards: {
        id: string;
        type: string;
        state: string;
        content: { lemma?: string; reading?: string; partOfSpeech?: string };
      }[];
    };
    const card = bank.cards.find(
      (item) =>
        item.type === "vocabulary" &&
        item.content.lemma === lemma &&
        item.content.reading === reading &&
        item.content.partOfSpeech === partOfSpeech,
    );
    if (card === undefined) throw new Error(`no ${lemma} Card`);
    if (card.state === "suspended") {
      const restored = await page.request.post(`/api/study/cards/${card.id}/state`, {
        headers: { "X-Gafu-Request": "gafu-v2" },
        data: { action: "restore" },
      });
      if (!restored.ok()) throw new Error(`restore: ${restored.status()}`);
    }
    const ready = await page.request.post(`/api/study/cards/${card.id}/state`, {
      headers: { "X-Gafu-Request": "gafu-v2" },
      data: { action: "markSupportReady" },
    });
    if (!ready.ok()) throw new Error(`support-ready: ${ready.status()}`);
  }

  await page.goto("/");
  await page.getByRole("link", { name: "Read a tale" }).click();
  await page.getByLabel("Import a passage").setInputFiles(file);
  await expect(page.getByTestId("reading")).toContainText("川の話");
  const paragraphs = page.getByTestId("reading-paragraph");
  await expect(paragraphs).toHaveCount(2);
  await expect(paragraphs.first().getByTestId("reading-sentence")).toHaveCount(2);
  await expect(paragraphs.nth(1).getByTestId("reading-sentence")).toHaveCount(1);
  await expect(paragraphs.first().locator("ruby").first()).toContainText("女おんな");
  await expect(paragraphs.first().getByTestId("reading-english")).toHaveCount(0);
  await paragraphs.first().getByRole("button", { name: "Show English" }).click();
  await expect(paragraphs.first().getByTestId("reading-english")).toContainText(
    "The woman gazes at the river. The river shines.",
  );

  await page.getByRole("button", { name: "All tales" }).click();
  const imported = page.getByTestId("tale-list").locator(".bank-card", {
    hasText: "A river story",
  });
  await expect(imported).toHaveCount(1);
  await expect(imported.getByRole("button", { name: "Write it again" })).toHaveCount(0);
  await page.getByLabel("Import a passage").setInputFiles(file);
  await page.reload();
  await expect(
    page.getByTestId("tale-list").locator(".bank-card", {
      hasText: "A river story",
    }),
  ).toHaveCount(1);
  await page
    .getByTestId("tale-list")
    .locator(".bank-card", {
      hasText: "A river story",
    })
    .getByRole("button", { name: "Read it" })
    .click();
  await expect(page.getByTestId("reading-paragraph")).toHaveCount(2);

  // Narration and dialogue carry their own labels and keep one line each.
  await page.getByRole("button", { name: "All tales" }).click();
  const dialogue = JSON.parse(file.buffer.toString()) as {
    title: string;
    titleEnglish: string;
    paragraphs: { speaker?: string }[][];
  };
  dialogue.title = "川の会話";
  dialogue.titleEnglish = "River dialogue";
  for (const [index, sentence] of dialogue.paragraphs.flat().entries()) {
    sentence.speaker = ["Narrator", "Yuki", "Aki"][index] ?? "Narrator";
  }
  await page.getByLabel("Import a passage").setInputFiles({
    name: "river-dialogue.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(dialogue)),
  });
  await expect(page.getByTestId("reading-speaker")).toHaveText([
    "Narrator:",
    "Yuki:",
    "Aki:",
  ]);
  await expect(page.getByTestId("reading-sentence").first()).toHaveCSS(
    "display",
    "block",
  );
  await page
    .getByTestId("reading-paragraph")
    .first()
    .getByRole("button", { name: "Show English" })
    .click();
  await expect(page.getByTestId("reading-english")).toContainText("Yuki:");
  await page.reload();
  await page
    .getByTestId("tale-list")
    .locator(".bank-card", { hasText: "River dialogue" })
    .getByRole("button", { name: "Read it" })
    .click();
  await expect(page.getByTestId("reading-speaker")).toHaveText([
    "Narrator:",
    "Yuki:",
    "Aki:",
  ]);
});
