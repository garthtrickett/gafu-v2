import { expect, test } from "@playwright/test";
import type { PreparedMaterial } from "../../src/learning-material/generated-contracts.ts";

test("restoring a saved session checks current eligibility before showing material", async ({
  page,
}) => {
  const headers = { "X-Gafu-Request": "gafu-v2" };
  // Earlier journeys share the server and can leave a batch running.
  // This journey owns only its saved session, with no batch to append to it.
  await page.route("**/api/study/review-batch/active", async (route) => {
    await route.fulfill({ contentType: "application/json", body: "null" });
  });
  const preferences = (await (await page.request.get("/api/study")).json()).preferences;
  const ids: string[] = [];
  const create = async (lemma: string, reading: string): Promise<string> => {
    const response = await page.request.post("/api/study/cards", {
      headers,
      data: {
        type: "vocabulary",
        content: {
          lemma,
          reading,
          partOfSpeech: "noun",
          meaning: `saved session test: ${lemma}`,
          usageNotes: "",
        },
      },
    });
    expect(response.status()).toBe(201);
    const id = (await response.json()).card.id as string;
    ids.push(id);
    return id;
  };
  const prepare = async (cardId: string): Promise<PreparedMaterial> => {
    const response = await page.request.post("/api/study/session/prepare", {
      headers,
      data: { cardId },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  try {
    const configured = await page.request.put("/api/study/preferences", {
      headers,
      data: {
        newCardsPerDay: 100,
        firstReviewAfterMinutes: 30,
        speechEnabled: false,
      },
    });
    expect(configured.ok()).toBe(true);
    const suspended = await prepare(await create("紙袋", "かみぶくろ"));
    const taught = await prepare(await create("財布", "さいふ"));
    const valid = await prepare(await create("玄関", "げんかん"));
    await page.request.post(`/api/study/cards/${suspended.cardId}/state`, {
      headers,
      data: { action: "suspend" },
    });
    expect(
      (
        await page.request.post("/api/study/session/teach", {
          headers,
          data: { cardId: taught.cardId, presentationId: taught.id },
        })
      ).ok(),
    ).toBe(true);
    const stagedId = await create("封筒", "ふうとう");
    const items = [
      suspended,
      taught,
      { ...valid, id: "staged-presentation", cardId: stagedId },
      { ...valid, id: "wrong-mode", mode: "review" },
      valid,
    ];
    const check = await page.request.post("/api/study/session/resume", {
      headers,
      data: { items },
    });
    expect(check.ok()).toBe(true);
    expect(await check.json()).toEqual({ eligibleIds: [valid.id] });
    // Checking a saved session must not admit the staged Card, even with
    // admission slots available. Lower the limit before reading the bank.
    await page.request.put("/api/study/preferences", {
      headers,
      data: { newCardsPerDay: 0 },
    });
    const staged = await (
      await page.request.get(`/api/study?search=${encodeURIComponent("封筒")}`)
    ).json();
    expect(
      staged.cards.find((card: { id: string }) => card.id === stagedId).state,
    ).toBe("staged");

    await page.goto("/");
    await expect(page.getByTestId("tile-review")).toBeVisible();
    await page.evaluate(async (saved) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const opened = indexedDB.open("gafu-v2-study", 1);
        opened.onsuccess = () => resolve(opened.result);
        opened.onerror = () => reject(opened.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("kv", "readwrite");
        transaction.objectStore("kv").put({ items: saved, index: 0 }, "session");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    }, items);

    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/study/session/resume", async (route) => {
      await gate;
      await route.continue();
    });
    const checking = page.waitForRequest("**/api/study/session/resume");
    await page.reload();
    await checking;
    await expect(page.getByRole("button", { name: "Seen it — next Card" })).toHaveCount(
      0,
    );
    release();
    await expect(page.getByRole("status")).toContainText(
      "Picking up where you left off",
    );
    await expect(page.getByTestId("review-panel")).toContainText("玄関");
    await expect(page.getByTestId("review-panel")).not.toContainText("紙袋");
    // A session whose only Card has since been suspended is removed as well.
    await page.request.post(`/api/study/cards/${valid.cardId}/state`, {
      headers,
      data: { action: "suspend" },
    });
    await page.reload();
    await expect(page.getByRole("status")).toContainText(
      "Your saved session is no longer available",
    );
    await expect(page.getByRole("button", { name: "Seen it — next Card" })).toHaveCount(
      0,
    );
  } finally {
    for (const id of ids) {
      await page.request.post(`/api/study/cards/${id}/state`, {
        headers,
        data: { action: "suspend" },
      });
    }
    await page.request.put("/api/study/preferences", { headers, data: preferences });
  }
});
