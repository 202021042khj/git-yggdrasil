// 화면 상태 저장소 (한 곳). 섹션들은 여기서 읽기만 하고, 바꿀 때는 update() 를 거친다.
// 바뀌면 구독한 렌더 함수가 다시 그린다.
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
  selectedFile: SelectedFile | null;
  detailTab: DetailTab;
  log: LogEntry[];
  /** 파일 트리에서 접은 폴더 */
  collapsed: Set<string>;
  onlyChanged: boolean;
  pullMode: "merge" | "rebase";
  /** git 명령 실행 중 */
  busy: boolean;
}

const EMPTY_REPO: RepoState = {
  commits: {}, branches: {}, remotes: {}, head: "", files: [], working: { staged: [], unstaged: [], conflicted: [] }, stash: [], op: null,
};

const ui: UiState = {
  repo: null,
  selected: null,
  selectedFile: null,
  detailTab: "diff",
  log: [],
  collapsed: new Set(),
  onlyChanged: false,
  pullMode: "merge",
  busy: false,
};

type Listener = () => void;
const listeners = new Set<Listener>();
let scheduled = false;

export const store = {
  get ui(): Readonly<UiState> {
    return ui;
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
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      listeners.forEach((fn) => fn());
    });
  },

  /** 즉시 다시 그리기 (DOM 위치를 바로 읽어야 할 때) */
  flush(): void {
    scheduled = false;
    listeners.forEach((fn) => fn());
  },

  addLog(entry: LogEntry): void {
    ui.log = [...ui.log, entry];
    store.update({});
  },

  subscribe(fn: Listener): void {
    listeners.add(fn);
  },
};
