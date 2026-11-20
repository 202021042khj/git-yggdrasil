// 영어 화면: 주요 화면과 창이 영어로 나오고(사용자 데이터 말고는 한글이 없음), axe 를 통과하고, 설정에서 언어를 바꾸면 바로 바뀐다
import { expect, test, type Page } from "@playwright/test";
import { close, launch, scan, type Ctx } from "./app";

let c: Ctx;
test.beforeEach(async () => { c = await launch("en"); });
test.afterEach(async () => { await close(c); });

const HANGUL = /[가-힣]+/g;
/** 시험 저장소의 커밋 메시지 (사용자 데이터라 한글이어도 된다) */
const USER_DATA = ["f1 기능", "f2 앱 바꾸기"];

/** 화면에 보이는 글자 + 화면 낭독기가 읽는 이름(aria-label) + 마우스 설명(title) 에 남은 한글 */
async function leftoverHangul(page: Page, root = "body"): Promise<string[]> {
  // 시험 코드는 DOM 타입 없이 빌드하므로 문자열로 넘긴다
  const texts = await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(root)});
    const out = [el.innerText];
    el.querySelectorAll("[aria-label], [title], [placeholder], [alt]").forEach((n) => {
      for (const a of ["aria-label", "title", "placeholder", "alt"]) { const v = n.getAttribute(a); if (v) out.push(v); }
    });
    el.querySelectorAll("svg title, svg text").forEach((n) => out.push(n.textContent || ""));
    return out;
  })()`) as string[];
  return texts.flatMap((t) => {
    let rest = t;
    for (const d of USER_DATA) rest = rest.split(d).join("");
    return rest.match(HANGUL) ?? [];
  });
}

test("main screen in English: labels, no leftover Hangul, axe passes", async () => {
  const { page } = c;
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#open-repo")).toHaveText("Open");
  await expect(page.locator("#undo")).toContainText("Undo");
  await expect(page.locator("#search-open")).toHaveText("Search");
  await expect(page.locator(".trash")).toContainText("Trash");
  await expect(page.locator('.br[data-checkout="feat"]')).toHaveAttribute("aria-label", "Branch feat");
  await page.locator("#graph .node").first().click();
  await expect(page.locator("#msg-save")).toHaveText("Edit message");
  await page.locator("#help-toggle").click();
  await expect(page.locator("#help")).toContainText("Drag to see where things can go");
  expect(await leftoverHangul(page)).toEqual([]);
  await page.evaluate("Promise.all(document.getAnimations().map((a) => a.finished))");
  expect(await scan(page)).toEqual([]);
});

test("dialogs in English: settings, search, clean up commits, lost commits", async () => {
  const { page } = c;
  const dbg = "globalThis.__yggDebug";
  await page.evaluate(`${dbg}.openSettings()`);
  await expect(page.locator("#settings-title")).toHaveText("Settings");
  await expect(page.locator('label[for="set-lang"]')).toHaveText("Language");
  // 언어 목록의 "한국어" 는 그 언어로 적은 이름이라 빼고 본다
  expect((await leftoverHangul(page, "#settings")).filter((h) => h !== "한국어")).toEqual([]);
  expect(await scan(page, "#settings")).toEqual([]);
  await page.keyboard.press("Escape");

  await page.keyboard.press("Meta+k");
  await page.locator("#search-input").fill("f");
  await expect(page.locator(".sr").first()).toBeVisible();
  await expect(page.locator("#search")).toContainText("Commit");
  expect(await leftoverHangul(page, "#search")).toEqual([]);
  expect(await scan(page, "#search")).toEqual([]);
  await page.keyboard.press("Escape");

  await page.evaluate(`${dbg}.contextItems({ kind: "label", branch: "feat" }).find((i) => i.label.startsWith("Clean up commits")).onPick()`);
  await expect(page.locator("#rebase-title")).toHaveText("Clean up feat (2 commits)");
  expect(await leftoverHangul(page, "#rebase")).toEqual([]);
  expect(await scan(page, "#rebase")).toEqual([]);
  await page.keyboard.press("Escape");

  await page.locator("#reflog-open").click();
  await expect(page.locator(".rl-row").first()).toBeVisible();
  await expect(page.locator("#reflog-title")).toHaveText("Find lost commits (reflog)");
  expect(await leftoverHangul(page, "#reflog")).toEqual([]);
  expect(await scan(page, "#reflog")).toEqual([]);
});

test("switching the language in Settings applies immediately", async () => {
  const { page } = c;
  await page.evaluate("globalThis.__yggDebug.openSettings()");
  await page.locator("#set-lang").click();
  await page.getByRole("option", { name: "한국어" }).click();
  await expect(page.locator("#open-repo")).toHaveText("저장소 열기");
  await expect(page.locator("#settings-title")).toHaveText("설정");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await page.locator("#set-lang").click();
  await page.getByRole("option", { name: "English" }).click();
  await expect(page.locator("#open-repo")).toHaveText("Open");
  await expect(page.locator("#graph .node").first()).toHaveAttribute("aria-label", /^Commit /);
});
