/// <reference types="vite/client" />
import type { GhApi, GitApi } from "@shared/types/ipc";

declare global {
  interface Window {
    gitApi: GitApi;
    /** preload 가 넘기는 실행 환경. debug 는 개발·테스트 실행에서만 true */
    yggEnv?: { debug: boolean };
    ghApi: GhApi;
    /** 점검용 실행(YGG_SMOKE)에서 화면 상태를 읽는 손잡이 */
    __yggDebug?: unknown;
  }
}
