// 화면 진입점: 섹션을 한 번씩 붙이고(mount), 상태가 바뀔 때마다 다시 그린다(render)
import "@/styles/app.css";
import { open, recent, refresh } from "@/app/repoSession";
import { store } from "@/app/store";
import { installDebug } from "@/dev/debug";
import { mountContextMenu } from "@/interactions/contextMenu";
import { mountDrag } from "@/interactions/drag";
import { renderCanvas, mountCanvas, revealCommit } from "@/sections/CanvasSection";
import { renderDetail, mountDetail } from "@/sections/DetailSection";
import { renderExtras, mountExtras } from "@/sections/ExtrasSection";
import { renderFilter, mountFilter } from "@/sections/FilterSection";
import { renderFooter } from "@/sections/FooterSection";
import { renderGithub, mountGithub } from "@/sections/GithubSection";
import { renderLog } from "@/sections/LogSection";
import { renderPulls, mountPulls } from "@/sections/PullsSection";
import { mountRebaseEditor } from "@/sections/RebaseEditor";
import { mountReflog } from "@/sections/ReflogSection";
import { renderOpBanner, mountOpBanner } from "@/sections/OpBannerSection";
import { renderRemotes, mountRemotes } from "@/sections/RemotesSection";
import { mountSearch } from "@/sections/SearchSection";
import { renderSidebar, mountSidebar } from "@/sections/SidebarSection";
import { renderTopbar, mountTopbar } from "@/sections/TopbarSection";
import { cloneFlow, mountWelcome, showWelcome } from "@/sections/WelcomeSection";
import { renderWorking, mountWorking } from "@/sections/WorkingSection";
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
mountWelcome();
mountGithub();
installDebug();
store.subscribe(renderAll);

window.gitApi.onChanged(() => void refresh());
window.gitApi.onMenuOpen(() => void open(window.gitApi.pick()));
window.gitApi.onMenuClone(() => void cloneFlow());

showWelcome();
const last = recent()[0];
if (last) void open(window.gitApi.open(last));
