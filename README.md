# Git Yggdrasil (Electron)

git 히스토리를 그래프 위에서 끌어 놓아 다루는 데스크톱 git 클라이언트입니다. 화면은 한국어와 영어를 지원합니다 (설정 → 언어 / Language, 기본은 OS 언어).
electron-vite + TypeScript 로 만들었고, 코드 구조 규칙은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 에 있습니다.

## 실행

```bash
npm install
npm run dev      # 개발 (화면 HMR)
npm start        # 빌드 후 실행
npm test         # 단위·통합 테스트 (main·renderer)
npm run e2e      # 실제 앱 화면 E2E (Playwright)
npm run typecheck
npm run lint     # Biome
npm run dist:mac # 배포용 .dmg (docs/RELEASE.md)
```

처음 실행하면 저장소 폴더를 고르는 화면이 뜹니다(⌘O). 마지막으로 연 저장소는 다음 실행 때 자동으로 열립니다.

## 지금 단계: 5단계 + P3 완료

실제로 실행되는 조작:
- 기본: 커밋 메시지 수정, stage / unstage, 변경 버리기, 커밋·경로만 커밋·amend, checkout, 새 브랜치, 브랜치 삭제
- 원격: 원격 추가·주소 변경·삭제, URL 로 clone (⌘⇧O), fetch, pull, push (원격이 없으면 주소를 물어 origin 추가)
- 히스토리: cherry-pick, 커밋 옮기기, 줄기 rebase, merge, 커밋 합치기·순서 변경·제거, revert, reset (mixed·soft·hard), 브랜치 포인터 옮기기
- 되돌리기(⌘Z): 앱에서 한 조작 중 브랜치 위치를 바꾼 것을 하나씩 되돌림 (커밋류는 변경을 Staged 로 남김). stage·변경 버리기·stash 는 되돌릴 수 없음

히스토리 조작은 `git merge-tree` + `commit-tree` 로 작업 폴더를 건드리지 않고 계산합니다.
그래서 체크아웃하지 않은 브랜치에도 rebase·cherry-pick·merge 가 되고, **충돌이 나면 아무것도 바꾸지 않고** 충돌 파일을 알려 줍니다.
현재 브랜치가 바뀌면 `git reset --keep` 으로 작업 영역을 맞춥니다 (로컬 변경은 보존, 겹치면 git 이 거절).
조작 전 브랜치 위치는 `refs/yggdrasil/backup/` 에도 남습니다.

충돌 (4단계):
- 현재 브랜치의 cherry-pick · rebase · merge · revert · pull 은 충돌 지점에서 멈추고 배너와 해결 패널을 띄움
- 체크아웃하지 않은 브랜치에서 충돌이 나면 아무것도 바꾸지 않고 "체크아웃하고 진행할까요?" 를 물음
- 파일마다 A 쪽(--ours) · B 쪽(--theirs) · 직접 편집(에디터로 열고, 충돌 표시를 정리하면 해결로 표시), 패널에 실제 충돌 내용
- 계속 · 건너뛰기 · 중단을 실제 git 으로 실행. 터미널에서 시작해 멈춘 작업도 열면 그대로 이어서 해결 가능

큰 저장소 (5단계):
- merge 후 지워진 브랜치의 커밋(이름 없는 레인)은 가로 구간이 겹치지 않으면 같은 줄을 나눠 씀 (예: 커밋 1,601개 · 레인 301개 → 8줄)
- 처음엔 최근 커밋 400개, 캔버스 왼쪽 아래 "이전 커밋 더 불러오기" 로 400개씩 추가 (보던 자리 유지)
- 레인 이름은 가로로 스크롤해도 왼쪽에 고정
- 이름표를 끌 때 화면에 보이는 커밋에만 라벨을 붙이고, 조작 계산은 라벨에 닿을 때 (드래그 시작 14초 → 80ms)

아직 안 되는 것:
- hunk·줄 단위 충돌 해결, stash pop 충돌 뒤 stash 정리
- merge 커밋이 들어 있는 줄기를 다시 쓰기, 체크아웃 안 한 브랜치에 바로 커밋, 과거 커밋에 변경 합치기(fixup), 다시 실행(⇧⌘Z)

인증: 시스템의 git 자격 증명 도우미와 SSH 에이전트를 그대로 씁니다. 비밀번호 입력이 필요하면 멈추지 않고 실패로 알립니다.

## GitHub 연동

- 상단 **GitHub 로그인** → 브라우저에서 코드 입력·승인 (Device Flow, OAuth App `Ov23liCTALlDkudn2YA3`, 권한 `repo read:user`)
- 토큰은 OS 키체인 기반 암호화(Electron `safeStorage`)로 앱 데이터 폴더에 저장, 만료되는 토큰이면 refresh token 으로 자동 갱신
- 로그인하면 github.com HTTPS 원격의 fetch / pull / push / clone 에 토큰을 자동으로 씀 (명령 인자가 아니라 환경 변수로만 전달, 다른 호스트에는 주지 않음)
- 시작 화면 **내 GitHub 저장소에서 clone**, 원격 섹션 **GitHub 에 새 저장소로 올리기**, 브랜치 이름표 오른쪽 클릭 **GitHub PR 만들기**
- P3: 태그(달기·옮기기·삭제·push), 변경 덩어리 단위 stage/unstage, 커밋 나누기, 브랜치 없이 커밋 체크아웃, upstream 연결, 원격 브랜치 삭제, ⌘K 찾기, 파일 히스토리·blame
- 다시 실행(⌘⇧Z), 앱 안 충돌 편집기(구간별 A/B/둘 다 고르기), 줄 단위 stage, diff 좌우 비교·공백 무시·전체 보기·이미지 전후 보기, 그래프 필터(브랜치 숨김·작성자·기간)
- PR 목록 (리뷰 결정·검사 결과 표시, 브라우저에서 열기, `pr/<번호>` 브랜치로 받아 체크아웃)
- 원격 오류 안내: SSH 키·호스트 키·주소·인증·권한 문제를 원인과 해결 방법으로 보여 줌. SSH 는 암호·호스트 키를 묻느라 멈추지 않게 BatchMode 로 실행 (core.sshCommand 를 정해 두었으면 그대로 사용)
- GitHub 밖 HTTPS 호스트(GitLab·Bitbucket·사내 서버) 로그인: 인증이 필요하면 사용자 이름·토큰을 받아 git 자격 증명 도우미(macOS 키체인 등)에 저장하고 다시 시도. 앱은 토큰을 따로 보관하지 않음
- 여러 커밋 선택: ⌘ 클릭(하나씩)·Shift 클릭(같은 브랜치 범위)으로 고른 뒤 다른 브랜치 이름표에 끌거나 오른쪽 클릭하면 오래된 것부터 한꺼번에 cherry-pick
- 커밋 정리(interactive rebase): 브랜치 이름표 오른쪽 클릭 → 순서 바꾸기·메시지 수정·합치기(squash/fixup)·빼기를 한 창에서 정하고 미리 본 뒤 실행. 체크아웃 없이 처리하고, 충돌이 나면 현재 브랜치에서는 실제 rebase -i 로 멈춰 해결
- 서브모듈(상태·받기·열기), worktree(목록·다른 폴더에 체크아웃·열기·지우기, 다른 폴더가 쓰는 브랜치 표시), Git LFS 파일 표시와 미설치 안내
- 예전 커밋 찾기(reflog): HEAD 기록과 앱 백업을 보여 주고, 어느 브랜치에서도 닿지 않는 커밋을 표시. 새 브랜치로 살리기·현재 브랜치에 복사·그 커밋으로 되돌리기(reset --keep)
- 설정 (⌘,): 언어(시스템·한국어·English), 화면 색(시스템·밝게·어둡게), 글자 크기, 외부 에디터 명령, 자동 fetch, pull 방식, 켤 때 마지막 저장소 열기
- 키보드만으로 사용: 그래프 화살표 탐색, Enter 고르기, Space 여러 개, Shift+F10 메뉴 (docs/ARCHITECTURE.md 의 접근성 표)
- 다른 OAuth App 으로 시험하려면 `YGG_GH_CLIENT_ID` 환경 변수로 Client ID 를 바꿀 수 있음

## 구조

자세한 내용은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
src/main      git 실행·조작·GitHub·IPC
src/preload   화면에 노출하는 API (gitApi, ghApi)
src/renderer  화면 (store · sections · interactions · model)
src/shared    공용 타입
tests/        Vitest 통합 테스트
```

## 점검용 실행

화면 오류를 모으고 캡처를 남긴 뒤 종료합니다. 점검 실행은 임시 프로필을 써서 실제 설정·최근 목록·로그인을 건드리지 않습니다.

```bash
npm run build
YGG_SMOKE=/path/to/repo YGG_SHOT=/tmp/shot.png npx electron .
# 화면에서 시나리오 실행: YGG_EVAL=/path/to/scenario.js 를 함께 주면 결과를 같이 출력
# 화면 언어 지정: YGG_LANG=en (또는 ko)
```

