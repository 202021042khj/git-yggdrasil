// main.js — Electron 메인 프로세스: 창, 저장소 열기, 파일 변경 감지
const { app, BrowserWindow, dialog, ipcMain, Menu, shell, safeStorage, clipboard } = require("electron");
const github = require("./github");
const fs = require("node:fs");
const path = require("node:path");
const { git, readRepo, repoRoot, loadMore } = require("./git");
const { execute, setOpener } = require("./ops");

app.setName("Git Yggdrasil");

let win = null;
let current = null; // 열린 저장소 루트
let watchers = [];
let debounce = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0f141c",
    title: "Git Yggdrasil",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

// 저장소 파일이 바뀌면(에디터 저장, 터미널에서 git 실행 등) 화면에 알린다
function watch(root) {
  watchers.forEach((w) => w.close());
  watchers = [];
  const notify = (file) => {
    if (file && /(^|[\\/])(node_modules|\.git[\\/]objects)([\\/]|$)/.test(file)) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => win?.webContents.send("repo:changed"), 250);
  };
  try { watchers.push(fs.watch(root, { recursive: true }, (_e, f) => notify(f))); } catch {}
  try { watchers.push(fs.watch(path.join(root, ".git"), { recursive: true }, (_e, f) => notify(path.join(".git", f || "")))); } catch {}
}

async function openRepo(dir) {
  const root = await repoRoot(dir);
  if (!root) throw new Error(`git 저장소가 아닙니다: ${dir}`);
  current = root;
  watch(root);
  app.addRecentDocument(root);
  return readRepo(root);
}

ipcMain.handle("repo:pick", async () => {
  const r = await dialog.showOpenDialog(win, { title: "git 저장소 폴더 열기", properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  return openRepo(r.filePaths[0]);
});
ipcMain.handle("repo:open", (_e, dir) => openRepo(dir));
// clone: 받을 위치(상위 폴더)를 고르게 한 뒤 그 안에 저장소 이름으로 받는다
ipcMain.handle("repo:clone", async (_e, url) => {
  const r = await dialog.showOpenDialog(win, { title: "어느 폴더 안에 받을까요?", properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  const name = url.replace(/[\/]+$/, "").split(/[\/:]/).pop().replace(/\.git$/, "") || "repo";
  const dest = path.join(r.filePaths[0], name);
  if (fs.existsSync(dest)) throw new Error(`이미 같은 이름의 폴더가 있습니다: ${dest}`);
  try {
    const a = await github.gitAuth().catch(() => null);
    await git(r.filePaths[0], [...(a ? a.args : []), "clone", "--", url, dest], { timeout: 10 * 60 * 1000, env: a ? a.env : {} });
  } catch (err) {
    throw new Error(err.stderr || err.message);
  }
  return openRepo(dest);
});
ipcMain.handle("repo:read", () => (current ? readRepo(current) : null));
ipcMain.handle("repo:more", () => { if (!current) return null; loadMore(current); return readRepo(current); });
// 2단계: 실제 git 조작 실행. 결과와 함께 새로 읽은 저장소 상태를 돌려준다.
let busy = false;
ipcMain.handle("repo:run", async (_e, { op, args, extra }) => {
  if (!current) return { ok: false, error: "열린 저장소가 없습니다." };
  if (busy) return { ok: false, error: "이전 작업이 아직 실행 중입니다." };
  busy = true;
  try {
    const result = await execute(current, op, args, extra);
    result.repo = await readRepo(current);
    return result;
  } finally {
    busy = false;
  }
});
ipcMain.handle("repo:diff", async (_e, { file, commit }) => {
  if (!current) return "";
  const MAX = 400;
  const cut = (t) => { const l = (t || "").split("\n"); return l.length > MAX ? l.slice(0, MAX).join("\n") + `\n… (${l.length - MAX}줄 생략)` : l.join("\n"); };
  if (commit) return cut(await git(current, ["show", "--format=", "--no-color", commit, "--", file], { allowFail: true }));
  const d = await git(current, ["diff", "--no-color", "HEAD", "--", file], { allowFail: true });
  if (d) return cut(d);
  // 아직 추적하지 않는 새 파일: 내용 전체를 추가로 보여 준다
  try {
    const text = fs.readFileSync(path.join(current, file), "utf8");
    return cut(`새 파일\n@@ +1,${text.split("\n").length} @@\n` + text.split("\n").map((l) => "+" + l).join("\n"));
  } catch { return ""; }
});

// 점검용 실행: YGG_SMOKE=<저장소 경로> [YGG_SHOT=<png 경로>] npm start
// 저장소를 열고 화면 오류를 모은 뒤, 캡처를 남기고 종료한다
function smoke(repoDir) {
  const errors = [];
  win.webContents.on("console-message", (_e, level, message) => level >= 3 && errors.push(message));
  win.webContents.once("did-finish-load", async () => {
    await win.webContents.executeJavaScript(`localStorage.setItem("ygg-recent", JSON.stringify([${JSON.stringify(repoDir)}])); location.reload();`);
    win.webContents.once("did-finish-load", () => setTimeout(async () => {
      const info = await win.webContents.executeJavaScript(`({
        repo: state.repoName, head: state.head, commits: Object.keys(state.commits).length,
        branches: Object.keys(state.branches), nodes: document.querySelectorAll('#graph .node').length,
        welcome: !document.getElementById('welcome').classList.contains('hidden'),
        tree: document.querySelectorAll('.ft-row').length })`);
      // YGG_EVAL=<js 파일>: 화면에서 시나리오를 실행하고 결과를 함께 출력 (끝까지 이어지는지 점검용)
      if (process.env.YGG_EVAL) info.eval = await win.webContents.executeJavaScript(fs.readFileSync(process.env.YGG_EVAL, "utf8"));
      if (process.env.YGG_SHOT) fs.writeFileSync(process.env.YGG_SHOT, (await win.webContents.capturePage()).toPNG());
      console.log("SMOKE " + JSON.stringify({ ...info, errors }));
      app.quit();
    }, 1500));
  });
}

// ---------- GitHub ----------
const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);

ipcMain.handle("gh:status", () => github.status());
ipcMain.handle("gh:login", async () => {
  const d = await github.startLogin();
  clipboard.writeText(d.userCode); // gh CLI 처럼 코드를 미리 복사해 둔다
  shell.openExternal(d.verificationUri);
  github.waitLogin(d)
    .then((user) => send("gh:changed", { loggedIn: true, user }))
    .catch((err) => send("gh:changed", { ...github.status(), error: err.message }));
  return { userCode: d.userCode, verificationUri: d.verificationUri };
});
ipcMain.handle("gh:cancel", () => github.cancelLogin());
ipcMain.handle("gh:logout", () => { github.logout(); return github.status(); });
ipcMain.handle("gh:repos", () => github.listRepos());
ipcMain.handle("gh:openUrl", (_e, url) => {
  if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url);
});

// 지금 저장소를 새 GitHub 저장소로 만들어 올린다: 원격 추가 + 현재 브랜치 push
ipcMain.handle("gh:createRepo", async (_e, { name, isPrivate }) => {
  if (!current) throw new Error("열린 저장소가 없습니다.");
  const created = await github.createRepo({ name, isPrivate });
  const remotes = ((await git(current, ["remote"])) || "").split("\n").filter(Boolean);
  const remoteName = remotes.includes("origin") ? "github" : "origin";
  const add = await execute(current, "remoteAdd", [remoteName, created.cloneUrl]);
  if (!add.ok) throw new Error(add.error);
  const branch = ((await git(current, ["symbolic-ref", "--short", "-q", "HEAD"], { allowFail: true })) || "").trim();
  const cmds = [...add.cmds];
  if (branch) {
    const push = await execute(current, "push", [branch]);
    cmds.push(...push.cmds);
    if (!push.ok) throw new Error(push.error);
  }
  return { ...created, remoteName, cmds, repo: await readRepo(current) };
});

// PR 만들기: 브랜치가 원격에 없으면 먼저 push 한다
ipcMain.handle("gh:pr", async (_e, { head, base, title, body }) => {
  if (!current) throw new Error("열린 저장소가 없습니다.");
  const cmds = [];
  let up = ((await git(current, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${head}@{u}`], { allowFail: true })) || "").trim();
  if (!up) {
    const push = await execute(current, "push", [head]);
    cmds.push(...push.cmds);
    if (!push.ok) throw new Error(push.error);
    up = ((await git(current, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${head}@{u}`])) || "").trim();
  }
  const [remoteName, ...rest] = up.split("/");
  const url = ((await git(current, ["remote", "get-url", remoteName])) || "").trim();
  const fullName = github.parseRemote(url);
  if (!fullName) throw new Error(`${remoteName} 은(는) GitHub 저장소가 아닙니다: ${url}`);
  const baseBranch = base || (await github.repoInfo(fullName)).defaultBranch;
  const pr = await github.createPull({ fullName, head: rest.join("/"), base: baseBranch, title, body });
  shell.openExternal(pr.htmlUrl);
  return { ...pr, base: baseBranch, cmds, repo: await readRepo(current) };
});
ipcMain.handle("gh:prDefaults", async (_e, head) => {
  // PR 창에 미리 채울 기본 브랜치
  if (!current) return null;
  const up = ((await git(current, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${head}@{u}`], { allowFail: true })) || "").trim();
  const remoteName = up ? up.split("/")[0] : "origin";
  const url = ((await git(current, ["remote", "get-url", remoteName], { allowFail: true })) || "").trim();
  const fullName = github.parseRemote(url);
  if (!fullName) return { fullName: null };
  const info = await github.repoInfo(fullName).catch(() => null);
  return { fullName, base: info ? info.defaultBranch : "main" };
});

app.whenReady().then(() => {
  github.init({ safeStorage, userData: app.getPath("userData") });
  setOpener((file) => shell.openPath(file)); // 충돌 파일을 기본 에디터로 연다
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { label: "파일", submenu: [
      { label: "저장소 열기…", accelerator: "CmdOrCtrl+O", click: () => win?.webContents.send("menu:open") },
      { label: "URL 로 clone…", accelerator: "CmdOrCtrl+Shift+O", click: () => win?.webContents.send("menu:clone") },
      { type: "separator" }, { role: "close" },
    ] },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]));
  createWindow();
  if (process.env.YGG_SMOKE) smoke(process.env.YGG_SMOKE);
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
