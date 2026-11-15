import "./ReflogSection.css";

import { useState, type MouseEvent } from "react";

import useModal from "@/hooks/useModal";
import useSmallStore from "@/hooks/useSmallStore";
import { askText, confirmAction } from "@/components/ui/dialogUtils";
import { openMenu, type MenuItem } from "@/components/ui/menuUtils";
import { short } from "@/lib/html";
import { fullTime, relTime } from "@/lib/time";
import { run } from "@/app/actions";
import { store } from "@/app/store";
import { revealCommit } from "@/components/pages/main/sections/canvas/canvasUtils";
import { openReflog, reflogStore } from "@/components/pages/main/sections/dialogs/reflogUtils";
import type { ReflogEntry } from "@shared/types/ipc";

/** 예전 커밋 찾기 (reflog): 되돌리기 기록 밖에서 사라진 커밋을 찾아 브랜치로 살리거나 가져온다 */
const ReflogSection = () => {
  const { open, loading, error, entries } = useSmallStore(reflogStore);
  const [onlyLost, setOnlyLost] = useState(false);
  const ref = useModal(open, () => reflogStore.set((r) => ({ ...r, open: false })));
  const list = onlyLost ? entries.filter((e) => e.lost) : entries;

  const entryMenu = (e: ReflogEntry, ev: MouseEvent<HTMLButtonElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const s = store.repo;
    const head = s.head && s.branches[s.head] ? s.head : null;
    const items: MenuItem[] = [];
    if (s.commits[e.id]) items.push({ label: "그래프에서 보기", cmd: "", onPick: () => { ref.current?.close(); revealCommit(e.id); } });
    items.push({
      label: "여기서 새 브랜치로 살리기…", cmd: `git branch <이름> ${short(e.id)}`,
      onPick: async () => {
        const name = await askText("살릴 브랜치 이름", `rescue/${short(e.id)}`, "이 커밋을 끝으로 하는 브랜치를 만듭니다. 작업 영역은 그대로입니다.");
        if (name && (await run({ op: "createBranch", args: [name, e.id], summary: `예전 커밋 ${short(e.id)} 를 브랜치 ${name} 로 살리기` }))) void openReflog();
      },
    });
    if (head) {
      items.push({
        label: `${head} 에 이 커밋만 복사 (cherry-pick)`, cmd: `git cherry-pick ${short(e.id)}`,
        onPick: async () => { if (await run({ op: "cherryPick", args: [[e.id], head], summary: `예전 커밋 ${short(e.id)} 를 ${head} 에 복사` })) void openReflog(); },
      });
      items.push({
        label: `${head} 를 이 커밋으로 되돌리기…`, cmd: `git reset --keep ${short(e.id)}`,
        onPick: async () => {
          if (!confirmAction(`${head} 브랜치를 ${short(e.id)} "${e.subject}" 로 옮깁니다.\n파일도 그 커밋 상태로 바뀝니다. 커밋하지 않은 변경과 겹치면 git 이 거절하니 변경은 안전합니다.\n지금 끝에 있는 커밋은 reflog 와 앱 백업에 남아 이 창에서 다시 찾을 수 있습니다. 계속할까요?`)) return;
          if (await run({ op: "resetHead", args: [e.id, "keep"], summary: `${head} 를 예전 커밋 ${short(e.id)} 로 되돌리기` })) void openReflog();
        },
      });
    }
    openMenu(r.left + 40, r.bottom, `${short(e.id)} ${e.subject}`, items);
  };

  return (
    <dialog id="reflog" ref={ref} className="ask reflog" aria-labelledby="reflog-title">
      <div className="pr-head">
        <h2 id="reflog-title">예전 커밋 찾기 (reflog)</h2>
        <label className="muted"><input type="checkbox" id="reflog-lost" checked={onlyLost} onChange={(e) => setOnlyLost(e.target.checked)} /> 잃어버린 커밋만</label>
      </div>
      <p className="muted reflog-help">HEAD 가 거쳐 간 모든 커밋과 앱이 히스토리를 바꾸기 전에 남긴 백업입니다. <b>잃어버림</b> 표시는 어느 브랜치에서도 닿지 않는 커밋이라, 브랜치로 살려 두지 않으면 언젠가 git 이 지웁니다.</p>
      <div id="reflog-list" className="reflog-list">
        {loading && !entries.length ? <p className="muted">불러오는 중…</p>
          : error ? <p className="muted">{error}</p>
          : list.length
            ? list.map((e, i) => (
              <button key={`${e.id}-${i}`} type="button" className={`rl-row${e.lost ? " lost" : ""}`} aria-haspopup="menu" onClick={(ev) => entryMenu(e, ev)}>
                <span className="rl-when" title={fullTime(e.date)}>{relTime(e.date)}</span>
                <span className="rl-main">
                  <span className="rl-subject">{e.subject}</span>
                  <span className="muted rl-what">{e.action}{e.detail && ` · ${e.detail}`}</span>
                </span>
                <code className="rl-id">{short(e.id)}</code>
                {e.lost && <span className="pr-badge bad">잃어버림</span>}
              </button>
            ))
            : <p className="muted">{onlyLost ? "잃어버린 커밋이 없습니다. 모든 기록이 브랜치·태그에서 닿습니다." : "기록이 없습니다."}</p>}
      </div>
      <div className="ask-actions"><button type="button" id="reflog-close" onClick={() => ref.current?.close()}>닫기</button></div>
    </dialog>
  );
};

export default ReflogSection;
