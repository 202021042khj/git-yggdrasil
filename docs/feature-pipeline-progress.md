# 빠진 기능 파이프라인 진행 기록

세션이 끊기면 이 문서를 보고 이어서 진행한다. 서브에이전트에게 순서대로 맡기고(같은 파일을 건드리므로 하나씩), 메인 세션은 결과만 확인한다. 커밋은 하지 않는다(사용자가 직접, 영어 커밋 메시지).

## 요청 (2026-11-28)
"코드가 직접 막고 있는 것" → "코드에 흔적이 없는 것" 순서로, 현재 코드 컨벤션과 폴더 분류를 지켜 구현.

## 진행 상황

| 단계 | 내용 | 상태 | 결과 · 메모 |
|---|---|---|---|
| 1-A | 체크아웃 안 한 브랜치에 바로 커밋 + 과거 커밋에 변경 합치기(fixup) | 완료 | workingOps commitTo·amendInto 를 merge-tree+commit-tree 로 구현 (충돌·뒤 merge 커밋이면 거절, ⌘Z 가능), 테스트 8개 + 화면 모델 1개 |
| 1-B | 체크아웃 안 한 브랜치에 pull | 완료 | remoteOps pullOther: fetch 후 앞으로 감기는 update-ref, 갈라지면 merge-tree+commit-tree 로 merge/rebase (충돌 · upstream 없음 · 다른 worktree · pull.ff=only 면 거절, 백업 ref · ⌘Z 가능), 미리보기도 허용. 테스트 6개 + 미리보기 1개 |
| 1-C | merge 커밋이 있는 줄기 다시 쓰기 + 첫 커밋부터인 줄기 정리 | 완료 | historyOps chain 이 merge 커밋을 merge 로 다시 만듦(첫 부모만 바꾸고 곁가지 부모·작성자·메시지 유지, 첫 부모 기준 변경을 merge-tree 로 옮김) · 빈 임시 커밋으로 첫 커밋도 다시 씀(base null = --root). merge 너머 순서 변경 · merge squash 는 거절, 충돌이면 그대로 거절. fixupPast 의 merge 제한 제거. 정리 창에 merge 표시 · git 명령 표시. 테스트 6개 + 미리보기 1개 |
| 1-D | stash 적용 충돌 뒤 stash 정리 | 완료 | stashPop 이 stash 커밋 해시를 .git/ygg-stash.json 에 남기고 runOrStop 으로 멈춤 → 배너 stash 종류. 해결 후 계속이면 해시로 찾아 git stash drop (apply 면 남김, ⌘Z 는 git stash store 로 되살림), 중단이면 git reset --merge + 되살린 추적 안 하는 파일 git clean, stash 는 남김. stashDrop 도 ⌘Z 가능. 테스트 4개 |
| 2-E | 커밋 서명 (GPG / SSH) | 완료 | git/sign.ts commitTree 한 곳에서 commit.gpgsign 이면 -S (merge·rebase·reword·commitTo·pullOther 등 commit-tree 전부, 임시 커밋 제외), 서명 실패면 아무것도 안 바꾸고 i18n 오류 · git commit 실패는 안내(hint). 상세 창에 고른 커밋만 %G? 배지, 설정 창에 형식·키 표시 + 확인 후 setSigning 조작(git config --local). 테스트 4개 (임시 ssh-keygen 키, 전역 설정 격리) |
| 2-F | git bisect | 완료 | bisectOps bisectStart·bisectMark·bisectReset (그래프 오른쪽 클릭으로 시작 · 추적 파일 변경 있으면 거절), opState readBisectState 가 BISECT_START · refs/bisect 로 읽어 터미널 시작도 배너 표시. 배너에서 good/bad/skip · 남은 단계(rev-list --bisect-vars) · 찾으면 첫 나쁜 커밋 선택 · reset 으로 원래 브랜치. 그래프에 good/bad/시험 중 표시. HEAD 만 옮겨 ⌘Z 대상 아님 (진행 중 ⌘Z 거절). 테스트 3개 |
| 2-G | 패치 내보내기 / 적용 (format-patch · am) | 완료 | patchOps patchExport·patchApply. 커밋(다중 선택) 오른쪽 클릭 패치 저장·복사, 작업 영역은 diff HEAD / --cached 저장. 파일 메뉴 "패치 적용…": mbox 는 am --3way (⌘Z 가능, 충돌은 kind am 배너 continue/skip/abort), diff 는 apply --check → apply (안 맞으면 --3way, 실패 시 변경 없음, ⌘Z 대상 아님). 경로는 main 저장·열기 창에서만 (repo:run 으로는 거절). 테스트 5개 |
| 2-H | .gitignore 편집 | 완료 | ignoreOps ignoreAdd·ignoreRemove·untrackIgnore. 추적 안 하는 파일 오른쪽 클릭 이 파일 / *.ext / 폴더 / 나만 무시(.git/info/exclude), 추적 중 파일은 git rm --cached + 무시(삭제 stage 경고). ".gitignore 편집…" 창: 패턴 추가·삭제, 걸리는 파일 미리 보기(ls-files -i --exclude), check-ignore -v. ⌘Z 는 파일 이전 내용 + index 되살림. 경로 검사는 main. 테스트 7개 |
| 2-I | hooks: 커밋 정리 중 --no-verify 검토 + hook 상태 표시 | 완료 | src/main/git/hooks.ts. commit-tree 로 만드는 사용자 커밋(다른 브랜치 커밋 · fixup · 과거 메시지 수정 · 커밋 정리 메시지)에 pre-commit/commit-msg 직접 실행(core.hooksPath 따름, 고친 메시지 반영, 실패면 아무것도 안 바꿈 + hook 출력). --no-verify 는 미리 확인한 rebase todo exec 에만. 저장소별 hook 건너뛰기(yggdrasil.skipHooks → commit/push --no-verify). 설정 창에 설치된 hook · 실행 권한 · hook 폴더(husky). m.noUndo 문구 갱신. 테스트 5개 |

## 이어서 할 때
- "진행 중" 단계부터. 각 단계 끝에 `npm run typecheck · lint · test · e2e` 통과 확인.
- 규칙: `docs/ARCHITECTURE.md` "조작 추가 순서", i18n ko/en 키 짝, 테스트는 임시 저장소 · 격리 프로필(실제 키체인 · 전역 git 설정 금지).
