# Git Canvas (Electron)

git 히스토리를 그래프 위에서 끌어 놓아 다루는 데스크톱 git 클라이언트입니다.
화면은 목업 저장소(`../git-canvas-mockup`)의 v2 목업을 옮겨 왔고, 가짜 저장소 대신 실제 저장소를 읽습니다.

## 실행

```bash
npm install
npm start
```

처음 실행하면 저장소 폴더를 고르는 화면이 뜹니다(⌘O). 마지막으로 연 저장소는 다음 실행 때 자동으로 열립니다.

## 지금 단계: 2단계 (기본 쓰기)

실제로 실행되는 조작:
- 커밋 메시지 수정 (HEAD 는 amend, 과거 커밋은 같은 내용·작성자로 다시 만들고 뒤 커밋을 다시 올림)
- stage / unstage (파일·폴더·전체), 변경 버리기, 커밋 (전체·경로만), HEAD 커밋에 amend
- checkout, 새 브랜치(현재 위치·특정 커밋), 브랜치 삭제 (병합 안 된 브랜치는 git 이 거절)
- fetch, pull (merge / rebase), push (첫 publish, 갈라졌을 때 확인 후 --force-with-lease)
- stash push / pop / apply / drop

아직 미리보기까지만 되는 조작 (3단계): cherry-pick, 커밋 옮기기, rebase, merge, 커밋 합치기·순서 변경·제거, revert, reset, 브랜치 포인터 이동.
되돌리기(⌘Z)도 3단계입니다. 지금은 메시지 수정·amend 전에 브랜치 위치를 `refs/git-canvas/backup/` 에 남깁니다.

인증: 시스템의 git 자격 증명 도우미와 SSH 에이전트를 그대로 씁니다. 비밀번호 입력이 필요하면 멈추지 않고 실패로 알립니다.

## 구조

```
src/main/main.js      창, 저장소 열기, 파일 변경 감지, IPC
src/main/preload.js   화면에 노출하는 API (gitApi)
src/main/git.js       git CLI 호출과 출력 해석 (log, for-each-ref, status, ls-files, stash)
src/main/ops.js       화면에서 고른 조작을 실제 git 명령으로 실행
test/ops.test.js      임시 저장소에서 조작을 실제로 실행해 보는 테스트 (npm test)
src/renderer/         화면 (목업 코드 + bridge.js)
src/renderer/bridge.js 목업 화면을 실제 저장소에 연결, 쓰기 조작 차단
```

## 점검용 실행

화면 오류를 모으고 캡처를 남긴 뒤 종료합니다.

```bash
GC_SMOKE=/path/to/repo GC_SHOT=/tmp/shot.png npx electron .
# 화면에서 시나리오 실행: GC_EVAL=/path/to/scenario.js 를 함께 주면 결과를 같이 출력
```

## 다음 단계

2. ~~기본 쓰기~~ (완료)
3. 드래그 조작을 실제 git 으로: cherry-pick, rebase, merge, reset + 미리보기(`git merge-tree`, `git replay`) + undo(백업 ref)
4. 실제 충돌과 진행 중 상태
5. 안전장치와 대형 저장소 성능
