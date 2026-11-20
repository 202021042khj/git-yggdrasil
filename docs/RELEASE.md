# 배포 (패키지 · 서명 · 자동 업데이트)

## 만들기

```bash
npm run dist:mac   # macOS: dist/ 에 .dmg (설치용) 와 .zip (자동 업데이트용), arm64 · x64
npm run dist       # 지금 OS 용
```

설정은 `electron-builder.config.cjs`, 아이콘은 `build/icon.svg` → `build/icon.png`(1024, 투명 배경)입니다.

## 서명 없이 만든 경우 (지금 상태)

키체인에 **Developer ID Application** 인증서가 없으면 서명 없이 만듭니다. 내 컴퓨터에서 쓰거나 몇 사람에게 나눠 보기에는 되지만:

- 받은 사람은 처음 열 때 "확인되지 않은 개발자" 경고가 뜹니다. Finder 에서 앱을 **오른쪽 클릭 → 열기** 로 한 번 열면 됩니다.
- macOS 는 서명 없는 앱의 **자동 업데이트 설치를 막습니다.** (확인만 하고 조용히 넘어갑니다.)
- 빌드할 때마다 앱 서명이 달라져, 저장해 둔 GitHub 로그인을 읽을 때 키체인 확인 창이 다시 뜰 수 있습니다.

참고: 키체인의 "Apple Development" 인증서는 개발 기기용이라 배포 서명에는 쓸 수 없습니다.

## 정식 배포 (서명 + 공증)

1. Apple Developer Program 에 가입하고, Xcode → Settings → Accounts → Manage Certificates 에서 **Developer ID Application** 인증서를 만듭니다. (키체인에 들어가면 electron-builder 가 자동으로 찾아 서명합니다.)
2. appleid.apple.com 에서 **앱 암호**를 만들고, 빌드하는 터미널에 환경 변수를 둡니다. 셋이 모두 있으면 공증까지 합니다.

   ```bash
   export APPLE_ID="애플 계정 이메일"
   export APPLE_APP_SPECIFIC_PASSWORD="앱 암호"
   export APPLE_TEAM_ID="팀 ID (10자리)"
   ```

3. `npm run dist:mac`

비밀 값은 저장소에 넣지 말고 터미널 환경 변수(또는 CI 의 비밀 변수)로만 씁니다.

## 자동 업데이트 (GitHub Releases)

앱은 켤 때 한 번, 그리고 메뉴 **Yggdrasil → 업데이트 확인…** 으로 `202021042khj/git-yggdrasil` 의 최신 릴리스를 확인합니다. 새 버전이 있으면 받아 두었다가 재시작할 때 설치합니다.

새 버전 올리는 순서 (GitHub Actions `.github/workflows/release.yml` 이 빌드 · 릴리스를 한다):

1. `package.json` 의 `version` 을 올리고 커밋 · push 합니다 (예: 0.2.0).
2. 같은 버전의 태그를 **한 줄 요약과 함께**(영어) 만들고 push 합니다:
   `git tag -a v0.2.0 -m "Conflict editor and faster graphs" && git push origin v0.2.0`
   태그 메시지가 릴리스 본문 맨 위에 들어가고, 첫 줄이 랜딩 페이지 "릴리스 노트" 의 요약이 됩니다. 그 아래에 커밋 · PR 목록이 자동으로 붙습니다.
3. Actions 가 macOS · Windows · Linux 에서 빌드하고 `v0.2.0` 릴리스를 바로 공개로 만듭니다 (약 10~15분). 태그와 `version` 이 다르면 실패합니다.

- 커밋 메시지는 영어로 씁니다 (랜딩 페이지 "변경 기록" 에 그대로 보입니다).
- 파일 이름에는 버전이 없습니다 (`Yggdrasil-mac-arm64.dmg`, `Yggdrasil-mac-x64.dmg`, `Yggdrasil-windows-setup.exe`, `Yggdrasil-linux-x64.AppImage`). 랜딩의 `releases/latest/download/<파일>` 링크가 릴리스마다 그대로 맞습니다. 이름을 바꾸면 랜딩 `features/download/constants.ts` 도 같이 바꿉니다.
- 손으로 올릴 때는 `GH_TOKEN` 을 두고 `npm run release` (지금 OS 용만 올라감).
- 저장소가 **비공개**면 설치된 앱이 릴리스를 읽을 수 없어 자동 업데이트가 동작하지 않습니다. 공개 저장소에 릴리스를 올리거나, 별도의 업데이트 서버(generic provider)를 쓰세요.
- macOS 자동 업데이트는 서명된 앱에서만 설치됩니다.
