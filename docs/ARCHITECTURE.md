# 구조 규칙 (Architecture Conventions)

`khj-fe-template/docs/ARCHITECTURE.md` 의 규칙(로직은 한 곳, 화면은 섹션 단위, 상수·타입·순수 함수 분리, `@/` 별칭, barrel 없음)을
Electron + 바닐라 TypeScript 에 맞게 옮긴 것입니다. React/Next.js 전용 규칙(Desktop/Mobile 분리, route group, shadcn)은 해당하지 않아 뺐습니다.

## 도구

- **electron-vite + TypeScript** — main · preload · renderer 를 각각 빌드합니다. 출력은 `out/`.
- **electron-builder** — 배포 패키지 (`electron-builder.config.cjs`, `build/` 아이콘·권한). 자세한 절차는 [RELEASE.md](RELEASE.md).
- **Playwright** — E2E (`tests/e2e`, `playwright.config.ts`).
- **Vitest** — `tests/` 아래, 임시 git 저장소에서 실제 git 을 돌려 보는 통합 테스트.
- **Biome** — lint 만 (`biome.json`, `npm run lint`). 서식 자동 정리(formatter)는 꺼 두었습니다. typescript-eslint 가 아직 TypeScript 7 을 지원하지 않아 ESLint 대신 씁니다. 줄 끝·들여쓰기는 `.editorconfig`.
- `npm run dev` (HMR) · `npm run build` · `npm start` (빌드 후 실행) · `npm run typecheck` · `npm run lint` · `npm test`

## 프로세스 경계

```
src/main      Node · git CLI · 파일 감시 · GitHub API      (렌더러를 믿지 않는다)
src/preload   contextBridge 로 gitApi · ghApi 만 노출       (sandbox, CJS)
src/renderer  화면. Node 접근 없음, window.gitApi 로만 요청
src/shared    양쪽이 함께 쓰는 타입과 기본값 상수, 화면 문구 사전(i18n) — 부수 효과 없는 작은 함수만
```

- **창 보안** (Electron 보안 체크리스트): `contextIsolation` · `sandbox` 켜고 `nodeIntegration` 끔. 새 창 열기와 다른 페이지로의 이동은 `window.ts` 의 `guardNavigation` 이 막고, https 링크는 OS 브라우저로 넘깁니다. `<webview>` 는 붙일 수 없습니다.
- **IPC 는 `ipcMain.handle` 대신 `src/main/ipc/guard.ts` 의 `handle`** 로 등록합니다. 맨 위 프레임이고 우리 화면 주소(개발 서버 또는 `out/renderer/index.html`)에서 온 요청만 실행합니다.
- **점검 도구 `window.__yggDebug`** 는 개발 서버이거나 패키지 전 실행(E2E·`YGG_SMOKE`)일 때만 켜집니다. main 이 `--ygg-debug` 를 넘기면 preload 가 `window.yggEnv.debug` 로 알려 줍니다. 배포판에는 없습니다.
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
| `dev/smoke.ts` | 점검용 실행 (`YGG_SMOKE`, 결과 파일 `YGG_SMOKE_OUT`) — CI 가 빌드한 앱으로 `scripts/smoke-packaged.mjs` 를 돌릴 때도 쓴다 |
| `settings.ts` | 앱 설정 저장·적용 (화면 색·확대·에디터·언어), `userData/settings.json` |
| `update.ts` | 자동 업데이트 (패키지 앱에서만, GitHub Releases) |

**조작 추가 순서:** `OpName` 에 이름 추가 → `*Ops.ts` 에 `OpFn` 작성 → 레지스트리 등록 → `tests/main/*.test.ts` 에 임시 저장소 테스트 → (화면) `model/preview.ts` 에 미리보기, `interactions/targets.ts` 또는 `contextMenu.ts` 에 진입점.

## renderer (`src/renderer/src`) — React 19 + TypeScript

폴더와 이름은 `khj-fe-template-react` 의 규칙(docs/ARCHITECTURE.md)을 따르고, 데스크톱 앱이라 다른 점만 적습니다.

```
main.tsx                진입점: 메인 프로세스 이벤트 · 드래그 · 오른쪽 클릭 · GitHub 를 한 번 연결하고 React 를 띄운다
App.tsx                 최상위: 전역 CSS · 아이콘 스프라이트 · MainPage · 함수로 여는 부품(Menu · Toast · 입력창들)
pages/MainPage.tsx      유일한 화면. useMainLogic() 을 한 번 부르고 DesktopPageContainer 에 내려 준다
components/
  pages/main/
    DesktopPageContainer.tsx   3단 배치 + 섹션 조립 (모바일 화면은 없다)
    sections/<자리>/           화면 자리별 섹션. <Name>Section.tsx + 같은 이름 .css + 밖에서 부르는 함수 <name>Utils.ts
      shell/   상단바 · 진행 중 작업 배너 · 하단 · 시작 화면 · 도움말
      sidebar/ 브랜치 · 원격 · 서브모듈/worktree · Pull Request · 작업 영역
      canvas/  커밋 그래프 · 필터 바
      detail/  상세(diff·blame) · 실행 기록 · 충돌 편집기
      dialogs/ 설정 · ⌘K 찾기 · 커밋 정리 · reflog · GitHub
  ui/          도메인과 무관한 부품: Menu · Dropdown · AskDialog · NoticeDialog · CredentialDialog · Toast (+ 여는 함수 *Utils.ts)
  common/      Icon · IconSprite · LogoMark
hooks/         useMainLogic (store 구독) · useSmallStore · useModal (<dialog>) · useAsync · useCallbackRef
app/           store.ts (화면 상태 한 곳) · actions.ts (조작 실행) · repoSession.ts (열기 · 새로고침)
interactions/  드래그 문법(targets.ts) · 드래그(drag.ts) · 오른쪽 클릭 메뉴(contextMenu.ts) — DOM 이벤트로 동작
model/         순수 계산: 그래프 · 미리보기 · 배치와 SVG 문자열
lib/           React 없는 작은 함수 (esc · 시간 · 경로 · createStore)
constants/     상수 데이터
styles/        index.css(레이어 순서) · tokens.css · base.css · layout.css
dev/debug.ts   window.__yggDebug (개발 · 테스트 실행에서만)
```

규칙:

- **화면 상태는 `app/store` 한 곳.** 바꿀 때는 `store.update(patch)`. 컴포넌트는 `pages/MainPage` 가 부른 `useMainLogic()` 의 `{ ui, repo, hasRepo }` 를 props 로 받아 그립니다 (store 의 version 이 오르면 다시 그린다). DOM 위치를 바로 읽어야 하면 `store.flush()` (React 도 그 자리에서 그린다).
- **어디서든 함수로 여는 부품**(토스트 · 메뉴 · 입력창 · 찾기 · 설정 창 등)은 `lib/createStore` 로 만든 작은 상태를 `*Utils.ts` 에 두고, 컴포넌트는 `useSmallStore` 로 구독합니다. 예: `toast("…")`, `openMenu(...)`, `askText(...)`, `openSettings()`.
- **네이티브 `<dialog>` 는 `useModal(open, onClose)`** 로 열고 닫습니다. Esc · form · close() 어느 쪽으로 닫혀도 상태가 닫힘으로 돌아갑니다.
- **그래프 SVG 와 드래그는 DOM 으로 둡니다.** 그래프는 `model/layout` 이 만든 문자열을 `dangerouslySetInnerHTML` 로 그리고, `interactions/` 는 `data-drag` · `data-drop` 속성으로 대상을 찾습니다. 드래그 중 미리보기(`#ghost-graph`)와 라벨(`#v2-layer` · `#tip` · `#ghost`)은 React 가 빈 칸만 그리고 drag.ts 가 채웁니다.
- **preload 의 `on*` 구독은 해지할 수 없어 `main.tsx` 에서 한 번만** 겁니다 (StrictMode 에서 effect 가 두 번 돌아도 겹치지 않게).
- **git 조작은 `actions.run({ op, args, summary })` 로만.** 실행 중 표시, 멈춘 작업 차단, 실행 기록, 결과 반영, 후속 질문을 여기서 처리합니다.
- **미리보기는 `model/preview.ts` 가 계산만.** 실제 실행은 main 이 하고, 화면은 결과 저장소 상태를 다시 받아 그립니다.
- **기능이 다른 기능의 메뉴에 끼어들 때는 등록 함수로.** 예: GitHub PR 항목은 `registerContextProvider` 로 더합니다.
- **스타일은 쓰는 파일 옆에.** `FooSection.tsx` 의 스타일은 같은 폴더 `FooSection.css` 에 두고 맨 위에서 import 합니다. 파일마다 `@layer components { … }`, 색·간격은 `styles/tokens.css` 변수만. 템플릿은 styled-components 를 쓰지만 이 앱은 CSS 파일을 유지합니다. 디자인 원본은 Figma "App · Foundations / Components / Screens".
- **`model/`, `lib/` 는 DOM 을 만지지 않습니다.** (`model/layout.ts` 는 SVG 문자열을 만들 뿐)

## 이름 · import

- 컴포넌트 파일은 PascalCase (`DetailSection.tsx`), 나머지는 camelCase (`repoSession.ts`, `searchUtils.ts`). 컴포넌트는 화살표 함수 + `export default`.
- import 순서: React → 라이브러리 → 공통(`components/ui` · `common` · `lib` · `hooks`) → 앱(`app` · `model` · `interactions`) → 화면(`components/pages`) → 타입.
- barrel(`index.ts`) 을 만들지 않고 파일에서 직접 import 합니다. (예외: 각 프로세스 진입점 `src/main/index.ts`, `src/preload/index.ts`)
- 항상 별칭: `@/…` (main 코드에선 `src/main`, renderer 코드에선 `src/renderer/src`), `@shared/…`. 상대 경로 `../` 는 쓰지 않습니다.
- 화면 문구는 코드에 직접 쓰지 않고 `t("키")` 로 (아래 "화면 문구 (i18n)").

## 화면 문구 (i18n)

한국어(ko)와 영어(en)를 지원합니다. 라이브러리 없이 타입이 있는 사전 두 개로 합니다.

```
src/shared/i18n/ko.ts     기준 사전. 키 → 문자열 또는 (params) => 문자열
src/shared/i18n/en.ts     영어. 타입이 ko 에서 나오므로 키가 빠지거나 남거나 인자 모양이 다르면 타입 오류
src/shared/i18n/i18n.ts   t(key, params) · setLocale · getLocale · resolveLocale · dateLocale
src/shared/i18n/plural.ts 영어 복수형 도우미 count(3, "commit") → "3 commits" (en.ts 에서만)
```

- **언어 정하기:** 설정 `language` 는 `"system" | "ko" | "en"` (기본 system). main 이 `resolveLocale(설정, app.getLocale())` 로 정하고 (ko* → ko, 그 밖은 en), renderer 는 `gitApi.getLocale()` 로 같은 값을 받아 씁니다 (`app/locale.ts`). 렌더러가 스스로 navigator.language 를 보지 않으므로 두 프로세스는 항상 같은 언어입니다.
- **바꿀 때:** 설정 창의 "언어 / Language" → `settings:set` → main 은 `setLocale` 후 `onLocaleChange` 로 앱 메뉴를 다시 만들고, renderer 는 `syncLocale()` 로 받아 `localeStore` 를 바꿉니다. `App` 이 이것을 구독하므로 화면 전체가 다시 그려지고, `store.update({})` 로 그래프 SVG 도, `refresh()` 로 main 이 만든 문구(멈춘 작업 제목 등)도 새 언어가 됩니다. `<html lang>` 도 맞춥니다.
- **점검 실행:** `YGG_LANG=ko|en` (YGG_SMOKE · YGG_PROFILE 실행에서만) 으로 언어를 정할 수 있습니다. E2E 는 임시 프로필의 settings.json 에 언어를 적어 띄웁니다 (`launch("en")`, 기본 ko).

**문구 더하기:**
1. `ko.ts` 에 키를 더합니다. 이름은 `영역.뜻` (예: `pv.` 미리보기, `verb.` 끌어 놓기 동사, `ctx.` 오른쪽 클릭, `m.` main 오류, `menu.` 앱 메뉴). 값이 바뀌는 문구는 `` (p: { branch: string; n: number }) => `…` `` 처럼 인자 타입을 적은 함수로.
2. `en.ts` 에 같은 키를 더합니다 (인자 타입은 ko 에서 옵니다: `` (p) => `…` ``). 수가 들어가면 `count(p.n, "commit")`.
3. 코드에서는 `t("키")` · `t("키", { … })`. 모듈 맨 위 상수에 문구를 넣지 말고(언어가 바뀌어도 그대로 남는다) 그릴 때 부르는 함수 안에서 `t()` 를 부릅니다. 목록은 `() => [...]` 함수로, 표에는 키(`MessageKey`)를 두고 그릴 때 `t(key)`.

**규칙:**
- **문장을 이어 붙이지 않습니다.** "`feature` 를 `main` 위로 옮기기" 처럼 낱말 순서·조사가 언어마다 다른 문장은 조각(`${a} 를 ` + `${b} 위로`)으로 만들지 말고 문장 전체를 템플릿 하나로 (`t("verb.rebaseOnto", { branch })`). 조건에 따라 달라지는 부분도 사전의 함수 안에서 고릅니다.
- **두 사전에 같은 키.** 타입 검사(`npm run typecheck`)와 `tests/main/i18n.test.ts`(키 · 모양이 같은지, 영어에 한글이 없는지)가 확인합니다.
- **git 명령 문자열은 번역하지 않습니다.** 실행 기록의 `git …` 은 그대로 두고, 뒤의 `# 설명` 과 `<이름>` 같은 자리 표시만 사전에서.
- 굵게·키 표시가 필요한 문장은 사전에 `<b>` · `<kbd>` · `<code>` 만 쓰고 `components/common/RichText` 로 그립니다 (innerHTML 을 쓰지 않음).
- 언어 목록의 "한국어" · "English" 는 그 언어로 적습니다 (지금 언어를 못 읽어도 고를 수 있게).
- 사용자 데이터(커밋 메시지·브랜치 이름)와 git 이 만드는 메시지(`Merge … into …`, `Revert "…"`, `WIP on …`)는 번역하지 않습니다.

## 스타일

- 색은 `:root` 의 토큰(`--bg`, `--panel`, `--line`, `--text`, `--muted`, `--accent`, `--tag` …)만 씁니다. 라이트 모드는 `prefers-color-scheme: light` 에서 같은 토큰을 덮어씁니다.
- 숨김은 `hidden` 속성 (`[hidden] { display:none !important }`) 또는 `.hidden` 클래스.

## 접근성

- 끌어 놓는 조작은 모두 **오른쪽 클릭 / Shift+F10 메뉴**로도 할 수 있어야 합니다 (WCAG 2.5.7). 새 드래그 조작은 `interactions/targets.ts` 에 넣으면 메뉴에도 저절로 나옵니다.
- 그래프의 커밋·이름표는 `role="button"` 과 말로 된 `aria-label`(메시지 · 해시 · 줄기 · push 여부 · HEAD)을 가집니다. 그래프 안에서 Tab 으로 닿는 커밋은 하나뿐이고(roving tabindex), 나머지는 화살표로 움직입니다.
- 메뉴와 창을 닫으면 초점을 열기 전 자리로 돌려줍니다.
- 색은 토큰으로만 쓰고, `tests/e2e/a11y.spec.ts` 가 어두운·밝은 화면 모두에서 axe(WCAG 2.2 AA)로 점검합니다.

| 키 | 동작 |
|---|---|
| ←→ / ↑↓ | 같은 줄기 앞뒤 커밋 / 위아래 줄기의 가까운 커밋 |
| Home · End | 줄기의 처음 · 끝 |
| Enter | 커밋 고르기 (사이드바 브랜치에서는 checkout) |
| Space | 여러 개 고르기에 더하기·빼기 |
| Shift+F10 · 메뉴 키 | 할 일 메뉴 (끌어 놓기로 하는 조작 전부) |
| ⌘K · ⌘Z · ⌘⇧Z · ⌘, | 찾기 · 되돌리기 · 다시 실행 · 설정 |

## 테스트

- `tests/renderer/*.test.ts` — 화면의 순수 계산(`model/`)을 시험합니다. Vitest 를 main·renderer 두 프로젝트로 나눠 `@/` 가 각 프로세스 폴더를 가리키게 했고, 타입 검사는 `tsconfig.web.json` 이 맡습니다. DOM 을 쓰는 코드는 넣지 않습니다.
- `tests/main/*.test.ts` — 임시 폴더에 저장소를 만들고 `execute()` 로 조작을 돌린 뒤 git 으로 결과를 확인합니다. 네트워크는 로컬 bare 저장소로 대신합니다.
- `tests/e2e/*.spec.ts` — Playwright 로 빌드한 Electron 앱을 띄워 사용자가 하듯 조작합니다 (`npm run e2e`). 임시 저장소와 `YGG_PROFILE` 임시 프로필을 써서 실제 설정·로그인을 건드리지 않습니다. 기존 시험은 한국어 문구로 찾으므로 프로필에 `language: "ko"` 를 적어 띄우고, `i18n.spec.ts` 는 영어로 띄워 문구 · 남은 한글 · axe 를 봅니다. 끌어 놓기는 `dragTo` 도우미로 실제 마우스를 움직입니다.
- 빠른 확인은 `YGG_SMOKE=<저장소> YGG_EVAL=<시나리오.js> npm start` 로 창을 띄워 오류와 캡처만 봅니다 (`window.__yggDebug` 사용).
