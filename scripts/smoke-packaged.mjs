// 빌드한(패키지) 앱 스모크 테스트: 임시 git 저장소를 만들고, dist/ 의 실제 앱을 점검 모드로 켜서
// 저장소가 열리고 커밋 그래프가 그려지는지, 화면 오류가 없는지 확인한다. (CI release.yml 에서 OS 마다 실행)
//   node scripts/smoke-packaged.mjs            → 이 OS 의 dist/*-unpacked · .app 을 찾아 실행
// 실패하면 종료 코드 1. 실제 설정 · 키체인은 건드리지 않는다 (YGG_SMOKE 는 임시 프로필을 쓴다).
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");

function findApp() {
  if (process.platform === "darwin") {
    for (const dir of ["mac-arm64", "mac"]) {
      const exe = path.join(dist, dir, "Yggdrasil.app", "Contents", "MacOS", "Yggdrasil");
      if (fs.existsSync(exe) && (dir === "mac-arm64") === (process.arch === "arm64")) return exe;
    }
  }
  if (process.platform === "win32") {
    const exe = path.join(dist, "win-unpacked", "Yggdrasil.exe");
    if (fs.existsSync(exe)) return exe;
  }
  if (process.platform === "linux") {
    const dir = path.join(dist, "linux-unpacked");
    for (const name of ["yggdrasil", "git-yggdrasil", "Yggdrasil"]) {
      const exe = path.join(dir, name);
      if (fs.existsSync(exe)) return exe;
    }
  }
  throw new Error(`이 OS(${process.platform}/${process.arch}) 용 앱을 dist/ 에서 찾지 못했습니다`);
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-smoke-repo-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Smoke");
  git("config", "user.email", "smoke@example.com");
  git("config", "commit.gpgsign", "false");
  for (const [i, msg] of ["first", "second", "third"].entries()) {
    fs.writeFileSync(path.join(dir, "file.txt"), `${i}\n`);
    git("add", "-A");
    git("commit", "-q", "-m", msg);
  }
  return dir;
}

const exe = findApp();
const repo = makeRepo();
const out = path.join(os.tmpdir(), `ygg-smoke-${Date.now()}.json`);
console.log(`앱: ${exe}\n저장소: ${repo}`);

const child = spawn(exe, [], {
  env: { ...process.env, YGG_SMOKE: repo, YGG_SMOKE_OUT: out, YGG_LANG: "en", ELECTRON_ENABLE_LOGGING: "1" },
  stdio: "inherit",
});
const timer = setTimeout(() => {
  console.error("시간 초과 (90초): 앱이 끝나지 않았습니다");
  child.kill();
  process.exit(1);
}, 90_000);

child.on("exit", (code) => {
  clearTimeout(timer);
  if (!fs.existsSync(out)) {
    console.error(`결과 파일이 없습니다 (앱 종료 코드 ${code})`);
    process.exit(1);
  }
  const result = JSON.parse(fs.readFileSync(out, "utf8"));
  console.log("결과:", result);
  const problems = [];
  if (result.welcome) problems.push("저장소가 열리지 않고 시작 화면에 머물렀습니다");
  if (result.nodes < 3) problems.push(`커밋 그래프 노드가 ${result.nodes}개입니다 (3개 기대)`);
  if (result.errors?.length) problems.push(`화면 오류 ${result.errors.length}개: ${result.errors.join(" | ")}`);
  if (problems.length) {
    console.error("스모크 테스트 실패:\n- " + problems.join("\n- "));
    process.exit(1);
  }
  console.log("스모크 테스트 통과");
});
