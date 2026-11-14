# Git Yggdrasil (Electron)

git 히스토리를 그래프 위에서 끌어 놓아 다루는 데스크톱 git 클라이언트입니다.
화면은 목업 저장소(`../git-canvas-mockup`)의 v2 목업을 옮겨 왔고, 가짜 저장소 대신 실제 저장소를 읽습니다.

## 실행

```bash
npm install
npm start
```

처음 실행하면 저장소 폴더를 고르는 화면이 뜹니다(⌘O). 마지막으로 연 저장소는 다음 실행 때 자동으로 열립니다.

## 지금 단계: 3단계 (히스토리 조작) 완료

실제로 실행되는 조작:
- 기본: 커밋 메시지 수정, stage / unstage, 변경 버리기, 커밋·경로만 커밋·amend, checkout, 새 브랜치, 브랜치 삭제
- 원격: 원격 추가·주소 변경·삭제, URL 로 clone (⌘⇧O), fetch, pull, push (원격이 없으면 주소를 물어 origin 추가)
- 히스토리: cherry-pick, 커밋 옮기기, 줄기 rebase, merge, 커밋 합치기·순서 변경·제거, revert, reset (mixed·soft·hard), 브랜치 포인터 옮기기
- 되돌리기(⌘Z): 앱에서 한 조작 중 브랜치 위치를 바꾼 것을 하나씩 되돌림 (커밋류는 변경을 Staged 로 남김). stage·변경 버리기·stash 는 되돌릴 수 없음

히스토리 조작은 `git merge-tree` + `commit-tree` 로 작업 폴더를 건드리지 않고 계산합니다.
그래서 체크아웃하지 않은 브랜치에도 rebase·cherry-pick·merge 가 되고, **충돌이 나면 아무것도 바꾸지 않고** 충돌 파일을 알려 줍니다.
현재 브랜치가 바뀌면 `git reset --keep` 으로 작업 영역을 맞춥니다 (로컬 변경은 보존, 겹치면 git 이 거절).
조작 전 브랜치 위치는 `refs/yggdrasil/backup/` 에도 남습니다.

아직 안 되는 것:
- 충돌 해결 화면 (충돌이 나면 실행하지 않고 알려 주기만 함), 저장소가 rebase·merge 도중인 상태 처리
- merge 커밋이 들어 있는 줄기를 다시 쓰기, 체크아웃 안 한 브랜치에 바로 커밋, 과거 커밋에 변경 합치기(fixup), 다시 실행(⇧⌘Z)

인증: 시스템의 git 자격 증명 도우미와 SSH 에이전트를 그대로 씁니다. 비밀번호 입력이 필요하면 멈추지 않고 실패로 알립니다.

## GitHub 연동

- 상단 **GitHub 로그인** → 브라우저에서 코드 입력·승인 (Device Flow, OAuth App `Ov23liCTALlDkudn2YA3`, 권한 `repo read:user`)
- 토큰은 OS 키체인 기반 암호화(Electron `safeStorage`)로 앱 데이터 폴더에 저장, 만료되는 토큰이면 refresh token 으로 자동 갱신
- 로그인하면 github.com HTTPS 원격의 fetch / pull / push / clone 에 토큰을 자동으로 씀 (명령 인자가 아니라 환경 변수로만 전달, 다른 호스트에는 주지 않음)
- 시작 화면 **내 GitHub 저장소에서 clone**, 원격 섹션 **GitHub 에 새 저장소로 올리기**, 브랜치 이름표 오른쪽 클릭 **GitHub PR 만들기**
- 다른 OAuth App 으로 시험하려면 `YGG_GH_CLIENT_ID` 환경 변수로 Client ID 를 바꿀 수 있음

## 구조

```
src/main/main.js      창, 저장소 열기, 파일 변경 감지, IPC
src/main/preload.js   화면에 노출하는 API (gitApi)
src/main/git.js       git CLI 호출과 출력 해석 (log, for-each-ref, status, ls-files, stash)
src/main/ops.js       화면에서 고른 조작을 실제 git 명령으로 실행
src/main/github.js    GitHub 로그인(Device Flow), 토큰 보관·갱신, API
src/renderer/gh.js    GitHub 화면 (로그인 창, 저장소 목록, 새 저장소, PR)
test/*.test.js        임시 저장소에서 조작을 실제로 실행해 보는 테스트 (npm test)
src/renderer/         화면 (목업 코드 + bridge.js)
src/renderer/bridge.js 목업 화면을 실제 저장소에 연결, 쓰기 조작 차단
```

## 점검용 실행

화면 오류를 모으고 캡처를 남긴 뒤 종료합니다.

```bash
YGG_SMOKE=/path/to/repo YGG_SHOT=/tmp/shot.png npx electron .
# 화면에서 시나리오 실행: YGG_EVAL=/path/to/scenario.js 를 함께 주면 결과를 같이 출력
```

## 다음 단계

2. ~~기본 쓰기~~ (완료)
3. ~~드래그 히스토리 조작 + 되돌리기~~ (완료)
- ~~GitHub 연동~~ (완료)
4. 실제 충돌과 진행 중 상태
5. 안전장치와 대형 저장소 성능
