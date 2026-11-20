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
import { t } from "@shared/i18n/i18n";
import RichText from "@/components/common/RichText";
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
    if (s.commits[e.id]) items.push({ label: t("rl.show"), cmd: "", onPick: () => { ref.current?.close(); revealCommit(e.id); } });
    items.push({
      label: t("rl.rescue"), cmd: `git branch ${t("ctx.ph.name")} ${short(e.id)}`,
      onPick: async () => {
        const name = await askText(t("rl.rescueName"), `rescue/${short(e.id)}`, t("rl.rescueHint"));
        if (name && (await run({ op: "createBranch", args: [name, e.id], summary: t("rl.rescueSummary", { id: short(e.id), name }) }))) void openReflog();
      },
    });
    if (head) {
      items.push({
        label: t("rl.copy", { branch: head }), cmd: `git cherry-pick ${short(e.id)}`,
        onPick: async () => { if (await run({ op: "cherryPick", args: [[e.id], head], summary: t("rl.copySummary", { id: short(e.id), branch: head }) })) void openReflog(); },
      });
      items.push({
        label: t("rl.reset", { branch: head }), cmd: `git reset --keep ${short(e.id)}`,
        onPick: async () => {
          if (!confirmAction(t("rl.confirmReset", { branch: head, id: short(e.id), subject: e.subject }))) return;
          if (await run({ op: "resetHead", args: [e.id, "keep"], summary: t("rl.resetSummary", { branch: head, id: short(e.id) }) })) void openReflog();
        },
      });
    }
    openMenu(r.left + 40, r.bottom, `${short(e.id)} ${e.subject}`, items);
  };

  return (
    <dialog id="reflog" ref={ref} className="ask reflog" aria-labelledby="reflog-title">
      <div className="pr-head">
        <h2 id="reflog-title">{t("rl.title")}</h2>
        <label className="muted"><input type="checkbox" id="reflog-lost" checked={onlyLost} onChange={(e) => setOnlyLost(e.target.checked)} /> {t("rl.onlyLost")}</label>
      </div>
      <p className="muted reflog-help"><RichText text={t("rl.help")} /></p>
      <div id="reflog-list" className="reflog-list">
        {loading && !entries.length ? <p className="muted">{t("common.loading")}</p>
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
                {e.lost && <span className="pr-badge bad">{t("rl.lost")}</span>}
              </button>
            ))
            : <p className="muted">{onlyLost ? t("rl.noLost") : t("rl.empty")}</p>}
      </div>
      <div className="ask-actions"><button type="button" id="reflog-close" onClick={() => ref.current?.close()}>{t("common.close")}</button></div>
    </dialog>
  );
};

export default ReflogSection;
