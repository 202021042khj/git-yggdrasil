import { useSyncExternalStore } from "react";

import { store, type UiState } from "@/app/store";
import type { RepoState } from "@shared/types/repo";

export interface UseMainLogicResult {
  /** 화면 상태 (선택 · 필터 · 실행 중 등) */
  ui: Readonly<UiState>;
  /** 열린 저장소. 없으면 빈 상태 (hasRepo 로 구분) */
  repo: RepoState;
  hasRepo: boolean;
}

/**
 * 메인 화면의 상태. pages/MainPage 에서 한 번만 부르고, 아래 컴포넌트에는 props 로 내려 준다.
 * 저장소(app/store)가 바뀔 때마다 version 이 올라 다시 그린다.
 */
const useMainLogic = (): UseMainLogicResult => {
  useSyncExternalStore(store.subscribe, () => store.version);
  return { ui: store.ui, repo: store.repo, hasRepo: store.hasRepo() };
};

export default useMainLogic;
