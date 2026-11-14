// 파일 diff: 공백 무시 · 길이 제한 · 새 파일 · 이미지 · 저장소 밖 경로
import { afterEach, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DIFF_MAX_LINES, fileDiff } from "@/git/diff";

let tmp: string, repo: string;
const sh = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const write = (f: string, t: string | Buffer) => fs.writeFileSync(path.join(repo, f), t);
// 1x1 PNG 두 장 (색만 다름)
const PNG_A = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const PNG_B = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-diff-"));
  repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  sh("init", "-q", "-b", "main");
  sh("config", "user.name", "T"); sh("config", "user.email", "t@example.com"); sh("config", "commit.gpgsign", "false");
  write("a.txt", "one\ntwo\n");
  write("pic.png", PNG_A);
  sh("add", "-A"); sh("commit", "-q", "-m", "base");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("공백만 바뀐 줄은 공백 무시에서 사라진다", async () => {
  write("a.txt", "one  \ntwo\n");
  assert.match((await fileDiff(repo, "a.txt", null)).text, /^\+one {2}$/m);
  assert.equal((await fileDiff(repo, "a.txt", null, { ignoreWhitespace: true })).text, "");
});

test("긴 diff 는 잘리고, full 이면 전부", async () => {
  write("a.txt", Array.from({ length: DIFF_MAX_LINES + 100 }, (_, i) => `l${i}`).join("\n") + "\n");
  const cut = await fileDiff(repo, "a.txt", null);
  assert.ok(cut.omitted > 0);
  assert.equal(cut.text.split("\n").length, DIFF_MAX_LINES);
  assert.equal((await fileDiff(repo, "a.txt", null, { full: true })).omitted, 0);
});

test("추적 안 하는 새 파일은 전체가 추가로", async () => {
  write("new.txt", "x\ny\n");
  const d = await fileDiff(repo, "new.txt", null);
  assert.equal(d.untracked, true);
  assert.match(d.text, /^\+x\n\+y$/m);
});

test("이미지: 작업 영역과 커밋 모두 전후 미리보기", async () => {
  write("pic.png", PNG_B);
  const d = await fileDiff(repo, "pic.png", null);
  assert.equal(d.binary, true);
  assert.equal(d.image?.before, `data:image/png;base64,${PNG_A.toString("base64")}`);
  assert.equal(d.image?.after, `data:image/png;base64,${PNG_B.toString("base64")}`);
  sh("commit", "-qam", "pic");
  const c = await fileDiff(repo, "pic.png", sh("rev-parse", "HEAD"));
  assert.ok(c.image?.before && c.image.after && c.image.before !== c.image.after);
});

test("저장소 밖 경로는 거부", async () => {
  await assert.rejects(fileDiff(repo, "../outside.txt", null), /저장소 밖/);
});
