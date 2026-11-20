// 배포 패키지 설정 (electron-builder)
// - 서명: 키체인에 "Developer ID Application" 인증서가 있으면 자동으로 서명한다. 없으면 서명 없이 만든다.
// - 공증(notarize): APPLE_ID · APPLE_APP_SPECIFIC_PASSWORD · APPLE_TEAM_ID 환경 변수가 있을 때만 한다.
// - 자동 업데이트: GitHub Releases 에 올린 latest-mac.yml 을 앱이 확인한다.
const notarize = !!(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "dev.yggdrasil.git",
  productName: "Yggdrasil",
  copyright: "Copyright © 2026",
  directories: { output: "dist", buildResources: "build" },
  files: ["out/**/*", "package.json"],
  asar: true,
  mac: {
    category: "public.app-category.developer-tools",
    target: [{ target: "dmg", arch: ["arm64", "x64"] }, { target: "zip", arch: ["arm64", "x64"] }], // zip 은 자동 업데이트용
    icon: "build/icon.png",
    hardenedRuntime: true,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    notarize,
  },
  // 파일 이름에 버전을 넣지 않는다: 랜딩의 releases/latest/download/<이름> 주소가 릴리스마다 그대로 맞도록
  // (자동 업데이트는 latest*.yml 에 적힌 이름을 보므로 상관없다)
  artifactName: "Yggdrasil-mac-${arch}.${ext}",
  dmg: { title: "Yggdrasil ${version}", artifactName: "Yggdrasil-mac-${arch}.${ext}" },
  win: { target: ["nsis"], icon: "build/icon.png" },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, artifactName: "Yggdrasil-windows-setup.${ext}" },
  linux: { target: ["AppImage"], category: "Development", icon: "build/icon.png", artifactName: "Yggdrasil-linux-x64.${ext}" /* AppImage 의 ${arch} 는 x86_64 라 고정 */ },
  publish: [{ provider: "github", owner: "202021042khj", repo: "git-yggdrasil", releaseType: "release" }],
};
