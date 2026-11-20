# 랜딩 페이지 파이프라인 진행 기록

세션이 끊기면 이 문서를 보고 이어서 진행한다. (Claude 가 단계마다 갱신)

## 요청 (2026-11-18)

서브에이전트에게 순서대로 맡기고, 메인 세션은 결과만 확인한다. 커밋은 하지 않는다 (사용자가 직접 커밋).

1. `/Users/khj/workspace/payday-developers-fe-copy-20261118` 홈 화면(http://localhost:3000/) 분석 — 코드 + 실제 화면
2. 분석을 바탕으로 글은 더미, 사진·영상 자리는 플레이스홀더인 템플릿을 Figma 파일 `J4G2E1mwhtdXEKeJm7ivtf` 에 만든다
3. 같은 Figma 파일의 디자인 룰·에셋·컴포넌트로 템플릿을 채운다
   - 영상 자리: git-yggdrasil 앱을 조작하는 시연 영상 (커서를 따라 초점 이동 · 줌인)
   - 캡처 자리: 앱 캡처 + 기능별 설명 글
   - 로그인 기능은 없으므로 버튼은 더미
4. `/Users/khj/workspace/khj-fe-template` 를 `git-yggdrasil-landing-fe` 로 통째로 복제하고 3의 디자인을 코드로 구현

## 진행 상황

| 단계 | 상태 | 결과물 |
|---|---|---|
| 1 분석 | 완료 | 보고서 `payday-home-analysis.md`, 캡처 `payday-shots/*.jpg` (아래 "임시 파일" 위치) |
| 2 Figma 더미 템플릿 | 완료 | 페이지 "Template · Home (dummy)" `20:30` — 데스크톱 `22:39`, 모바일 `23:144`, 상호작용 메모 `23:323`, 컴포넌트 Tmpl/* (`20:31`~`20:100`) |
| 3a 시연 영상 · 캡처 만들기 | 완료 | 스크래치패드 `landing-assets/`: demo.mp4 (1920×1200, 24초, H.264), poster.png, shot-*.png 10장 (2732×1708), features.md (기능별 제목·설명), 다시 만드는 스크립트 shots.mjs · record.mjs · compose.py · encode.swift · lib.mjs. ffmpeg 이 없어 webm 은 없음 |
| 3b Figma 디자인 적용 | 완료 | 페이지 "Landing · Home" `24:30` — 데스크톱 `25:30`, 모바일 `26:130`, 이미지 원본 프레임 `24:31`. 섹션 이름은 Section/* 로 와이어프레임과 같다 |
| 4 코드 구현 | 완료 | `/Users/khj/workspace/git-yggdrasil-landing-fe` (khj-fe-template 복제, .git 새로 init, 커밋 안 함). Next.js 16 + Tailwind v4, lint · build 통과, `/` 정적 생성. 미디어는 `public/media/` |

## 2차 수정 (2026-11-18, 완료)

- 로고를 Y 모양으로 (Figma 3:175/3:186/3:197 그림 교체, 앱 IconSprite · build/icon.svg · icon.png, 랜딩 LogoMark)
- 랜딩: 상단바 z-index 원인(Tailwind v4 에 z 토큰 유틸 없음) → globals.css `@utility z-*`, 구조 점검 docs/REVIEW-landing.md
- 히어로 문구 "Yggdrasil로 git을 쉽게 관리하세요", macOS 전용 표현 제거 (코드 + Figma)
- payday 모션 이식: 점 격자 WebGL, 히어로 고정 + 영상 창 열림, 시작 가이드 카드 넓어짐, 변경 기록 펼침, 누름 효과 (docs/REVIEW-landing.md "모션")
- 다음 후보: i18n (랜딩 약 1시간 → 앱 약 3~5시간)

## 3차 수정 (2026-11-18)

- 히어로 제목을 "Yggdrasil로 git을 쉽게 관리하세요"로 (부제목 없음, 코드 + Figma), 점 격자 배경과 코드 삭제
- 시작 가이드 고정 중 높이가 출렁이던 문제: hooks/useStartGuidePin.ts 가 네 상태의 줄 높이를 재서 가장 큰 값을 줄의 min-height 로 (요소에 직접 씀, 글꼴 로드 뒤 다시 잼). 잴 때 전환을 끄는 CSS 규칙이 기존 전환 규칙보다 구체성이 낮아 안 먹던 것도 고침. 1440×900 에서 1~4단계 모두 321px 로 같음을 확인 (2026-11-19)

## 4차 작업 (2026-11-20, 완료 · 커밋 전)

- 다운로드 페이지: Figma "Landing · Download"(39:16) + 랜딩 /download (OS · 칩 감지, macOS/Windows 나란히, 서명 전 첫 실행 안내, sha256 확인)
- 앱 i18n 영어: src/shared/i18n (ko/en 734 키), 설정 "언어 / Language", E2E i18n.spec
- 랜딩 i18n: app/[lang] (ko/en 정적), proxy.ts 로 / → 언어 경로, 로그인 버튼 자리에 언어 드롭다운 (Figma 44:138)
- 남은 결정: GitHub 릴리스 없음(다운로드 링크 404), 파일 이름의 버전, 앱 docs/RELEASE.md 의 "우클릭 → 열기" 문구, 사이트 도메인(NEXT_PUBLIC_SITE_URL), Figma 모바일 서랍

## 남은 일 (4단계 보고 기준)

- Figma SVG 에셋 링크가 404 라 도형(히어로 · 도움 띠 · 재생 단추)은 코드로 다시 그림 — 도움 띠 배치는 Figma 와 조금 다름
- 다크 모드 색은 Figma 값이 없어 임의로 만든 따뜻한 어두운 톤
- 모바일 아래쪽 섹션은 Figma 와 자세히 비교하지 못함
- 템플릿 자체 파일(components/ui 등)이 lint 에 걸려 eslint.config.mjs 에 그 파일들만 규칙 3개를 끄는 예외를 둠
- 로그인 · 다운로드 · GitHub 등 버튼은 모두 더미 (코드에 TODO)

## 1단계 요약

- 원본: Next.js 16 App Router + styled-components. 데스크톱/모바일 트리가 따로 있고 768px 에서 갈림.
- 본문 폭 1280 (1440 기준 좌우 80), 섹션 위아래 여백 120.
- 섹션 순서: 고정 헤더(72, 모바일 56 + 햄버거) → 히어로(점 격자 배경, 72px 제목, 버튼 2, 스크롤 고정 중 16:10 영상이 올라오며 넓어짐) → 기능 5줄(이미지·글 번갈아, 스크린샷 약 648×440) → 시작 가이드 카드 4(스크롤 고정, 하나씩 넓어짐) → 진행 흐름 3단 → 확인 목록 4 → 소식 2단(공지 · 펼치는 변경 기록) → 어두운 도움 띠(버튼 2) → 어두운 푸터.

## 임시 파일 (스크래치패드, 재부팅 시 사라질 수 있음)

`/private/tmp/claude-501/-Users-khj-workspace-git-yggdrasil/6278b587-6089-4cda-8dd8-a646d17a4f19/scratchpad/`
- `payday-home-analysis.md` — 1단계 보고서
- `payday-shots/` — 1단계 캡처 8장

## 이어서 할 때

- 위 표에서 "진행 중"인 단계부터. 2단계가 끝났는지는 Figma 파일에 "Template · Home (dummy)" 페이지가 완성됐는지로 확인.
- 디자인 룰: 같은 Figma 파일의 "Foundations" (랜딩: 세리프 이탤릭 · sage/clay/ink · 바우하우스) 와 "Logo", "Landing" 페이지. 앱 화면은 "App · *" 페이지.
- 제품 이름: 대외 "Yggdrasil", 설명 "Yggdrasil for Git".
