// 접근성 자동 점검 (axe): 주요 화면과 창에서 WCAG 2.2 AA 위반이 없는지
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { close, launch, type Ctx } from "./app";

let c: Ctx;
test.beforeEach(async () => { c = await launch(); });
test.afterEach(async () => { await close(c); });

// Electron 은 새 페이지를 열 수 없어 AxeBuilder 대신 axe-core 를 직접 넣어 돌린다 (CSP 와 무관한 evaluate)
const AXE = fs.readFileSync(path.join(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8");
interface Violation { id: string; impact: string; help: string; nodes: Array<{ target: string[] }> }

async function scan(page: Page, include?: string): Promise<string[]> {
  await page.evaluate(AXE);
  const violations = await page.evaluate(async (sel) => {
    const axe = (globalThis as unknown as { axe: { run(ctx: unknown, opts: unknown): Promise<{ violations: Violation[] }> } }).axe;
    const r = await axe.run({ include: [sel ?? "html"] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target })) }));
  }, include ?? null);
  return violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join("\n    ")}`);
}

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
