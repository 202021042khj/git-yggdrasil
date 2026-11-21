// 선택 표시: 커밋 클릭 → 선택 고리, 브랜치 이름표 클릭 → 브랜치 선택(끝 커밋 + 이름표 강조), 더블클릭 → checkout
import { expect, test } from "@playwright/test";
import path from "node:path";
import { close, git, launch } from "./app";

const shot = (c: Awaited<ReturnType<typeof launch>>, name: string) =>
  c.page.screenshot({ path: path.join(process.env.YGG_SHOTS || c.tmp, name) });

test("커밋 · 브랜치를 고르면 선택 고리와 이름표 강조가 보이고, 이름표 더블클릭은 checkout", async () => {
  const c = await launch();
  try {
    const f1 = git(c.repo, "rev-parse", "feat~1");
    await c.page.locator(`#graph .node[data-id="${f1}"]`).click();
    await expect(c.page.locator(`#graph .node[data-id="${f1}"] .sel-ring`)).toHaveCount(1);
    await expect(c.page.locator("#graph .sel-ring")).toHaveCount(1);
    await shot(c, "select-commit.png");

    const label = c.page.locator('#graph .ref.local[data-branch="feat"]');
    await label.click();
    await expect(c.page.locator('#graph .ref.local.selected[data-branch="feat"]')).toHaveCount(1);
    await expect(c.page.locator(`#graph .node[data-id="${git(c.repo, "rev-parse", "feat")}"] .sel-ring`)).toHaveCount(1);
    await expect(c.page.locator('.tree .br.selected[data-checkout="feat"]')).toHaveCount(1);
    await shot(c, "select-branch.png");

    // 다른 커밋을 고르면 브랜치 선택은 풀린다
    await c.page.locator(`#graph .node[data-id="${f1}"]`).click();
    await expect(c.page.locator("#graph .ref.selected")).toHaveCount(0);

    await c.page.locator('#graph .ref.local[data-branch="feat"]').dblclick();
    await expect.poll(() => git(c.repo, "branch", "--show-current")).toBe("feat");
  } finally {
    await close(c);
  }
});
