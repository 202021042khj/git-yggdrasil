import "./RemotesSection.css";

import { askText, confirmAction } from "@/components/ui/dialogUtils";
import { run } from "@/app/actions";
import GithubPublishButton from "@/components/pages/main/sections/dialogs/GithubPublishButton";
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
    const url = await askText(`${name} 주소 바꾸기`, cur);
    if (url && url !== cur) await run({ op: "remoteSetUrl", args: [name, url], summary: `원격 ${name} 주소 변경` });
  };

  const handleDelete = async (name: string) => {
    if (!confirmAction(`원격 ${name} 연결을 지울까요?\n원격 저장소 자체는 지워지지 않고, 이 폴더와의 연결과 원격 브랜치 정보만 사라집니다.`)) return;
    await run({ op: "remoteRemove", args: [name], summary: `원격 ${name} 연결 삭제` });
  };

  const handleAdd = async () => {
    const url = await askText("원격 저장소 주소", "", "예: https://github.com/아이디/저장소.git");
    if (!url) return;
    const name = await askText("원격 이름", list.some((r) => r.name === "origin") ? "upstream" : "origin");
    if (name) await run({ op: "remoteAdd", args: [name, url], summary: `원격 ${name} 추가` });
  };

  return (
    <div className="remotes-box">
      <h3>원격</h3>
      <div id="remote-list">
        {list.length
          ? list.map((r) => (
            <div key={r.name} className="remote-row" title={r.url}>
              <span className="rn">{r.name}</span><span className="ru">{r.url}</span>
              <button type="button" onClick={() => void handleEdit(r.name)}>주소</button>
              <button type="button" aria-label={`${r.name} 삭제`} onClick={() => void handleDelete(r.name)}>삭제</button>
            </div>
          ))
          : <p className="muted remote-empty">연결된 원격이 없습니다.</p>}
        {!!onlyRemote.length && (
          <div className="remote-only">
            <p className="muted">원격에만 있는 브랜치</p>
            {onlyRemote.map((r) => (
              <div key={r} className="remote-row">
                <span className="ru">{r}</span>
                <button type="button" onClick={() => void run({ op: "checkoutRemote", args: [r], summary: `${r} 를 로컬 브랜치로 가져오기` })}>가져오기</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="button" id="remote-add" className="small" onClick={() => void handleAdd()}>원격 추가</button>
      <GithubPublishButton repo={repo} hasRepo={hasRepo} />
    </div>
  );
};

export default RemotesSection;
