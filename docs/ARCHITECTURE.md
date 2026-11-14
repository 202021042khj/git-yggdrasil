# 구조 규칙 (Architecture Conventions)

`khj-fe-template/docs/ARCHITECTURE.md` 의 규칙(로직은 한 곳, 화면은 섹션 단위, 상수·타입·순수 함수 분리, `@/` 별칭, barrel 없음)을
Electron + 바닐라 TypeScript 에 맞게 옮긴 것입니다. React/Next.js 전용 규칙(Desktop/Mobile 분리, route group, shadcn)은 해당하지 않아 뺐습니다.

## 도구

- **electron-vite + TypeScript** — main · preload · renderer 를 각각 빌드합니다. 출력은 `out/`.
- **electron-builder** — 배포 패키지 (`electron-builder.config.cjs`, `build/` 아이콘·권한). 자세한 절차는 [RELEASE.md](RELEASE.md).
- **Vitest** — `tests/` 아래, 임시 git 저장소에서 실제 git 을 돌려 보는 통합 테스트.
- `npm run dev` (HMR) · `npm run build` · `npm start` (빌드 후 실행) · `npm run typecheck` · `npm test`

## 프로세스 경계

```
src/main      Node · git CLI · 파일 감시 · GitHub API      (렌더러를 믿지 않는다)
src/preload   contextBridge 로 gitApi · ghApi 만 노출       (sandbox, CJS)
src/renderer  화면. Node 접근 없음, window.gitApi 로만 요청
src/shared    양쪽이 함께 쓰는 타입과 기본값 상수 (로직 없음)
```

- IPC 채널 이름과 인자 모양은 `src/shared/types/ipc.ts` 의 `GitApi` / `GhApi` 가 유일한 정의입니다. 채널을 더하면 여기, `src/main/ipc/*Ipc.ts`, `src/preload/index.ts` 세 곳을 함께 고칩니다.
- 토큰은 main 밖으로 나가지 않습니다. git 에는 `YGG_GH_TOKEN` 환경 변수로만, github.com 원격에만 줍니다.

## main (`src/main`)

| 폴더 | 역할 |
|---|---|
| `git/cli.ts` | git 실행 한 곳 (공통 환경 변수, 타임아웃, 네트워크 인증) |
| `git/readRepo.ts` · `status.ts` · `opState.ts` · `query.ts` · `patch.ts` | 읽기: 저장소 상태, 작업 영역, 멈춘 작업, 검색·히스토리·blame·덩어리 |
| `git/ops/*Ops.ts` | 쓰기 조작. 모두 `OpFn(ctx, args)` 모양이고 `execute.ts` 의 `OPS` 레지스트리에 등록 |
| `git/ops/execute.ts` | 실행 · 되돌리기 스택(실행 전후 refs 비교) · 백업 ref |
| `github/` | Device Flow 로그인, 토큰 보관(safeStorage), REST API |
| `repo/session.ts` | 열린 저장소 하나와 창 하나, 파일 감시 |
| `ipc/` | IPC 핸들러 등록만 (로직 없음) |
| `dev/smoke.ts` | 점검용 실행 (`YGG_SMOKE`) |
| `settings.ts` | 앱 설정 저장·적용 (화면 색·확대·에디터), `userData/settings.json` |
| `update.ts` | 자동 업데이트 (패키지 앱에서만, GitHub Releases) |

**조작 추가 순서:** `OpName` 에 이름 추가 → `*Ops.ts` 에 `OpFn` 작성 → 레지스트리 등록 → `tests/main/*.test.ts` 에 임시 저장소 테스트 → (화면) `model/preview.ts` 에 미리보기, `interactions/targets.ts` 또는 `contextMenu.ts` 에 진입점.

## renderer (`src/renderer/src`)

```
main.ts          진입점: 섹션 mount 한 번, 상태가 바뀌면 render 전부
app/             store.ts (상태 한 곳) · actions.ts (조작 실행) · repoSession.ts (열기·새로고침)
sections/        화면 영역마다 한 파일, PascalCase + Section
interactions/    드래그 문법(targets.ts) · 드래그(drag.ts) · 오른쪽 클릭 메뉴(contextMenu.ts)
model/           순수 계산: 그래프(graph.ts) · 미리보기(preview.ts) · 배치와 SVG(layout.ts)
ui/              도메인과 무관한 부품: 메뉴 · 입력 창 · 토스트
lib/             DOM 없는 작은 순수 함수 (esc, 시간, 경로)
constants/       상수 데이터 (배치 치수, 저장 키, 진행 중에도 되는 조작)
styles/app.css   디자인 토큰(:root) + 모든 스타일
dev/debug.ts     window.__yggDebug (점검용)
```

규칙:

- **상태는 `store` 한 곳.** 섹션은 `store.ui` / `store.repo` 를 읽기만 하고, 바꿀 때는 `store.update(patch)` 를 부릅니다. 다음 마이크로태스크에 모든 render 가 한 번 돕니다. DOM 위치를 바로 읽어야 하면 `store.flush()`.
- **섹션 = `render<Name>()` + `mount<Name>()`.** mount 는 시작할 때 한 번 이벤트를 겁니다(가능하면 컨테이너에 위임). render 는 몇 번 불려도 같은 결과를 내야 합니다.
- **git 조작은 `actions.run({ op, args, summary })` 로만.** 실행 중 표시, 멈춘 작업 차단, 실행 기록, 결과 반영, 후속 질문(체크아웃 필요·원격 없음)을 여기서 처리합니다.
- **미리보기는 `model/preview.ts` 가 계산만.** 실제 실행은 main 이 하고, 화면은 결과 저장소 상태를 다시 받아 그립니다.
- **기능이 다른 기능의 메뉴에 끼어들 때는 등록 함수로.** 예: GitHub PR 항목은 `registerContextProvider` 로 더합니다. 다른 파일의 함수를 덮어쓰지 않습니다.
- **`model/`, `lib/` 는 DOM 을 만지지 않습니다.** (`model/layout.ts` 는 SVG 문자열을 만들 뿐)

## 이름 · import

- 섹션·컴포넌트 파일은 PascalCase (`DetailSection.ts`), 나머지는 camelCase (`repoSession.ts`).
- barrel(`index.ts`) 을 만들지 않고 파일에서 직접 import 합니다. (예외: 각 프로세스 진입점 `src/main/index.ts`, `src/preload/index.ts`)
- 항상 별칭: `@/…` (main 코드에선 `src/main`, renderer 코드에선 `src/renderer/src`), `@shared/…`. 상대 경로 `../` 는 쓰지 않습니다.
- 화면 문구는 한국어.

## 스타일

- 색은 `:root` 의 토큰(`--bg`, `--panel`, `--line`, `--text`, `--muted`, `--accent`, `--tag` …)만 씁니다. 라이트 모드는 `prefers-color-scheme: light` 에서 같은 토큰을 덮어씁니다.
- 숨김은 `hidden` 속성 (`[hidden] { display:none !important }`) 또는 `.hidden` 클래스.

## 테스트

- `tests/renderer/*.test.ts` — 화면의 순수 계산(`model/`)을 시험합니다. Vitest 를 main·renderer 두 프로젝트로 나눠 `@/` 가 각 프로세스 폴더를 가리키게 했고, 타입 검사는 `tsconfig.web.json` 이 맡습니다. DOM 을 쓰는 코드는 넣지 않습니다.
- `tests/main/*.test.ts` — 임시 폴더에 저장소를 만들고 `execute()` 로 조작을 돌린 뒤 git 으로 결과를 확인합니다. 네트워크는 로컬 bare 저장소로 대신합니다.
- 화면은 `YGG_SMOKE=<저장소> YGG_EVAL=<시나리오.js> npm start` 로 실제 창에서 확인합니다 (`window.__yggDebug` 사용).
