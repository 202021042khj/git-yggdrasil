// 조작 실행: 화면에서 고른 조작을 메인 프로세스로 보내 실제 git 으로 실행하고 결과를 반영한다
import { ALLOWED_DURING_OP } from "@/constants/ops";
import { errorText } from "@/lib/html";
import { ownerBranch, stems } from "@/model/graph";
import { touchesPushed, type Preview } from "@/model/preview";
import { show } from "@/app/repoSession";
import { store } from "@/app/store";
import { askText, confirmAction, showNotice } from "@/ui/dialog";
import { askCredential } from "@/ui/credentialDialog";
import { toast } from "@/ui/toast";
import type { OpExtra, OpName } from "@shared/types/ipc";
import type { RepoState } from "@shared/types/repo";

export interface RunRequest {
  op: OpName;
  args: unknown[];
  summary: string;
  extra?: OpExtra;
}

export const OP_BLOCK_MSG = "⏸ 멈춘 작업이 있습니다. 위 배너에서 해결 후 계속하거나 중단하세요.";

/** 진행 중 작업이 있으면 막고 알린다 */
export function blocked(op?: OpName): boolean {
  if (!store.repo.op || (op && ALLOWED_DURING_OP.has(op))) return false;
  toast(OP_BLOCK_MSG);
  return true;
}

/** 히스토리 조작에 필요한 줄기 정보 (어느 브랜치의 커밋인지, 줄기가 어디서 시작하는지) */
export function extraFor(op: OpName, args: unknown[], s: RepoState): OpExtra {
  const st = stems(s);
  if (op === "moveCommit" || op === "dropCommit" || op === "squash") return { from: ownerBranch(s, args[0] as string, st) };
  if (op === "rebaseStem") return { base: st.stems[args[0] as string]?.base };
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
    && !confirmAction("작업 영역의 변경까지 모두 버리고 되돌립니다 (git reset --hard).\n버린 변경은 되돌리기(⌘Z)로도 복구되지 않습니다. 계속할까요?")) return false;
  if (op === "discard" && !confirmAction("변경을 버립니다. 버린 변경은 되돌리기(⌘Z)로 복구되지 않습니다. 계속할까요?")) return false;
  if (touchesPushed(s, res) && !confirmAction(`${res.summary}\n\npush 된 히스토리를 다시 씁니다 (이후 force push 필요). 계속할까요?`)) return false;
  return true;
}

export async function runPreviewed(op: OpName, args: unknown[], res: Preview): Promise<void> {
  if (blocked(op) || !confirmPreviewed(op, args, res)) return;
  const conflictNote = res.conflicts.length ? ` (충돌 예상: ${res.conflicts.join(", ")})` : "";
  await run({ op, args, summary: res.summary + conflictNote, extra: { force: !!res.force } });
}

/** 실제 실행. 원격이 없거나 체크아웃이 필요하면 사용자에게 물어 이어서 진행한다 */
export async function run(req: RunRequest, retried = false): Promise<boolean> {
  if (store.ui.busy) { toast("이전 작업이 아직 실행 중입니다."); return false; }
  if (!retried && blocked(req.op)) return false;
  const extra = { ...extraFor(req.op, req.args, store.repo), ...req.extra };
  store.update({ busy: true });
  document.body.classList.add("busy");
  toast(`실행 중… ${req.summary}`);
  let followUp: (() => Promise<unknown>) | null = null;
  let ok = false;
  try {
    const r = await window.gitApi.run(req.op, req.args, extra);
    ok = r.ok;
    if (r.ok && r.undoable !== undefined) store.update({ undoCount: r.undoable, redoCount: r.redoable ?? 0 });
    if (r.ok) {
      store.addLog({ summary: req.summary, cmd: r.cmds.join("\n") });
      toast(r.warnings?.length ? `${req.summary} — ${r.warnings.join(" ")}` : req.summary);
    } else {
      const label = r.unsupported ? "아직 지원 안 함" : r.code === "NEEDS_CHECKOUT" ? "충돌 — 체크아웃 필요" : "실패";
      store.addLog({ summary: `${label}: ${req.summary}`, cmd: [...r.cmds, r.error, ...(r.hint ? [`# ${r.hint.title}`] : [])].join("\n") });
      const otherHost = r.code === "AUTH_REQUIRED" && r.authUrl && !/^https:\/\/github\.com$/.test(r.authUrl);
      if (r.hint && !otherHost) showNotice(r.hint.title, r.hint.fix, r.error);
      else toast(r.error || "실패했습니다.");
    }
    if (r.repo) show(r.repo);
    // 체크아웃하지 않은 브랜치에서 충돌: 체크아웃한 뒤 같은 조작을 다시 해서 충돌 해결 모드로 들어간다
    if (r.code === "NEEDS_CHECKOUT" && !retried && r.branch) {
      const branch = r.branch;
      followUp = async () => {
        if (!confirmAction(`${r.error}\n\n${branch} 로 체크아웃하고 다시 진행할까요? 충돌 지점에서 멈추면 오른쪽 패널에서 해결할 수 있습니다.`)) return;
        if (await run({ op: "checkout", args: [branch], summary: `${branch} 로 전환` }, true)) await run(req, true);
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
        const url = await askText("원격 저장소 주소", "", "예: https://github.com/아이디/저장소.git — origin 으로 추가한 뒤 다시 push 합니다.");
        if (url && (await run({ op: "remoteAdd", args: ["origin", url], summary: `원격 origin 추가 (${url})` }, true))) await run(req, true);
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
