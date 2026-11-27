// 커밋 서명 (GPG / SSH). 개인 키·암호는 앱이 다루지 않는다: gpg-agent · ssh-agent 에 맡긴다.
// commit-tree 는 commit.gpgsign 을 따르지 않으므로, 앱이 commit-tree 로 만드는 커밋은 모두 여기를 거쳐 -S 를 붙인다.
import { git, type GitOptions } from "@/git/cli";
import { t } from "@shared/i18n/i18n";
import type { SignatureInfo, SigningInfo } from "@shared/types/ipc";

const get = async (root: string, key: string, type?: "bool") =>
  ((await git(root, ["config", ...(type ? [`--type=${type}`] : []), "--get", key], { allowFail: true })) || "").trim();

/** 저장소에 실제로 적용되는 서명 설정 (전역 + 저장소 설정을 git 이 합친 값). localEnabled: 저장소 설정에 따로 정해 둔 값 */
export async function signingInfo(root: string): Promise<SigningInfo> {
  const enabled = (await get(root, "commit.gpgsign", "bool")) === "true";
  const format = (await get(root, "gpg.format")) || "openpgp";
  const key = await get(root, "user.signingkey");
  const local = ((await git(root, ["config", "--local", "--type=bool", "--get", "commit.gpgsign"], { allowFail: true })) || "").trim();
  return { enabled, format, key, local: local === "true" ? true : local === "false" ? false : null };
}

/** 서명을 켰으면 commit-tree 에 붙일 인자 (키는 user.signingkey 를 git 이 읽는다) */
export async function signArgs(root: string): Promise<string[]> {
  return (await signingInfo(root)).enabled ? ["-S"] : [];
}

/** 서명 실패(에이전트 없음 · pinentry 를 띄울 수 없음 · 키 없음)를 알아보기 쉬운 오류로 바꾼다 */
function signFailed(e: unknown): Error {
  const err = e as Error & { stderr?: string };
  const out = new Error(t("m.signFailed", { detail: (err.stderr || err.message || "").split("\n")[0] })) as Error & { stderr?: string };
  out.stderr = out.message;
  return out;
}

/**
 * 새 커밋 객체 만들기 (서명 설정을 따른다). run 을 주면 그 실행기(실행 기록에 남는 ctx.run)로 실행한다.
 * 서명에 실패하면 아무 ref 도 바꾸기 전에 오류를 던진다.
 */
export async function commitTree(
  root: string,
  tree: string,
  parents: string[],
  msg: string,
  opts: GitOptions & { run?: (args: string[], o?: GitOptions) => Promise<string> } = {},
): Promise<string> {
  const { run, ...gitOpts } = opts;
  const sign = await signArgs(root);
  const args = ["commit-tree", ...sign, tree, ...parents.flatMap((p) => ["-p", p]), "-m", msg];
  try {
    return (run ? await run(args, gitOpts) : await git(root, args, gitOpts)).trim();
  } catch (e) {
    throw sign.length ? signFailed(e) : e;
  }
}

/** 선택한 커밋 하나의 서명 상태 (%G?: G 확인됨 · U 신뢰 모름 · B 잘못됨 · N 서명 없음 · E 확인 불가 …) */
export async function signatureOf(root: string, id: string): Promise<SignatureInfo> {
  const out = (await git(root, ["log", "-1", "--format=%G?%x1f%GS%x1f%GK", id], { allowFail: true })) || "N";
  const [code, signer = "", key = ""] = out.trim().split("\x1f");
  const status = code === "G" ? "verified" : code === "N" || !code ? "unsigned" : code === "B" ? "bad" : "unverified";
  return { status, code: code || "N", signer, key };
}

/** 이 저장소(.git/config)에만 서명 켜기·끄기. 전역 설정은 건드리지 않는다 */
export const signingConfigArgs = (enabled: boolean) => ["config", "--local", "commit.gpgsign", String(enabled)];
