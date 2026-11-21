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

### 브랜치와 출시 흐름

```
기능 브랜치 · dev ─PR(CI 통과)─▶ main ─▶ release-please 가 "chore(main): release x.y.z" PR 을 열어 둔다
                                              │ 병합
                                              ▼
                     태그 vx.y.z + 초안 릴리스(CHANGELOG) → release.yml: 3개 OS 빌드 · 서명 검증 · 스모크 테스트
                                              ▼
                              초안에 설치 파일 + SHA256SUMS.txt → 확인 → Publish
```

- **`dev`** 에서 작업하고, 출시할 때 `dev` → `main` PR 을 만들어 병합합니다. `main` = 출시되는 코드.
- **버전과 CHANGELOG 는 손으로 올리지 않습니다.** release-please(`.github/workflows/release-please.yml`)가 커밋 메시지로 정합니다.
  - `fix:` → 0.1.3, `feat:` → 0.2.0, `feat!:` 또는 본문의 `BREAKING CHANGE:` → 다음 큰 버전
  - `docs: · style: · refactor: · chore: · ci: · test:` 는 버전을 올리지 않고 CHANGELOG 에도 나오지 않습니다
  - 그래서 **커밋 메시지는 영어 Conventional Commits** 로 씁니다 (랜딩 "변경 기록" 과 릴리스 본문에 그대로 보입니다)
- release PR 을 병합하면 태그와 **초안** 릴리스가 생기고, `release.yml` 이 설치 파일을 올립니다 (약 15분). 
- **Publish 전에 확인**: 초안의 `.dmg` · `.exe` 를 한 번 받아 열어 보고, GitHub Releases 에서 Publish 합니다. Publish 해야 랜딩의 다운로드 링크와 앱 자동 업데이트에 보입니다.
- `release.yml` 이 막는 것:
  - 태그 커밋이 `main` 에 없으면 실패 (dev 에서 실수로 배포되지 않게)
  - 태그와 `package.json` 버전이 다르면 실패
  - macOS 서명이 앱 내용과 안 맞으면 실패 (`codesign --verify` — "손상됨" 문제)
  - 빌드한 실제 앱을 켜서 저장소가 안 열리거나 화면 오류가 나면 실패 (`scripts/smoke-packaged.mjs`, OS 마다)
- 비상용: `main` 의 커밋에 `git tag -a v0.2.1 -m "One-line summary" && git push origin v0.2.1` 로 직접 태그를 올려도 같은 빌드가 돕니다 (이때도 초안). 이미 있는 태그를 다시 빌드하려면 Actions › Release › Run workflow 에 태그를 넣습니다.
- 의존성 업데이트는 Dependabot 이 매주 `dev` 로 PR 을 엽니다 (Electron 묶음은 따로). CI 가 통과하면 병합합니다.

### GitHub 설정 (한 번만)

1. `main` 브랜치 만들기: `git push origin dev:main`
2. Settings › Branches › Add rule (`main`): **Require a pull request before merging**, **Require status checks to pass** (CI 의 두 job)
3. Settings › Actions › General › Workflow permissions: **Allow GitHub Actions to create and approve pull requests** 켜기 (release-please 가 PR 을 연다)
4. 2번처럼 CI 통과를 필수로 했다면: 기본 토큰이 만든 PR 에는 CI 가 돌지 않으므로, contents · pull requests 쓰기 권한의 fine-grained 토큰을 만들어 **`RELEASE_PLEASE_TOKEN`** 시크릿으로 넣습니다
5. Settings › Code security: **Dependabot alerts / security updates** 켜기

- 파일 이름에는 버전이 없습니다 (`Yggdrasil-mac-arm64.dmg`, `Yggdrasil-mac-x64.dmg`, `Yggdrasil-windows-setup.exe`, `Yggdrasil-linux-x64.AppImage`). 랜딩의 `releases/latest/download/<파일>` 링크가 릴리스마다 그대로 맞습니다. 이름을 바꾸면 랜딩 `features/download/constants.ts` 도 같이 바꿉니다.
- 저장소가 **비공개**면 설치된 앱이 릴리스를 읽을 수 없어 자동 업데이트가 동작하지 않습니다. 공개 저장소에 릴리스를 올리거나, 별도의 업데이트 서버(generic provider)를 쓰세요.
- macOS 자동 업데이트는 서명된 앱에서만 설치됩니다.
