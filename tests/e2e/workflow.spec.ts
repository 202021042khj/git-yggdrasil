// 실제 앱 화면에서 사용자가 하는 대로: 커밋 · 끌어서 복사 · 되돌리기 · 충돌 해결
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { close, dragTo, git, launch, write, type Ctx } from "./app";

let c: Ctx;
test.beforeEach(async () => { c = await launch(); });
test.afterEach(async () => { await close(c); });

test("작업 영역에서 메시지를 쓰고 커밋하면 그래프에 새 커밋이 생긴다", async () => {
  const { page, repo } = c;
  write(repo, "note.txt", "hello\n");
  await expect(page.locator(".ft-row", { hasText: "note.txt" })).toBeVisible(); // 파일 감시로 새로고침
  await page.locator("#commit-msg").fill("메모 추가");
  await page.locator("#commit-btn").click();
  await expect(page.locator("#graph .node")).toHaveCount(5);
  expect(git(repo, "log", "-1", "--format=%s")).toBe("메모 추가");
  await expect(page.locator("#log")).toContainText("메모 추가");
});

test("커밋을 다른 브랜치 이름표에 끌어 놓고 '복사' 를 고르면 cherry-pick, ⌘Z 로 되돌린다", async () => {
  const { page, repo } = c;
  const f1 = git(repo, "rev-parse", "feat~1");
  await dragTo(page, `#graph .node[data-id="${f1}"]`, '#graph [data-drag="label"][data-branch="main"]');
  const menu = page.locator("#v2-menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: /main 브랜치에 복사/ }).click();
  await expect.poll(() => git(repo, "log", "-1", "--format=%s", "main")).toBe("f1 기능");
  expect(fs.readFileSync(path.join(repo, "feat.txt"), "utf8")).toBe("f\n");

  await expect(page.locator("body")).not.toHaveClass(/busy/); // 앞 조작이 끝난 뒤에
  await page.locator("#canvas-wrap").click({ position: { x: 30, y: 400 } }); // 입력 칸 밖에서
  await page.keyboard.press("Meta+z");
  await expect.poll(() => git(repo, "log", "-1", "--format=%s", "main")).toBe("m1");
  await expect(page.locator("#redo")).toBeEnabled();
});

test("충돌이 나는 merge: 배너가 뜨고, 편집기에서 구간을 골라 해결한 뒤 계속하면 merge 커밋", async () => {
  const { page, repo } = c;
  await page.evaluate(() => (globalThis as unknown as { __yggDebug: { run(r: unknown): Promise<boolean> } }).__yggDebug.run({ op: "merge", args: ["feat", "main"], summary: "merge" }));
  await expect(page.locator("#op-banner")).toContainText("충돌");
  await page.locator("[data-cf]", { hasText: "app.txt" }).click();
  const editor = page.locator(".ce-conflict").first();
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "B 다음 A" }).click();
  await page.locator("[data-ce-save]").click();
  await page.locator('#op-banner [data-op="continue"]').click();
  await expect(page.locator("#op-banner")).toBeHidden();
  expect(fs.readFileSync(path.join(repo, "app.txt"), "utf8")).toBe("feat\nmain\n");
  expect(git(repo, "rev-list", "--parents", "-n1", "HEAD").split(" ")).toHaveLength(3);
});
