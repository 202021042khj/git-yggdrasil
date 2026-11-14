// 점검용 손잡이: 메인 프로세스의 점검 실행(YGG_SMOKE)과 개발자 도구에서 화면 상태를 읽고 조작을 실행한다
import { run } from "@/app/actions";
import { store } from "@/app/store";
import { contextItems } from "@/interactions/contextMenu";
import { preview } from "@/model/preview";
import { injectPulls } from "@/sections/PullsSection";
import { openSettings } from "@/sections/SettingsSection";

export function installDebug(): void {
  window.__yggDebug = {
    get state() { return store.hasRepo() ? store.repo : null; },
    get ui() { return store.ui; },
    store,
    run,
    preview,
    contextItems,
    injectPulls,
    openSettings,
  };
}
