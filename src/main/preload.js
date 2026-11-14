// preload.js — 화면에 노출하는 최소한의 API (Node 직접 접근은 막아 둔다)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ghApi", {
  status: () => ipcRenderer.invoke("gh:status"),
  login: () => ipcRenderer.invoke("gh:login"),
  cancel: () => ipcRenderer.invoke("gh:cancel"),
  logout: () => ipcRenderer.invoke("gh:logout"),
  repos: () => ipcRenderer.invoke("gh:repos"),
  createRepo: (name, isPrivate) => ipcRenderer.invoke("gh:createRepo", { name, isPrivate }),
  pr: (args) => ipcRenderer.invoke("gh:pr", args),
  prDefaults: (head) => ipcRenderer.invoke("gh:prDefaults", head),
  openUrl: (url) => ipcRenderer.invoke("gh:openUrl", url),
  onChanged: (fn) => ipcRenderer.on("gh:changed", (_e, s) => fn(s)),
});

contextBridge.exposeInMainWorld("gitApi", {
  pick: () => ipcRenderer.invoke("repo:pick"),
  open: (dir) => ipcRenderer.invoke("repo:open", dir),
  clone: (url) => ipcRenderer.invoke("repo:clone", url),
  onMenuClone: (fn) => ipcRenderer.on("menu:clone", () => fn()),
  read: () => ipcRenderer.invoke("repo:read"),
  diff: (file, commit) => ipcRenderer.invoke("repo:diff", { file, commit }),
  run: (op, args, extra) => ipcRenderer.invoke("repo:run", { op, args, extra }),
  onChanged: (fn) => ipcRenderer.on("repo:changed", () => fn()),
  onMenuOpen: (fn) => ipcRenderer.on("menu:open", () => fn()),
});
