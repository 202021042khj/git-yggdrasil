// main.js — Electron 메인 프로세스: 창, 저장소 열기, 파일 변경 감지
const { app, BrowserWindow, dialog, ipcMain, Menu } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { git, readRepo, repoRoot } = require("./git");
const { execute } = require("./ops");

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
    await git(r.filePaths[0], ["clone", "--", url, dest], { timeout: 10 * 60 * 1000 });
  } catch (err) {
    throw new Error(err.stderr || err.message);
  }
  return openRepo(dest);
});
ipcMain.handle("repo:read", () => (current ? readRepo(current) : null));
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

app.whenReady().then(() => {
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
