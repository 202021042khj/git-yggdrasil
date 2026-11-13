# Git Canvas (Electron)

git 히스토리를 그래프 위에서 끌어 놓아 다루는 데스크톱 git 클라이언트입니다.
화면은 목업 저장소(`../git-canvas-mockup`)의 v2 목업을 옮겨 왔고, 가짜 저장소 대신 실제 저장소를 읽습니다.

## 실행

```bash
npm install
npm start
```

처음 실행하면 저장소 폴더를 고르는 화면이 뜹니다(⌘O). 마지막으로 연 저장소는 다음 실행 때 자동으로 열립니다.

## 지금 단계: 1단계 (읽기 전용)

- 실제 저장소의 커밋 그래프(최근 400개), 브랜치, 원격 브랜치, HEAD, 작업 영역 상태, stash 목록을 보여 줍니다.
- 파일·커밋을 클릭하면 실제 diff 를 보여 줍니다.
- 에디터나 터미널에서 파일·git 상태가 바뀌면 자동으로 다시 읽습니다.
- 끌어 놓기는 **미리보기까지만** 됩니다. 놓으면 실행하지 않고 안내만 합니다. (미리보기 계산은 아직 목업의 가짜 모델을 씁니다.)

## 구조

```
src/main/main.js      창, 저장소 열기, 파일 변경 감지, IPC
src/main/preload.js   화면에 노출하는 API (gitApi)
src/main/git.js       git CLI 호출과 출력 해석 (log, for-each-ref, status, ls-files, stash)
src/renderer/         화면 (목업 코드 + bridge.js)
src/renderer/bridge.js 목업 화면을 실제 저장소에 연결, 쓰기 조작 차단
```

## 점검용 실행

화면 오류를 모으고 캡처를 남긴 뒤 종료합니다.

```bash
GC_SMOKE=/path/to/repo GC_SHOT=/tmp/shot.png npx electron .
```

## 다음 단계

2. 기본 쓰기: stage, 커밋, checkout, 새 브랜치, fetch / pull / push (인증 포함)
3. 드래그 조작을 실제 git 으로: cherry-pick, rebase, merge, reset + 미리보기(`git merge-tree`, `git replay`) + undo(백업 ref)
4. 실제 충돌과 진행 중 상태
5. 안전장치와 대형 저장소 성능
