// 점검용 손잡이: 메인 프로세스의 점검 실행(YGG_SMOKE)과 개발자 도구에서 화면 상태를 읽고 조작을 실행한다
import { run } from "@/app/actions";
import { open } from "@/app/repoSession";
import { store } from "@/app/store";
import { contextItems } from "@/interactions/contextMenu";
import { preview } from "@/model/preview";
import { injectPulls } from "@/sections/sidebar/PullsSection";
import { openSettings } from "@/sections/dialogs/SettingsSection";

export function installDebug(): void {
  // 배포판에서는 켜지 않는다 (상태를 읽고 조작을 실행할 수 있는 도구라서)
  if (!import.meta.env.DEV && !window.yggEnv?.debug) return;
  window.__yggDebug = {
    get state() { return store.hasRepo() ? store.repo : null; },
    get ui() { return store.ui; },
    store,
    run,
    preview,
    contextItems,
    injectPulls,
    openSettings,
    /** E2E: 저장소 열기 (창에서 폴더를 고르는 대신) */
    openRepo: (dir: string) => open(window.gitApi.open(dir)),
  };
}
