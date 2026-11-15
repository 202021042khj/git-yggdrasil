// 키보드만으로: 그래프 탐색 · 커밋 고르기 · 메뉴로 복사 · 브랜치 전환 (WCAG 2.1.1 키보드, 2.5.7 끌기 대안)
import { expect, test, type Page } from "@playwright/test";
import { close, git, launch, type Ctx } from "./app";

let c: Ctx;
test.beforeEach(async () => { c = await launch(); });
test.afterEach(async () => { await close(c); });

const focusedLabel = (page: Page): Promise<string> =>
  page.evaluate('document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? ""');

test("그래프: Tab 으로 들어가 화살표로 움직이고, Enter 로 고르고, Shift+F10 메뉴로 다른 브랜치에 복사", async () => {
  const { page, repo } = c;
  // 그래프 안에서 Tab 으로 닿는 커밋은 하나 (지금 체크아웃한 커밋)
  await expect(page.locator('#graph .node[tabindex="0"]')).toHaveCount(1);
  await page.locator('#graph .node[tabindex="0"]').focus();
  expect(await focusedLabel(page)).toMatch(/^커밋 m1, .*지금 체크아웃/);

  await page.keyboard.press("ArrowDown"); // 아래 줄기(feat)로
  await page.keyboard.press("Home");      // 줄기의 처음
  expect(await focusedLabel(page)).toMatch(/^커밋 f1 기능, .*feat 줄기/);
  await page.keyboard.press("Enter");
  await expect(page.locator("#msg-input")).toHaveValue("f1 기능");
  expect(await focusedLabel(page)).toMatch(/^커밋 f1 기능/); // 다시 그려도 초점 유지

  await page.keyboard.press("Shift+F10");
  const menu = page.locator("#v2-menu");
  await expect(menu).toBeVisible();
  for (let i = 0; i < 20 && !(await focusedLabel(page)).includes("main 브랜치에 복사"); i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect.poll(() => git(repo, "log", "-1", "--format=%s", "main")).toBe("f1 기능");
});

test("사이드바 브랜치: Tab 으로 닿고 Enter 로 체크아웃, Shift+F10 으로 메뉴", async () => {
  const { page, repo } = c;
  const feat = page.locator('.br[data-checkout="feat"]');
  await feat.focus();
  expect(await focusedLabel(page)).toBe("브랜치 feat");
  await page.keyboard.press("Enter");
  await expect.poll(() => git(repo, "branch", "--show-current")).toBe("feat");
  await expect(page.locator('.br[data-checkout="feat"]')).toHaveAttribute("aria-label", "브랜치 feat, 체크아웃됨");
  await page.locator('.br[data-checkout="main"]').focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.locator("#v2-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#v2-menu")).toBeHidden();
  expect(await focusedLabel(page)).toBe("브랜치 main"); // 메뉴를 닫으면 초점이 돌아온다
});

test("드롭다운: 화살표로 열고 고르면 select 값과 change 가 따라오고, Esc 는 목록만 닫는다", async () => {
  const { page } = c;
  const btn = page.locator("#filter-since + .dd-btn, .dd:has(#filter-since) .dd-btn");
  await btn.focus();
  expect(await focusedLabel(page)).toBe("기간: 전체 기간");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(btn).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeHidden();
  expect(await page.evaluate('document.getElementById("filter-since").value')).toBe("7");
  expect(await focusedLabel(page)).toBe("기간: 최근 1주");
  await expect(page.locator("#filter-clear")).toBeVisible(); // change 이벤트로 필터가 걸림

  // 설정 창 안: Esc 는 목록만 닫고 창은 남는다
  await page.evaluate("window.__yggDebug.openSettings()");
  const theme = page.locator(".dd:has(#set-theme) .dd-btn");
  await theme.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(page.locator("#settings")).toBeVisible();
});
