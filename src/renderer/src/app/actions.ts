// 조작 실행: 화면에서 고른 조작을 메인 프로세스로 보내 실제 git 으로 실행하고 결과를 반영한다
import { ALLOWED_DURING_OP } from "@/constants/ops";
import { errorText } from "@/lib/html";
import { ownerBranch, stems } from "@/model/graph";
import { touchesPushed, type Preview } from "@/model/preview";
import { open, show } from "@/app/repoSession";
import { store } from "@/app/store";
import { askText, confirmAction, showNotice } from "@/components/ui/dialogUtils";
import { askCredential } from "@/components/ui/credentialUtils";
import { toast } from "@/components/ui/toastUtils";
import { t } from "@shared/i18n/i18n";
import type { OpExtra, OpName, RunResult } from "@shared/types/ipc";
import type { RepoState } from "@shared/types/repo";

export interface RunRequest {
  op: OpName;
  args: unknown[];
  summary: string;
  extra?: OpExtra;
  /** repo:run 대신 부를 IPC (패치 저장·적용처럼 main 이 창을 띄워 경로를 고르는 조작) */
  invoke?: () => Promise<RunResult>;
}

export const opBlockMsg = () => t("act.blocked");

/** 진행 중 작업이 있으면 막고 알린다 */
export function blocked(op?: OpName): boolean {
  if (!store.repo.op || (op && ALLOWED_DURING_OP.has(op))) return false;
  toast(opBlockMsg());
  return true;
}

/** 히스토리 조작에 필요한 줄기 정보 (어느 브랜치의 커밋인지, 줄기가 어디서 시작하는지) */
export function extraFor(op: OpName, args: unknown[], s: RepoState): OpExtra {
  const st = stems(s);
  if (op === "moveCommit" || op === "dropCommit" || op === "squash") return { from: ownerBranch(s, args[0] as string, st) };
  if (op === "rebaseStem" || op === "rebasePlan") return { base: st.stems[args[0] as string]?.base };
  if (op === "reorder") {
    const stem = st.stems[args[1] as string];
    return { stem: stem?.ids, base: stem?.base };
  }
  return {};
}

/** 미리보기가 있는 조작: 공유 히스토리 재작성·되돌릴 수 없는 조작은 먼저 확인 */
export function confirmPreviewed(op: OpName, args: unknown[], res: Preview): boolean {
  const s = store.repo;
  if (op === "resetHead" && args[1] === "hard"
    && !confirmAction(t("act.confirmHard"))) return false;
  if (op === "discard" && !confirmAction(t("act.confirmDiscard"))) return false;
  if (touchesPushed(s, res) && !confirmAction(t("act.confirmRewrite", { summary: res.summary }))) return false;
  return true;
}

export async function runPreviewed(op: OpName, args: unknown[], res: Preview): Promise<void> {
  if (blocked(op) || !confirmPreviewed(op, args, res)) return;
  const conflictNote = res.conflicts.length ? t("act.conflictNote", { files: res.conflicts.join(", ") }) : "";
  await run({ op, args, summary: res.summary + conflictNote, extra: { force: !!res.force } });
}

/** 실제 실행. 원격이 없거나 체크아웃이 필요하면 사용자에게 물어 이어서 진행한다 */
export async function run(req: RunRequest, retried = false): Promise<boolean> {
  if (store.ui.busy) { toast(t("act.busy")); return false; }
  if (!retried && blocked(req.op)) return false;
  // 다른 worktree 가 쓰는 브랜치는 git 이 체크아웃을 거절한다: 미리 알리고 그 폴더를 열지 묻는다
  if (req.op === "checkout") {
    const wt = store.repo.worktrees?.find((w) => w.branch === req.args[0] && !w.current);
    if (wt) {
      if (confirmAction(t("act.inWorktree", { branch: String(req.args[0]), path: wt.path }))) void open(window.gitApi.open(wt.path));
      return false;
    }
  }
  const extra = { ...extraFor(req.op, req.args, store.repo), ...req.extra };
  store.update({ busy: true });
  document.body.classList.add("busy");
  toast(t("act.running", { summary: req.summary }));
  let followUp: (() => Promise<unknown>) | null = null;
  let ok = false;
  try {
    const r = await (req.invoke ? req.invoke() : window.gitApi.run(req.op, req.args, extra));
    if (r.canceled) { toast(t("act.canceled")); return false; }
    ok = r.ok;
    if (r.ok && r.undoable !== undefined) store.update({ undoCount: r.undoable, redoCount: r.redoable ?? 0 });
    if (r.ok) {
      store.addLog({ summary: req.summary, cmd: r.cmds.join("\n") });
      toast(r.warnings?.length ? `${req.summary} — ${r.warnings.join(" ")}` : req.summary);
    } else {
      const summary = r.unsupported ? t("act.logUnsupported", { summary: req.summary }) : r.code === "NEEDS_CHECKOUT" ? t("act.logNeedsCheckout", { summary: req.summary }) : t("act.logFailed", { summary: req.summary });
      store.addLog({ summary, cmd: [...r.cmds, r.error, ...(r.hint ? [`# ${r.hint.title}`] : [])].join("\n") });
      const otherHost = r.code === "AUTH_REQUIRED" && r.authUrl && !/^https:\/\/github\.com$/.test(r.authUrl);
      if (r.hint && !otherHost) showNotice(r.hint.title, r.hint.fix, r.error);
      else toast(r.error || t("act.failed"));
    }
    if (r.repo) show(r.repo);
    // 체크아웃하지 않은 브랜치에서 충돌: 체크아웃한 뒤 같은 조작을 다시 해서 충돌 해결 모드로 들어간다
    if (r.code === "NEEDS_CHECKOUT" && !retried && r.branch) {
      const branch = r.branch;
      followUp = async () => {
        if (!confirmAction(t("act.needsCheckout", { error: r.error ?? "", branch }))) return;
        if (await run({ op: "checkout", args: [branch], summary: t("act.switchTo", { branch }) }, true)) await run(req, true);
      };
    }
    // GitHub 밖 HTTPS 호스트 인증 실패: 사용자 이름·토큰을 받아 git 도우미에 저장하고 다시 시도
    if (r.code === "AUTH_REQUIRED" && r.authUrl && !/^https:\/\/github\.com$/.test(r.authUrl) && !retried) {
      const url = r.authUrl;
      followUp = async () => { if (await askCredential(url)) await run(req, true); };
    }
    // 원격이 없어서 push 가 실패했으면: 주소를 받아 origin 으로 추가하고 다시 시도
    if (r.code === "NO_REMOTE" && !retried) {
      followUp = async () => {
        const url = await askText(t("act.remoteUrl"), "", t("act.remoteUrlHint"));
        if (url && (await run({ op: "remoteAdd", args: ["origin", url], summary: t("act.addOrigin", { url }) }, true))) await run(req, true);
      };
    }
  } catch (err) {
    toast(errorText(err));
  } finally {
    store.update({ busy: false });
    document.body.classList.remove("busy");
  }
  if (followUp) await followUp();
  return ok;
}
