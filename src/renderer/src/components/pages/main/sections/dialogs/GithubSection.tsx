import "./GithubSection.css";

import { useEffect, useRef, useState } from "react";

import useModal from "@/hooks/useModal";
import useSmallStore from "@/hooks/useSmallStore";
import { cloneInto } from "@/components/pages/main/sections/shell/welcomeUtils";
import { cancelLogin, ghLoginStore, ghReposStore } from "@/components/pages/main/sections/dialogs/githubUtils";

/** GitHub 로그인 창(기기 코드) · 내 저장소 목록 창 */
const GithubSection = () => {
  const loginInfo = useSmallStore(ghLoginStore);
  const repos = useSmallStore(ghReposStore);
  const [q, setQ] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  // 로그인 창은 Esc 로 닫아도 기다리기를 멈춘다
  const loginRef = useModal(!!loginInfo, () => { if (ghLoginStore.get()) cancelLogin(); });
  const reposRef = useModal(!!repos, () => ghReposStore.set(null));

  useEffect(() => {
    if (!repos) return;
    setQ("");
    filterRef.current?.focus();
  }, [repos]);

  const term = q.trim().toLowerCase();
  const list = (repos ?? []).filter((r) => !term || r.fullName.toLowerCase().includes(term));

  return (
    <>
      <dialog id="gh-login" ref={loginRef} className="ask gh-login">
        <h2>GitHub 로그인</h2>
        <p>브라우저에서 GitHub 승인 페이지가 열렸습니다. 아래 코드를 입력하고 승인하세요. 코드는 클립보드에 복사해 두었습니다.</p>
        <output id="gh-code" className="gh-code">{loginInfo?.userCode}</output>
        <p className="muted" id="gh-login-status">승인을 기다리는 중…</p>
        <div className="ask-actions">
          <button type="button" id="gh-reopen" onClick={() => { if (loginInfo) void window.ghApi.openUrl(loginInfo.verificationUri); }}>브라우저 다시 열기</button>
          <button type="button" id="gh-cancel" onClick={cancelLogin}>취소</button>
        </div>
      </dialog>
      <dialog id="gh-repos" ref={reposRef} className="ask gh-repos">
        <h2>내 GitHub 저장소</h2>
        <input id="gh-filter" ref={filterRef} type="search" placeholder="이름으로 찾기" aria-label="저장소 이름으로 찾기" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
        <div id="gh-repo-list" className="gh-repo-list">
          {list.length
            ? list.map((r) => (
              <button key={r.fullName} type="button" className="gh-repo" onClick={() => { reposRef.current?.close(); void cloneInto(r.cloneUrl); }}>
                <span className="n">{r.fullName}{r.private && " · 비공개"}</span>
                <span className="d">{r.description || ""}</span>
              </button>
            ))
            : <p className="muted">찾는 저장소가 없습니다.</p>}
        </div>
        <div className="ask-actions"><button type="button" id="gh-repos-close" onClick={() => reposRef.current?.close()}>닫기</button></div>
      </dialog>
    </>
  );
};

export default GithubSection;
