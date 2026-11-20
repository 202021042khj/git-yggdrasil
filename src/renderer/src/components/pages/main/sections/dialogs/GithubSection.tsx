import "./GithubSection.css";

import { useEffect, useRef, useState } from "react";

import useModal from "@/hooks/useModal";
import useSmallStore from "@/hooks/useSmallStore";
import { cloneInto } from "@/components/pages/main/sections/shell/welcomeUtils";
import { cancelLogin, ghLoginStore, ghReposStore } from "@/components/pages/main/sections/dialogs/githubUtils";
import { t } from "@shared/i18n/i18n";

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
        <h2>{t("gh.login")}</h2>
        <p>{t("gh.deviceIntro")}</p>
        <output id="gh-code" className="gh-code">{loginInfo?.userCode}</output>
        <p className="muted" id="gh-login-status">{t("gh.waiting")}</p>
        <div className="ask-actions">
          <button type="button" id="gh-reopen" onClick={() => { if (loginInfo) void window.ghApi.openUrl(loginInfo.verificationUri); }}>{t("gh.reopen")}</button>
          <button type="button" id="gh-cancel" onClick={cancelLogin}>{t("common.cancel")}</button>
        </div>
      </dialog>
      <dialog id="gh-repos" ref={reposRef} className="ask gh-repos">
        <h2>{t("gh.myRepos")}</h2>
        <input id="gh-filter" ref={filterRef} type="search" placeholder={t("gh.filter")} aria-label={t("gh.filterAria")} autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
        <div id="gh-repo-list" className="gh-repo-list">
          {list.length
            ? list.map((r) => (
              <button key={r.fullName} type="button" className="gh-repo" onClick={() => { reposRef.current?.close(); void cloneInto(r.cloneUrl); }}>
                <span className="n">{r.fullName}{r.private && t("gh.private")}</span>
                <span className="d">{r.description || ""}</span>
              </button>
            ))
            : <p className="muted">{t("gh.noRepos")}</p>}
        </div>
        <div className="ask-actions"><button type="button" id="gh-repos-close" onClick={() => reposRef.current?.close()}>{t("common.close")}</button></div>
      </dialog>
    </>
  );
};

export default GithubSection;
