// 화면 상태 저장소 (한 곳). 컴포넌트는 hooks/useMainLogic 으로 구독해 읽기만 하고, 바꿀 때는 update() 를 거친다.
import { flushSync } from "react-dom";
import { NO_FILTER, type GraphFilter } from "@/model/filter";
import type { RepoState } from "@shared/types/repo";

export interface LogEntry {
  summary: string;
  cmd: string;
}

export interface SelectedFile {
  path: string;
  /** null 이면 작업 영역 파일, 아니면 그 커밋 안의 파일 */
  commit: string | null;
}

export type DetailTab = "diff" | "history" | "blame";

export interface UiState {
  /** 열린 저장소 (없으면 시작 화면) */
  repo: RepoState | null;
  selected: string | null;
  /** ⌘·Shift 클릭으로 함께 고른 커밋 (selected 포함, 2개 이상일 때만 의미) */
  multi: string[];
  selectedFile: SelectedFile | null;
  detailTab: DetailTab;
  log: LogEntry[];
  /** 파일 트리에서 접은 폴더 */
  collapsed: Set<string>;
  onlyChanged: boolean;
  pullMode: "merge" | "rebase";
  /** git 명령 실행 중 */
  busy: boolean;
  /** 되돌리기 / 다시 실행 가능한 조작 수 (메인 프로세스 기록 기준) */
  /** 그래프 필터 (브랜치 숨김 · 작성자·기간 흐리게) */
  filter: GraphFilter;
  undoCount: number;
  redoCount: number;
  /** 도움말 패널 */
  helpOpen: boolean;
}

const EMPTY_REPO: RepoState = {
  commits: {}, branches: {}, remotes: {}, head: "", files: [], working: { staged: [], unstaged: [], conflicted: [] }, stash: [], op: null,
};

const ui: UiState = {
  repo: null,
  selected: null,
  multi: [],
  selectedFile: null,
  detailTab: "diff",
  log: [],
  collapsed: new Set(),
  onlyChanged: false,
  pullMode: "merge",
  busy: false,
  filter: NO_FILTER,
  undoCount: 0,
  redoCount: 0,
  helpOpen: false,
};

type Listener = () => void;
const listeners = new Set<Listener>();
let scheduled = false;
/** 바뀔 때마다 1씩 오른다. React 는 이 값으로 다시 그릴지 판단한다 (useSyncExternalStore 의 snapshot) */
let version = 0;

const notify = () => {
  version++;
  listeners.forEach((fn) => fn());
};

export const store = {
  get ui(): Readonly<UiState> {
    return ui;
  },
  get version(): number {
    return version;
  },
  /** 열린 저장소 (없으면 빈 상태 — 그리는 코드가 null 검사를 덜 하도록) */
  get repo(): RepoState {
    return ui.repo ?? EMPTY_REPO;
  },
  hasRepo: () => !!ui.repo,

  /** 상태를 바꾸고 다음 프레임에 한 번 다시 그린다 */
  update(patch: Partial<UiState>): void {
    Object.assign(ui, patch);
    if (ui.selected && ui.repo && !ui.repo.commits[ui.selected]) ui.selected = null;
    if (ui.multi.length && ui.repo) ui.multi = ui.multi.filter((id) => ui.repo!.commits[id]);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      if (!scheduled) return; // 그 사이 flush 로 이미 그렸다
      scheduled = false;
      notify();
    });
  },

  /** 즉시 다시 그리기 (DOM 위치를 바로 읽어야 할 때). React 도 이 자리에서 바로 그린다 */
  flush(): void {
    scheduled = false;
    flushSync(notify);
  },

  addLog(entry: LogEntry): void {
    ui.log = [...ui.log, entry];
    store.update({});
  },

  /** 구독. 돌려받은 함수를 부르면 해지한다 (useSyncExternalStore 규칙) */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
