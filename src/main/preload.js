// preload.js — 화면에 노출하는 최소한의 API (Node 직접 접근은 막아 둔다)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gitApi", {
  pick: () => ipcRenderer.invoke("repo:pick"),
  open: (dir) => ipcRenderer.invoke("repo:open", dir),
  read: () => ipcRenderer.invoke("repo:read"),
  diff: (file, commit) => ipcRenderer.invoke("repo:diff", { file, commit }),
  run: (op, args, extra) => ipcRenderer.invoke("repo:run", { op, args, extra }),
  onChanged: (fn) => ipcRenderer.on("repo:changed", () => fn()),
  onMenuOpen: (fn) => ipcRenderer.on("menu:open", () => fn()),
});
