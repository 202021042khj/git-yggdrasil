// 접근성 자동 점검 (axe): 주요 화면과 창에서 WCAG 2.2 AA 위반이 없는지
import { expect, test } from "@playwright/test";
import { close, launch, scan, type Ctx } from "./app";

let c: Ctx;
test.beforeEach(async () => { c = await launch(); });
test.afterEach(async () => { await close(c); });

for (const theme of ["dark", "light"] as const) {
  test(`메인 화면 (${theme})`, async () => {
    await c.page.emulateMedia({ colorScheme: theme });
    await c.page.locator(`#graph .node`).first().click();
    // 색 모드를 바꾼 직후에는 버튼 배경 transition 이 진행 중이라, 끝난 뒤의 색으로 대비를 잰다
    await c.page.evaluate("Promise.all(document.getAnimations().map((a) => a.finished))");
    expect(await scan(c.page)).toEqual([]);
  });
}

test("창들: 설정 · 찾기 · 커밋 정리 · 예전 커밋", async () => {
  const { page } = c;
  const dbg = "globalThis.__yggDebug";
  await page.evaluate(`${dbg}.openSettings()`);
  expect(await scan(page, "#settings")).toEqual([]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+k");
  await page.locator("#search-input").fill("f");
  await expect(page.locator(".sr").first()).toBeVisible();
  expect(await scan(page, "#search")).toEqual([]);
  await page.keyboard.press("Escape");
  await page.evaluate(`${dbg}.contextItems({ kind: "label", branch: "feat" }).find((i) => i.label.startsWith("커밋 정리")).onPick()`);
  expect(await scan(page, "#rebase")).toEqual([]);
  await page.keyboard.press("Escape");
  await page.locator("#reflog-open").click();
  await expect(page.locator(".rl-row").first()).toBeVisible();
  expect(await scan(page, "#reflog")).toEqual([]);
});
