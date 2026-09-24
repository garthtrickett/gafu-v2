import { expect, test } from "@playwright/test";

test("a saved session with expired review permits returns its Cards to study", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("tile-review")).toBeVisible();
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opened = indexedDB.open("gafu-v2-study", 1);
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("kv", "readwrite");
      transaction.objectStore("kv").put(
        {
          items: [
            {
              mode: "review",
              permit: { token: "expired", expiresAt: "2020-01-01T00:00:00.000Z" },
            },
            { mode: "review", permit: { token: "legacy" } },
          ],
          index: 0,
        },
        "session",
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();
  await expect(page.getByRole("status")).toContainText(
    "Your saved review session expired. Those Cards remain due",
  );
  await expect(page.getByRole("button", { name: "Explanation" })).toHaveCount(0);
});

test("a saved bare grammar fallback is not shown again", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("tile-review")).toBeVisible();
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opened = indexedDB.open("gafu-v2-study", 1);
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("kv", "readwrite");
      transaction.objectStore("kv").put(
        {
          items: [
            {
              mode: "review",
              material: {
                targetKind: "grammar",
                target: { canonicalForm: "〜かというと" },
                japanese: "〜かというと",
                prompt: "What does this word mean?",
              },
              permit: { token: "old", expiresAt: "2099-01-01T00:00:00.000Z" },
            },
          ],
          index: 0,
        },
        "session",
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Explanation" })).toHaveCount(0);
});
