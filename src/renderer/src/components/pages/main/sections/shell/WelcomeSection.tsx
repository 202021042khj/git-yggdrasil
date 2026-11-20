import "./WelcomeSection.css";

import { useState } from "react";

import LogoMark from "@/components/common/LogoMark";
import { open, recent } from "@/app/repoSession";
import { cloneFlow } from "@/components/pages/main/sections/shell/welcomeUtils";
import { cloneFromGithub } from "@/components/pages/main/sections/dialogs/githubUtils";
import { t } from "@shared/i18n/i18n";

/** 시작 화면: 저장소 열기 · URL 로 clone · 내 GitHub 저장소에서 clone · 최근 저장소 */
const WelcomeSection = () => {
  // 열기에 실패하면(폴더가 사라짐 등) 목록을 다시 읽는다
  const [list, setList] = useState(recent);

  const handleRecent = (path: string) => void open(window.gitApi.open(path)).then(() => setList(recent()));

  return (
    <div id="welcome" className="welcome">
      <div className="welcome-card">
        <LogoMark />
        <h1>Yggdrasil</h1>
        <p className="muted">{t("welcome.intro")}</p>
        <button type="button" id="welcome-open" className="commit-btn" onClick={() => void open(window.gitApi.pick())}>{t("welcome.open")}</button>
        <button type="button" id="welcome-clone" className="clone-btn" onClick={() => void cloneFlow()}>{t("welcome.clone")}</button>
        <button type="button" id="welcome-gh" className="clone-btn" onClick={() => void cloneFromGithub()}>{t("welcome.cloneGh")}</button>
        <h3>{t("welcome.recent")}</h3>
        <div id="recent-list" className="recent-list">
          {list.length
            ? list.map((r) => (
              <button key={r} type="button" className="recent" onClick={() => handleRecent(r)}>
                <span className="r-name">{r.split("/").pop()}</span>
                <span className="r-path">{r}</span>
              </button>
            ))
            : <p className="muted">{t("welcome.noRecent")}</p>}
        </div>
      </div>
    </div>
  );
};

export default WelcomeSection;
