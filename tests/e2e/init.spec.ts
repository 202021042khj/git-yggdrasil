// git 저장소가 아닌 폴더 열기 → "git 시작하기" → git init 되고 바로 저장소로 쓰인다
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { close, launch, write } from "./app";

test("git 저장소가 아닌 폴더를 열고 git 시작하기", async () => {
  const c = await launch();
  try {
    const plain = path.join(c.tmp, "plain");
    fs.mkdirSync(plain);
    write(plain, "notes.txt", "hello\n");

    await c.page.evaluate((dir) => (globalThis as unknown as { __yggDebug: { openRepo(d: string): Promise<void> } }).__yggDebug.openRepo(dir), plain);
    const panel = c.page.locator("#init-repo");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("아직 git 저장소가 아닌 폴더예요");
    await expect(panel).toContainText(plain);
    await c.page.screenshot({ path: path.join(process.env.YGG_SHOTS || c.tmp, "init-before.png") });

    await c.page.locator("#init-start").click();
    await expect(panel).toBeHidden();
    expect(fs.existsSync(path.join(plain, ".git"))).toBe(true);
    // 새 저장소의 파일이 바뀐 파일 목록에 보인다
    await expect(c.page.locator("body")).toContainText("notes.txt");
    await c.page.screenshot({ path: path.join(process.env.YGG_SHOTS || c.tmp, "init-after.png") });
  } finally {
    await close(c);
  }
});
