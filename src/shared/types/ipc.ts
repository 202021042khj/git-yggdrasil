// 메인 ↔ 화면 사이의 API (preload 가 window.gitApi / window.ghApi 로 노출)
import type { RepoState } from "@shared/types/repo";

/** 화면이 실행을 요청하는 조작 이름 (메인의 git/ops 등록부와 1:1) */
export type OpName =
  | "stageFiles" | "stageHunk" | "discard" | "commitTo" | "amendInto" | "reword"
  | "checkout" | "checkoutCommit" | "switchCreate" | "createBranch" | "renameBranch" | "checkoutRemote" | "deleteBranch"
  | "moveBranch" | "resetHead" | "setUpstream"
  | "fetch" | "pull" | "push" | "remoteAdd" | "remoteSetUrl" | "remoteRemove" | "deleteRemoteBranch"
  | "tagCreate" | "tagMove" | "tagDelete" | "tagPush"
  | "stashPush" | "stashPop" | "stashDrop"
  | "cherryPick" | "moveCommit" | "dropCommit" | "rebaseStem" | "squash" | "reorder" | "revertCommit" | "merge" | "splitCommit"
  | "resolveFile" | "resolveContent" | "continueOp" | "skipOp" | "abortOp"
  | "undo"
  | "redo";

/** 조작에 필요한 부가 정보 (화면이 그래프에서 계산해서 넘긴다) */
export interface OpExtra {
  force?: boolean;
  /** 커밋이 속한 브랜치 */
  from?: string | null;
  /** 줄기가 시작하는 커밋 */
  base?: string | null;
  /** 줄기의 커밋들 (오래된 것부터) */
  stem?: string[];
}

export interface RunResult {
  ok: boolean;
  /** 실제로 실행한 git 명령 (기록용) */
  cmds: string[];
  warnings?: string[];
  error?: string;
  unsupported?: boolean;
  conflicts?: string[];
  code?: "NO_REMOTE" | "NEEDS_CHECKOUT";
  branch?: string;
  undoable?: number;
  redoable?: number;
  repo?: RepoState;
}

export interface SearchHit {
  id: string;
  msg: string;
  author?: string;
  date?: number;
}

export interface FileHistoryEntry extends SearchHit {
  /** 그 커밋에서의 파일 경로 (이름이 바뀐 경우) */
  path: string;
}

export interface BlameLine {
  line: number;
  text: string;
  commit: string;
  author: string;
  date: number;
  summary: string;
}

export interface Hunk {
  /** 파일 안에서 몇 번째 hunk 인지 */
  index: number;
  header: string;
  lines: string[];
}

export interface DiffOptions {
  /** 공백만 바뀐 줄 무시 (git diff -w) */
  ignoreWhitespace?: boolean;
  /** 긴 diff 를 자르지 않고 전부 */
  full?: boolean;
}

export interface FileDiff {
  /** 통합(unified) diff 텍스트. 바이너리면 빈 문자열 */
  text: string;
  /** 잘라 낸 줄 수 (0 이면 전부) */
  omitted: number;
  binary: boolean;
  /** 이미지 파일이면 전후 미리보기 (data: URL, 없으면 그쪽에 파일이 없음) */
  image?: { before: string | null; after: string | null };
  /** 아직 추적하지 않는 새 파일 */
  untracked?: boolean;
}

export interface GitApi {
  pick(): Promise<RepoState | null>;
  open(dir: string): Promise<RepoState>;
  clone(url: string): Promise<RepoState | null>;
  read(): Promise<RepoState | null>;
  more(): Promise<RepoState | null>;
  diff(file: string, commit: string | null, opts?: DiffOptions): Promise<FileDiff>;
  run(op: OpName, args: unknown[], extra?: OpExtra): Promise<RunResult>;
  search(query: string): Promise<SearchHit[]>;
  fileHistory(file: string): Promise<FileHistoryEntry[]>;
  blame(file: string, commit?: string | null): Promise<BlameLine[]>;
  hunks(file: string, staged: boolean): Promise<Hunk[]>;
  conflictText(file: string): Promise<string | null>;
  onChanged(fn: () => void): void;
  onMenuOpen(fn: () => void): void;
  onMenuClone(fn: () => void): void;
  onMenuSearch(fn: () => void): void;
}

export interface GhUser {
  login: string;
  name: string;
  avatar?: string;
}

export interface GhStatus {
  loggedIn: boolean;
  user?: GhUser;
  error?: string;
}

export interface GhRepo {
  fullName: string;
  private: boolean;
  cloneUrl: string;
  updated: string;
  description: string | null;
}

export interface GhApi {
  status(): Promise<GhStatus>;
  login(): Promise<{ userCode: string; verificationUri: string }>;
  cancel(): Promise<void>;
  logout(): Promise<GhStatus>;
  repos(): Promise<GhRepo[]>;
  createRepo(name: string, isPrivate: boolean): Promise<{ fullName: string; cloneUrl: string; htmlUrl: string; remoteName: string; cmds: string[]; repo: RepoState }>;
  pr(args: { head: string; base?: string; title: string; body?: string }): Promise<{ number: number; htmlUrl: string; base: string; cmds: string[]; repo: RepoState }>;
  prDefaults(head: string): Promise<{ fullName: string | null; base?: string } | null>;
  openUrl(url: string): Promise<void>;
  onChanged(fn: (s: GhStatus) => void): void;
}
