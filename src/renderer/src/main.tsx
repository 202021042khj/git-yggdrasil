// 화면 진입점: 앱 전체에 걸리는 연결(파일 감시 · 앱 메뉴 · 드래그 · 오른쪽 클릭)을 한 번 하고 React 를 띄운다
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { syncLocale } from "@/app/locale";
import { open, recent, refresh } from "@/app/repoSession";
import { installDebug } from "@/dev/debug";
import { mountContextMenu } from "@/interactions/contextMenu";
import { mountDrag } from "@/interactions/drag";
import { initGithub } from "@/components/pages/main/sections/dialogs/githubUtils";
import { openSearch } from "@/components/pages/main/sections/dialogs/searchUtils";
import { loadSettings, openSettings } from "@/components/pages/main/sections/dialogs/settingsUtils";
import { cloneFlow } from "@/components/pages/main/sections/shell/welcomeUtils";
import App from "@/App";

// 메인 프로세스 → 화면 (preload 의 on* 은 해지할 수 없어 React 바깥에서 한 번만 건다)
window.gitApi.onChanged(() => void refresh());
window.gitApi.onMenuOpen(() => void open(window.gitApi.pick()));
window.gitApi.onMenuClone(() => void cloneFlow());
window.gitApi.onMenuSearch(openSearch);
window.gitApi.onMenuSettings(openSettings);

mountDrag();
mountContextMenu();
initGithub();
installDebug();

// 첫 화면부터 main 과 같은 언어로 그린다
void syncLocale().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  void loadSettings().then((s) => {
    const last = recent()[0];
    if (s.reopenLast && last) void open(window.gitApi.open(last));
  });
});
