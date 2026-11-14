// 배포 패키지 설정 (electron-builder)
// - 서명: 키체인에 "Developer ID Application" 인증서가 있으면 자동으로 서명한다. 없으면 서명 없이 만든다.
// - 공증(notarize): APPLE_ID · APPLE_APP_SPECIFIC_PASSWORD · APPLE_TEAM_ID 환경 변수가 있을 때만 한다.
// - 자동 업데이트: GitHub Releases 에 올린 latest-mac.yml 을 앱이 확인한다.
const notarize = !!(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "dev.yggdrasil.git",
  productName: "Git Yggdrasil",
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
  dmg: { title: "Git Yggdrasil ${version}" },
  win: { target: ["nsis"], icon: "build/icon.png" },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
  linux: { target: ["AppImage"], category: "Development", icon: "build/icon.png" },
  publish: [{ provider: "github", owner: "202021042khj", repo: "git-yggdrasil", releaseType: "release" }],
};
