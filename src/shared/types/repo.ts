// 저장소 상태: 메인 프로세스가 git 에서 읽어 화면으로 보내는 모양

export interface Commit {
  id: string;
  parents: string[];
  msg: string;
  files: string[];
  author?: string;
  /** 작성 시각 (ms) */
  date?: number;
  /** 불러온 범위 밖의 부모가 있었는지 */
  shallow?: boolean;
}

export interface WorkingState {
  staged: string[];
  unstaged: string[];
  conflicted: string[];
}

export interface StashEntry {
  id: string;
  msg: string;
  branch: string;
  staged: string[];
  unstaged: string[];
}

export interface RemoteInfo {
  name: string;
  url: string;
}

export interface TagInfo {
  name: string;
  /** 태그가 가리키는 커밋 */
  target: string;
  annotated: boolean;
  message?: string;
}

export type OpKind = "rebase" | "merge" | "cherry-pick" | "revert" | "files" | "stash" | "split";

/** 충돌·편집으로 멈춘 진행 중 작업 */
export interface OpState {
  real?: boolean;
  kind: OpKind;
  title: string;
  /** rebase 중인 브랜치 */
  branch?: string;
  step?: number;
  total?: number;
  current?: { msg: string; files?: string[] };
  /** rebase 중 지금까지 적용된 끝 커밋 (⏸ 진행 중 레인) */
  tip?: string;
  oursName: string;
  theirsName: string;
  conflicts: string[];
  resolved: Record<string, string>;
}

export interface RepoState {
  root?: string;
  repoName?: string;
  commits: Record<string, Commit>;
  truncated?: boolean;
  totalCommits?: number;
  branches: Record<string, string>;
  remotes: Record<string, string>;
  upstream?: Record<string, string>;
  remoteList?: RemoteInfo[];
  tags?: Record<string, TagInfo>;
  /** 체크아웃된 브랜치. detached 면 "HEAD" */
  head: string;
  detached?: string | null;
  files: string[];
  working: WorkingState;
  stash: StashEntry[];
  op: OpState | null;
  born?: Record<string, number>;
}
