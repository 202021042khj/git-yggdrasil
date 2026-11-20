import "./RemotesSection.css";

import { askText, confirmAction } from "@/components/ui/dialogUtils";
import { run } from "@/app/actions";
import GithubPublishButton from "@/components/pages/main/sections/dialogs/GithubPublishButton";
import { t } from "@shared/i18n/i18n";
import type { RepoState } from "@shared/types/repo";

interface RemotesSectionProps {
  repo: RepoState;
  hasRepo: boolean;
}

/** 원격: 목록 · 추가 · 주소 변경 · 연결 삭제 · 원격에만 있는 브랜치 가져오기 · GitHub 에 새 저장소로 올리기 */
const RemotesSection = ({ repo, hasRepo }: RemotesSectionProps) => {
  const list = repo.remoteList || [];
  const onlyRemote = Object.keys(repo.remotes).filter((r) => !repo.branches[r.split("/").slice(1).join("/")]);

  const handleEdit = async (name: string) => {
    const cur = list.find((r) => r.name === name)?.url || "";
    const url = await askText(t("rm.editUrl", { name }), cur);
    if (url && url !== cur) await run({ op: "remoteSetUrl", args: [name, url], summary: t("rm.editSummary", { name }) });
  };

  const handleDelete = async (name: string) => {
    if (!confirmAction(t("rm.confirmRemove", { name }))) return;
    await run({ op: "remoteRemove", args: [name], summary: t("rm.removeSummary", { name }) });
  };

  const handleAdd = async () => {
    const url = await askText(t("act.remoteUrl"), "", t("rm.urlHint"));
    if (!url) return;
    const name = await askText(t("rm.name"), list.some((r) => r.name === "origin") ? "upstream" : "origin");
    if (name) await run({ op: "remoteAdd", args: [name, url], summary: t("rm.addSummary", { name }) });
  };

  return (
    <div className="remotes-box">
      <h3>{t("rm.title")}</h3>
      <div id="remote-list">
        {list.length
          ? list.map((r) => (
            <div key={r.name} className="remote-row" title={r.url}>
              <span className="rn">{r.name}</span><span className="ru">{r.url}</span>
              <button type="button" onClick={() => void handleEdit(r.name)}>{t("rm.url")}</button>
              <button type="button" aria-label={t("rm.removeAria", { name: r.name })} onClick={() => void handleDelete(r.name)}>{t("rm.remove")}</button>
            </div>
          ))
          : <p className="muted remote-empty">{t("pv.noRemote")}</p>}
        {!!onlyRemote.length && (
          <div className="remote-only">
            <p className="muted">{t("rm.remoteOnly")}</p>
            {onlyRemote.map((r) => (
              <div key={r} className="remote-row">
                <span className="ru">{r}</span>
                <button type="button" onClick={() => void run({ op: "checkoutRemote", args: [r], summary: t("ctx.trackSummary", { remote: r }) })}>{t("rm.track")}</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="button" id="remote-add" className="small" onClick={() => void handleAdd()}>{t("rm.add")}</button>
      <GithubPublishButton repo={repo} hasRepo={hasRepo} />
    </div>
  );
};

export default RemotesSection;
