// 화면 진입점: 섹션을 한 번씩 붙이고(mount), 상태가 바뀔 때마다 다시 그린다(render)
import "@/styles/index.css";
import { open, recent, refresh } from "@/app/repoSession";
import { store } from "@/app/store";
import { installDebug } from "@/dev/debug";
import { mountContextMenu } from "@/interactions/contextMenu";
import { mountDrag } from "@/interactions/drag";
import { renderCanvas, mountCanvas, revealCommit } from "@/sections/canvas/CanvasSection";
import { renderDetail, mountDetail } from "@/sections/detail/DetailSection";
import { renderExtras, mountExtras } from "@/sections/sidebar/ExtrasSection";
import { renderFilter, mountFilter } from "@/sections/canvas/FilterSection";
import { renderFooter } from "@/sections/shell/FooterSection";
import { renderGithub, mountGithub } from "@/sections/dialogs/GithubSection";
import { renderLog } from "@/sections/detail/LogSection";
import { renderPulls, mountPulls } from "@/sections/sidebar/PullsSection";
import { mountRebaseEditor } from "@/sections/dialogs/RebaseEditor";
import { mountReflog } from "@/sections/dialogs/ReflogSection";
import { renderOpBanner, mountOpBanner } from "@/sections/shell/OpBannerSection";
import { renderRemotes, mountRemotes } from "@/sections/sidebar/RemotesSection";
import { mountSearch } from "@/sections/dialogs/SearchSection";
import { loadSettings, mountSettings } from "@/sections/dialogs/SettingsSection";
import { renderSidebar, mountSidebar } from "@/sections/sidebar/SidebarSection";
import { renderTopbar, mountTopbar } from "@/sections/shell/TopbarSection";
import { cloneFlow, mountWelcome, showWelcome } from "@/sections/shell/WelcomeSection";
import { renderWorking, mountWorking } from "@/sections/sidebar/WorkingSection";
import { mountDropdowns } from "@/ui/dropdown";
import { mountMenu } from "@/ui/menu";
import { toast } from "@/ui/toast";

const renders = [renderTopbar, renderOpBanner, renderSidebar, renderRemotes, renderExtras, renderPulls, renderWorking, renderFilter, renderCanvas, renderDetail, renderLog, renderFooter, renderGithub];

function renderAll(): void {
  if (!store.hasRepo()) return;
  for (const r of renders) {
    try { r(); } catch (err) { console.error(`${r.name} 실패`, err); }
  }
}

mountMenu();
mountDropdowns();
mountDrag();
mountContextMenu();
mountTopbar();
mountOpBanner();
mountSidebar();
mountRemotes();
mountPulls();
mountExtras();
mountWorking();
mountCanvas();
mountFilter();
mountDetail((id) => { if (!revealCommit(id)) toast("그래프에 아직 불러오지 않은 커밋입니다."); });
mountSearch();
mountRebaseEditor();
mountReflog();
mountSettings();
mountWelcome();
mountGithub();
installDebug();
store.subscribe(renderAll);

window.gitApi.onChanged(() => void refresh());
window.gitApi.onMenuOpen(() => void open(window.gitApi.pick()));
window.gitApi.onMenuClone(() => void cloneFlow());

showWelcome();
void loadSettings().then((s) => {
  const last = recent()[0];
  if (s.reopenLast && last) void open(window.gitApi.open(last));
});
