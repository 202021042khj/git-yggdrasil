import "./WelcomeSection.css";

import { useState } from "react";

import LogoMark from "@/components/common/LogoMark";
import { open } from "@/app/repoSession";
import { toast } from "@/components/ui/toastUtils";
import { t } from "@shared/i18n/i18n";
import type { RepoState } from "@shared/types/repo";

interface InitRepoSectionProps {
  repo: RepoState;
}

/** git 저장소가 아닌 폴더를 열었을 때: "git 시작하기"(git init) 또는 다른 폴더 열기 */
const InitRepoSection = ({ repo }: InitRepoSectionProps) => {
  const [busy, setBusy] = useState(false);

  const handleInit = async () => {
    setBusy(true);
    await open(window.gitApi.init().then((r) => {
      toast(t("init.done", { name: r.repoName || "" }));
      return r;
    }));
    setBusy(false);
  };

  return (
    <div id="init-repo" className="welcome" role="dialog" aria-modal="true" aria-labelledby="init-title">
      <div className="welcome-card">
        <LogoMark />
        <h1 id="init-title" className="init-title">{t("init.title")}</h1>
        <p className="r-path">{repo.root}</p>
        <p className="muted">{t("init.body")}</p>
        <button type="button" id="init-start" className="commit-btn" disabled={busy} onClick={() => void handleInit()}>{t("init.start")}</button>
        <button type="button" id="init-other" className="clone-btn" disabled={busy} onClick={() => void open(window.gitApi.pick())}>{t("init.other")}</button>
      </div>
    </div>
  );
};

export default InitRepoSection;
