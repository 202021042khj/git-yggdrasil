// git hook: 어느 hook 이 설치돼 있는지 읽고, 앱이 commit-tree 로 만드는 커밋에도 git 과 같은 hook 을 돌린다.
// commit-tree 는 hook 을 돌리지 않으므로, 사용자가 새로 쓴 커밋(다른 브랜치에 커밋 · 메시지 수정 · 커밋 정리의 메시지)은
// 여기서 commit-msg (와 index 로 만드는 커밋이면 pre-commit) 를 직접 실행한다. hook 이 실패하면 아무것도 바꾸기 전에 멈춘다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { git } from "@/git/cli";
import { t } from "@shared/i18n/i18n";
import type { HookInfo } from "@shared/types/ipc";

/** 화면에 보여 줄 hook (git 이 커밋·push 때 부르는 것 위주) */
export const KNOWN_HOOKS = ["pre-commit", "prepare-commit-msg", "commit-msg", "post-commit", "pre-push", "pre-rebase", "post-checkout", "post-merge", "pre-merge-commit"];

/** 이 저장소에서만 hook 을 건너뛰는 설정 (.git/config). git 의 --no-verify 와 같다 */
const SKIP_KEY = "yggdrasil.skipHooks";

/** hook 폴더 (core.hooksPath 를 따른다). 상대 경로면 저장소 최상위 기준 */
export async function hooksDir(root: string): Promise<string> {
  const p = (await git(root, ["rev-parse", "--git-path", "hooks"])).trim();
  return path.resolve(root, p);
}

const executable = (file: string) => {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

export async function skipHooks(root: string): Promise<boolean> {
  return ((await git(root, ["config", "--local", "--type=bool", "--get", SKIP_KEY], { allowFail: true })) || "").trim() === "true";
}

export const skipHooksConfigArgs = (on: boolean) => ["config", "--local", SKIP_KEY, String(on)];

/** 설치된 hook 과 hook 폴더 (설정 창에 보여 준다) */
export async function hookInfo(root: string): Promise<HookInfo> {
  const dir = await hooksDir(root);
  const configured = ((await git(root, ["config", "--get", "core.hooksPath"], { allowFail: true })) || "").trim() || null;
  const hooks = KNOWN_HOOKS.filter((name) => fs.existsSync(path.join(dir, name))).map((name) => ({ name, executable: executable(path.join(dir, name)) }));
  return { dir, configured, husky: !!configured && /(^|[\\/])\.husky([\\/]|$)/.test(configured), hooks, skip: await skipHooks(root) };
}

export interface HookError extends Error {
  stderr?: string;
  hook?: string;
}

/** hook 하나 실행. 없거나 실행 권한이 없으면 git 처럼 건너뛴다. 실패하면 hook 출력을 담은 오류 */
export async function runHook(root: string, name: string, args: string[] = [], env: Record<string, string> = {}): Promise<boolean> {
  const file = path.join(await hooksDir(root), name);
  if (!executable(file)) return false;
  await new Promise<void>((resolve, reject) => {
    execFile(file, args, { cwd: root, timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_EDITOR: ":", ...env } }, (err, stdout, stderr) => {
      if (!err) return resolve();
      const output = `${stdout || ""}${stderr || ""}`.trim() || err.message;
      const e: HookError = new Error(t("m.hookFailed", { hook: name, output }));
      e.stderr = e.message;
      e.hook = name;
      reject(e);
    });
  });
  return true;
}

/**
 * commit-msg hook: 임시 파일에 메시지를 쓰고 hook 에 넘긴 뒤, hook 이 고친 메시지를 돌려준다 (git 과 같다).
 * skip 이면 메시지를 그대로 돌려준다.
 */
export async function commitMsgHook(root: string, msg: string, skip?: boolean): Promise<string> {
  if (skip ?? (await skipHooks(root))) return msg;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-msg-"));
  const file = path.join(dir, "COMMIT_EDITMSG");
  try {
    fs.writeFileSync(file, msg.endsWith("\n") ? msg : msg + "\n");
    if (!(await runHook(root, "commit-msg", [file]))) return msg;
    const out = fs.readFileSync(file, "utf8").replace(/\n+$/, "");
    if (!out.trim()) throw Object.assign(new Error(t("m.hookEmptyMsg")), { stderr: t("m.hookEmptyMsg") });
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** pre-commit hook (index 로 새 커밋을 만들 때). indexFile 을 주면 그 index 를 보게 한다 */
export async function preCommitHook(root: string, indexFile?: string, skip?: boolean): Promise<void> {
  if (skip ?? (await skipHooks(root))) return;
  await runHook(root, "pre-commit", [], indexFile ? { GIT_INDEX_FILE: indexFile } : {});
}

/**
 * git commit · push 가 실패했을 때: 그 명령이 부르는 hook 이 설치돼 있으면 hook 이 막았을 수 있다고 표시한다
 * (git 은 hook 출력만 stderr 에 남기므로, 오류 안내에서 hook 상태를 보라고 알려 주기 위해).
 */
export async function withHooks<T>(root: string, names: string[], fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const err = e as HookError;
    if (!(await skipHooks(root).catch(() => true))) {
      const dir = await hooksDir(root).catch(() => null);
      const hit = dir && names.find((n) => executable(path.join(dir, n)));
      if (hit) err.hook = hit;
    }
    throw err;
  }
}

/** git commit · push 에 붙일 인자 (건너뛰기 설정이면 --no-verify) */
export async function verifyArgs(root: string): Promise<string[]> {
  return (await skipHooks(root)) ? ["--no-verify"] : [];
}
