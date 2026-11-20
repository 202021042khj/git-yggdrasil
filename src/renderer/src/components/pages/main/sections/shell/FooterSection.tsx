import "./FooterSection.css";

import Icon from "@/components/common/Icon";
import { t } from "@shared/i18n/i18n";
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
            <div key={i} className="stash-card" data-drag="stash" data-stash={i} title={t("footer.stashTip")}>
              stash@{`{${i}}`} · {st.msg}
            </div>
          ))
          : <span className="muted">{t("footer.stashEmpty")}</span>}
      </div>
    </div>
    <div className="trash" data-drop="trash">
      <Icon name="trash" />{t("target.trash")} <span className="muted">{t("footer.trashHint")}</span>
    </div>
  </footer>
);

export default FooterSection;
