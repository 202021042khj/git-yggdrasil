// 조작 실행 컨텍스트: 실행 기록, 경고, 공용 도우미
import { git, type GitOptions } from "@/git/cli";
import { gitAuth } from "@/github/auth";
import { t } from "@shared/i18n/i18n";
import type { OpExtra } from "@shared/types/ipc";

/** 네트워크 명령 (fetch/pull/push/clone): 오래 걸릴 수 있고 GitHub 로그인 토큰을 붙인다 */
export const NET: GitOptions = { timeout: 120000, net: true };

export interface OpContext {
  root: string;
  extra: OpExtra;
  /** git 명령 실행 + 기록 */
  run(args: string[], opts?: GitOptions): Promise<string>;
  /** 내부 plumbing 대신 사람이 읽을 대응 명령을 기록 */
  note(line: string): void;
  /** 실패는 아니지만 알려야 할 일 */
  warn(msg: string): void;
}

// 인자는 화면에서 IPC 로 넘어온 값이라 조작마다 모양이 다르다. 각 조작이 구조 분해에서 자기 모양을 적는다.
export type OpFn = (ctx: OpContext, args: any) => Promise<void>;

export interface OpError extends Error {
  code?: string | number;
  stderr?: string;
  unsupported?: boolean;
  conflicts?: string[];
  branch?: string;
}

export function createContext(root: string, extra: OpExtra = {}) {
  const cmds: string[] = [];
  const warnings: string[] = [];
  const ctx: OpContext = {
    root,
    extra,
    async run(args, opts) {
      cmds.push("git " + args.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(" ")); // 기록에는 토큰 설정을 넣지 않는다
      if (opts?.net) {
        const auth = await gitAuth().catch(() => null);
        if (auth) return git(root, [...auth.args, ...args], { ...opts, env: { ...(opts.env || {}), ...auth.env } });
      }
      return git(root, args, opts);
    },
    note: (line) => { cmds.push(line); },
    warn: (msg) => { warnings.push(msg); cmds.push(`# ${t("m.warning", { msg })}`); },
  };
  return { ctx, cmds, warnings };
}

/** 경로 목록 → git pathspec ("" 는 저장소 전체) */
export const spec = (paths?: string[] | null) => (paths || [""]).map((p) => (p === "" ? "." : p));

export const under = (f: string, p: string) => p === "" || f === p || f.startsWith(p + "/");

export const short = (oid: string) => oid.slice(0, 7);

export async function headInfo(root: string): Promise<{ branch: string | null; tip: string | null }> {
  const branch = ((await git(root, ["symbolic-ref", "--short", "-q", "HEAD"], { allowFail: true })) || "").trim() || null;
  const tip = ((await git(root, ["rev-parse", "-q", "--verify", "HEAD"], { allowFail: true })) || "").trim() || null;
  return { branch, tip };
}

export const rev = async (root: string, r: string) => (await git(root, ["rev-parse", "--verify", `${r}^{commit}`])).trim();

export const upstreamOf = async (root: string, branch: string) =>
  ((await git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branch}@{u}`], { allowFail: true })) || "").trim();

/** 되돌릴 수 있게 브랜치 위치를 백업 ref 로 남긴다 (refs/yggdrasil/backup/...) */
export async function backup(root: string, label: string, oid: string | null): Promise<string | null> {
  if (!oid) return null;
  const ref = `refs/yggdrasil/backup/${Date.now()}-${label.replace(/[^\w.-]+/g, "_")}`;
  await git(root, ["update-ref", ref, oid]);
  return ref;
}

export function unsupported(what: string): never {
  const e: OpError = new Error(t("m.unsupported", { what }));
  e.unsupported = true;
  throw e;
}
