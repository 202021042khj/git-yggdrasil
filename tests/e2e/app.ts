// E2E 도우미: 임시 저장소를 만들고, 빌드한 앱을 따로 된 프로필로 띄워 그 저장소를 연다
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Ctx { app: ElectronApplication; page: Page; repo: string; tmp: string }

export const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
export const write = (repo: string, f: string, text: string) => fs.writeFileSync(path.join(repo, f), text);

/** main: base ─ m1 (app.txt=main) · feat: base ─ f1 (feat.txt) ─ f2 (app.txt=feat) */
export function makeRepo(tmp: string): string {
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Tester"); git(repo, "config", "user.email", "t@example.com"); git(repo, "config", "commit.gpgsign", "false");
  const commit = (msg: string, files: Record<string, string>) => { for (const [f, t] of Object.entries(files)) write(repo, f, t); git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", msg); };
  commit("base", { "app.txt": "base\n" });
  git(repo, "switch", "-q", "-c", "feat");
  commit("f1 기능", { "feat.txt": "f\n" });
  commit("f2 앱 바꾸기", { "app.txt": "feat\n" });
  git(repo, "switch", "-q", "main");
  commit("m1", { "app.txt": "main\n" });
  return repo;
}

export async function launch(): Promise<Ctx> {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ygg-e2e-")));
  const repo = makeRepo(tmp);
  const app = await electron.launch({ args: ["."], env: { ...process.env, YGG_PROFILE: path.join(tmp, "profile") } as Record<string, string> });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!(globalThis as unknown as { __yggDebug?: unknown }).__yggDebug);
  await page.evaluate((dir) => (globalThis as unknown as { __yggDebug: { openRepo(d: string): Promise<void> } }).__yggDebug.openRepo(dir), repo);
  await expect(page.locator("#graph .node")).toHaveCount(4);
  return { app, page, repo, tmp };
}

export async function close(c: Ctx): Promise<void> {
  await c.app.close();
  fs.rmSync(c.tmp, { recursive: true, force: true });
}

/** 실제 마우스로 끌어 놓기 (드래그 시작 거리를 넘기도록 여러 번에 나눠 움직인다) */
export async function dragTo(page: Page, from: string, to: string): Promise<void> {
  const a = (await page.locator(from).first().boundingBox())!;
  const b = (await page.locator(to).first().boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2 + 10, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}
