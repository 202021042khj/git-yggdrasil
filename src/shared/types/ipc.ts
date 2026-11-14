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
  | "resolveFile" | "resolveContent" | "checkoutPull" | "rebasePlan" | "continueOp" | "skipOp" | "abortOp"
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

/** 커밋 정리(interactive rebase) 한 줄: 위에서부터 오래된 커밋 */
export interface RebaseStep {
  id: string;
  /** pick 그대로 · reword 메시지 바꿈 · squash 앞 커밋에 합치고 메시지도 합침 · fixup 앞 커밋에 합치고 메시지 버림 · drop 빼기 */
  action: "pick" | "reword" | "squash" | "fixup" | "drop";
  /** reword·squash 때 새 메시지 (squash 는 합친 커밋의 메시지) */
  msg?: string;
}

export interface RunResult {
  ok: boolean;
  /** 실제로 실행한 git 명령 (기록용) */
  cmds: string[];
  warnings?: string[];
  error?: string;
  /** 원격 접속 오류일 때 원인과 해결 방법 */
  hint?: { title: string; fix: string };
  unsupported?: boolean;
  conflicts?: string[];
  code?: "NO_REMOTE" | "NEEDS_CHECKOUT" | "AUTH_REQUIRED";
  /** AUTH_REQUIRED 일 때 인증이 필요한 https://호스트 */
  authUrl?: string;
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

export interface CredentialSaveResult {
  /** 저장에 쓴 도우미 */
  helpers: string[];
  /** 이번에 git 전역 설정에 켠 도우미 */
  enabledHelper: string | null;
  /** 도우미가 없어 저장하지 않았을 때: 켤 수 있는 OS 기본 도우미 (없으면 null) */
  needsHelper?: string | null;
  message?: string;
}

export interface GitApi {
  pick(): Promise<RepoState | null>;
  open(dir: string): Promise<RepoState>;
  /** retry: 인증 실패 직후 같은 위치에 다시 받기 */
  clone(url: string, retry?: boolean): Promise<RepoState | null>;
  read(): Promise<RepoState | null>;
  more(): Promise<RepoState | null>;
  diff(file: string, commit: string | null, opts?: DiffOptions): Promise<FileDiff>;
  run(op: OpName, args: unknown[], extra?: OpExtra): Promise<RunResult>;
  search(query: string): Promise<SearchHit[]>;
  fileHistory(file: string): Promise<FileHistoryEntry[]>;
  blame(file: string, commit?: string | null): Promise<BlameLine[]>;
  hunks(file: string, staged: boolean): Promise<Hunk[]>;
  conflictText(file: string): Promise<string | null>;
  /** GitHub 밖 HTTPS 호스트의 사용자 이름·토큰을 git 자격 증명 도우미에 저장 */
  saveCredential(args: { url: string; username: string; password: string; enableHelper?: boolean }): Promise<CredentialSaveResult>;
  forgetCredential(url: string): Promise<void>;
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

export type GhReview = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
export type GhChecks = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED" | null;

export interface GhPull {
  number: number;
  title: string;
  url: string;
  draft: boolean;
  author: string;
  /** PR 브랜치 (다른 저장소에서 온 PR 이면 fork 쪽 이름) */
  head: string;
  base: string;
  /** fork 에서 온 PR */
  fromFork: boolean;
  review: GhReview;
  checks: GhChecks;
  /** ISO 시각 */
  updated: string;
}

export interface GhPullList {
  /** owner/repo. GitHub 원격이 없으면 null */
  fullName: string | null;
  /** 그 저장소를 가리키는 원격 이름 */
  remote: string | null;
  pulls: GhPull[];
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
  /** 지금 저장소의 열린 PR (리뷰·검사 상태 포함) */
  pulls(): Promise<GhPullList>;
  openUrl(url: string): Promise<void>;
  onChanged(fn: (s: GhStatus) => void): void;
}
