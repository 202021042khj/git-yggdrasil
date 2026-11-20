import { toast } from "@/components/ui/toastUtils";
import CanvasSection from "@/components/pages/main/sections/canvas/CanvasSection";
import FilterSection from "@/components/pages/main/sections/canvas/FilterSection";
import { revealCommit } from "@/components/pages/main/sections/canvas/canvasUtils";
import DetailSection from "@/components/pages/main/sections/detail/DetailSection";
import LogSection from "@/components/pages/main/sections/detail/LogSection";
import GithubSection from "@/components/pages/main/sections/dialogs/GithubSection";
import RebaseEditor from "@/components/pages/main/sections/dialogs/RebaseEditor";
import ReflogSection from "@/components/pages/main/sections/dialogs/ReflogSection";
import SearchSection from "@/components/pages/main/sections/dialogs/SearchSection";
import SettingsSection from "@/components/pages/main/sections/dialogs/SettingsSection";
import FooterSection from "@/components/pages/main/sections/shell/FooterSection";
import HelpSection from "@/components/pages/main/sections/shell/HelpSection";
import OpBannerSection from "@/components/pages/main/sections/shell/OpBannerSection";
import TopbarSection from "@/components/pages/main/sections/shell/TopbarSection";
import InitRepoSection from "@/components/pages/main/sections/shell/InitRepoSection";
import WelcomeSection from "@/components/pages/main/sections/shell/WelcomeSection";
import ExtrasSection from "@/components/pages/main/sections/sidebar/ExtrasSection";
import PullsSection from "@/components/pages/main/sections/sidebar/PullsSection";
import RemotesSection from "@/components/pages/main/sections/sidebar/RemotesSection";
import SidebarSection from "@/components/pages/main/sections/sidebar/SidebarSection";
import WorkingSection from "@/components/pages/main/sections/sidebar/WorkingSection";
import { t } from "@shared/i18n/i18n";
import type { UseMainLogicResult } from "@/hooks/useMainLogic";

const goto = (id: string) => { if (!revealCommit(id)) toast(t("detail.notLoaded")); };

/** 메인 화면: 상단바 · 사이드바 | 그래프 | 상세 · 하단 트레이, 그리고 떠 있는 창들 (데스크톱 앱이라 모바일 화면은 없다) */
const DesktopPageContainer = ({ ui, repo, hasRepo }: UseMainLogicResult) => {
  const logic = { ui, repo, hasRepo };

  return (
    <>
      <TopbarSection {...logic} />
      <OpBannerSection repo={repo} />
      <div className="main">
        <aside className="sidebar">
          <SidebarSection {...logic} />
          <RemotesSection repo={repo} hasRepo={hasRepo} />
          <ExtrasSection repo={repo} />
          <PullsSection repo={repo} hasRepo={hasRepo} />
          <WorkingSection {...logic} />
        </aside>
        <div className="canvas-area">
          <FilterSection {...logic} />
          <CanvasSection {...logic} />
        </div>
        <aside className="detail">
          <h3>{t("detail.title")}</h3>
          <DetailSection {...logic} onGoto={goto} />
          <LogSection log={ui.log} />
        </aside>
      </div>
      <FooterSection repo={repo} />
      {!hasRepo && <WelcomeSection />}
      {hasRepo && repo.notGit && <InitRepoSection repo={repo} />}
      <HelpSection open={ui.helpOpen} />
      <SearchSection />
      <SettingsSection />
      <RebaseEditor />
      <ReflogSection />
      <GithubSection />
    </>
  );
};

export default DesktopPageContainer;
