import "./FooterSection.css";

import Icon from "@/components/common/Icon";
import type { RepoState } from "@shared/types/repo";

interface FooterSectionProps {
  repo: RepoState;
}

/** 하단: stash 트레이 · 휴지통 (둘 다 드래그로 놓는 곳) */
const FooterSection = ({ repo }: FooterSectionProps) => (
  <footer className="footer">
    <div className="stash-tray" data-drop="stash">
      <span className="tray-title"><Icon name="inbox" />Stash</span>
      <div id="stash-list" className="stash-list">
        {repo.stash.length
          ? repo.stash.map((st, i) => (
            <div key={i} className="stash-card" data-drag="stash" data-stash={i} title="작업 영역으로 끌면 꺼내기 · 휴지통으로 끌면 삭제 · 오른쪽 클릭: 메뉴">
              stash@{`{${i}}`} · {st.msg}
            </div>
          ))
          : <span className="muted">비어 있음 — 변경 묶음을 여기로 끌면 stash</span>}
      </div>
    </div>
    <div className="trash" data-drop="trash">
      <Icon name="trash" />휴지통 <span className="muted">커밋 제거, 브랜치와 stash 삭제, 변경 버리기</span>
    </div>
  </footer>
);

export default FooterSection;
