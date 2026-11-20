// 화면에 노출하는 최소한의 API (Node 직접 접근은 막아 둔다)
import { contextBridge, ipcRenderer } from "electron";
import type { GhApi, GhStatus, GitApi } from "@shared/types/ipc";

const on = (channel: string, fn: (...a: any[]) => void) => { ipcRenderer.on(channel, (_e, ...a) => fn(...a)); };

const gitApi: GitApi = {
  pick: () => ipcRenderer.invoke("repo:pick"),
  open: (dir) => ipcRenderer.invoke("repo:open", dir),
  pickDir: (title) => ipcRenderer.invoke("repo:pickDir", title),
  clone: (url, retry) => ipcRenderer.invoke("repo:clone", url, retry),
  read: () => ipcRenderer.invoke("repo:read"),
  init: () => ipcRenderer.invoke("repo:init"),
  more: () => ipcRenderer.invoke("repo:more"),
  diff: (file, commit, opts) => ipcRenderer.invoke("repo:diff", { file, commit, opts }),
  run: (op, args, extra) => ipcRenderer.invoke("repo:run", { op, args, extra }),
  search: (query) => ipcRenderer.invoke("query:search", query),
  fileHistory: (file) => ipcRenderer.invoke("query:fileHistory", file),
  blame: (file, commit) => ipcRenderer.invoke("query:blame", { file, commit }),
  saveCredential: (args) => ipcRenderer.invoke("cred:save", args),
  forgetCredential: (url) => ipcRenderer.invoke("cred:forget", url),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  getLocale: () => ipcRenderer.invoke("settings:locale"),
  onMenuSettings: (fn) => on("menu:settings", fn),
  reflog: () => ipcRenderer.invoke("query:reflog"),
  conflictText: (file) => ipcRenderer.invoke("query:conflictText", file),
  hunks: (file, staged) => ipcRenderer.invoke("query:hunks", { file, staged }),
  onChanged: (fn) => on("repo:changed", fn),
  onMenuOpen: (fn) => on("menu:open", fn),
  onMenuClone: (fn) => on("menu:clone", fn),
  onMenuSearch: (fn) => on("menu:search", fn),
};

const ghApi: GhApi = {
  status: () => ipcRenderer.invoke("gh:status"),
  login: () => ipcRenderer.invoke("gh:login"),
  cancel: () => ipcRenderer.invoke("gh:cancel"),
  logout: () => ipcRenderer.invoke("gh:logout"),
  repos: () => ipcRenderer.invoke("gh:repos"),
  createRepo: (name, isPrivate) => ipcRenderer.invoke("gh:createRepo", { name, isPrivate }),
  pr: (args) => ipcRenderer.invoke("gh:pr", args),
  prDefaults: (head) => ipcRenderer.invoke("gh:prDefaults", head),
  pulls: () => ipcRenderer.invoke("gh:pulls"),
  openUrl: (url) => ipcRenderer.invoke("gh:openUrl", url),
  onChanged: (fn) => on("gh:changed", (s: GhStatus) => fn(s)),
};

contextBridge.exposeInMainWorld("gitApi", gitApi);
contextBridge.exposeInMainWorld("ghApi", ghApi);
// 개발·테스트 실행일 때만 main 이 --ygg-debug 를 넘긴다 (renderer 의 점검 도구 켜기)
contextBridge.exposeInMainWorld("yggEnv", { debug: process.argv.includes("--ygg-debug") });
