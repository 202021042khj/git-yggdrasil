import "./WelcomeSection.css";

import { useState } from "react";

import LogoMark from "@/components/common/LogoMark";
import { open, recent } from "@/app/repoSession";
import { cloneFlow } from "@/components/pages/main/sections/shell/welcomeUtils";
import { cloneFromGithub } from "@/components/pages/main/sections/dialogs/githubUtils";

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
        <p className="muted">git 저장소 폴더를 열면 커밋 그래프를 보여 줍니다. 커밋을 끌어 놓아 옮기기·합치기·rebase 하고, 놓기 전에 결과를 미리 봅니다. 모든 조작은 ⌘Z 로 되돌릴 수 있습니다.</p>
        <button type="button" id="welcome-open" className="commit-btn" onClick={() => void open(window.gitApi.pick())}>저장소 폴더 열기</button>
        <button type="button" id="welcome-clone" className="clone-btn" onClick={() => void cloneFlow()}>URL 로 clone</button>
        <button type="button" id="welcome-gh" className="clone-btn" onClick={() => void cloneFromGithub()}>내 GitHub 저장소에서 clone</button>
        <h3>최근 저장소</h3>
        <div id="recent-list" className="recent-list">
          {list.length
            ? list.map((r) => (
              <button key={r} type="button" className="recent" onClick={() => handleRecent(r)}>
                <span className="r-name">{r.split("/").pop()}</span>
                <span className="r-path">{r}</span>
              </button>
            ))
            : <p className="muted">최근에 연 저장소가 없습니다.</p>}
        </div>
      </div>
    </div>
  );
};

export default WelcomeSection;
