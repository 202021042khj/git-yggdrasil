// gh.js — GitHub 계정 연동 화면: 로그인, 내 저장소에서 clone, 새 저장소로 올리기, PR 만들기
(() => {
  const gh = window.ghApi;
  if (!gh || !window.__ygg) return;
  const { show, open } = window.__ygg;
  let status = { loggedIn: false };
  let loginInfo = null;

  // ---------- 계정 버튼 ----------
  function renderAccount() {
    const b = $("gh-account");
    b.hidden = false;
    if (status.loggedIn && status.user) {
      const u = status.user;
      b.innerHTML = `${u.avatar ? `<img src="${esc(u.avatar)}&s=36" alt="">` : ""}${esc(u.login)}`;
      b.title = `${u.name} (${u.login}) — 클릭하면 로그아웃`;
    } else {
      b.textContent = "GitHub 로그인";
      b.title = "GitHub 계정으로 로그인하면 push·pull 인증, 내 저장소 clone, PR 만들기를 쓸 수 있습니다";
    }
    renderPublishButton();
  }

  function renderPublishButton() {
    const hasGithub = (state.remoteList || []).some((r) => /github\.com[:/]/.test(r.url));
    $("gh-publish").hidden = !state.root || hasGithub;
  }

  $("gh-account").onclick = async () => {
    if (status.loggedIn) {
      if (confirm(`GitHub 계정 ${status.user?.login || ""} 에서 로그아웃할까요?\n이 컴퓨터에 저장된 토큰을 지웁니다.`)) status = await gh.logout();
      return renderAccount();
    }
    login();
  };

  async function login() {
    try {
      loginInfo = await gh.login();
    } catch (err) {
      afterLogin?.(false);
      afterLogin = null;
      return toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    }
    $("gh-code").textContent = loginInfo.userCode;
    $("gh-login-status").textContent = "승인을 기다리는 중…";
    $("gh-login").showModal();
  }
  // 로그인 창이 떠 있는 동안 기다렸다가 끝나면 이어서 할 일
  function requireLogin() {
    if (status.loggedIn) return Promise.resolve(true);
    return new Promise((resolve) => {
      afterLogin = resolve;
      login();
    });
  }
  let afterLogin = null;

  $("gh-reopen").onclick = () => loginInfo && gh.openUrl(loginInfo.verificationUri);
  $("gh-cancel").onclick = () => { gh.cancel(); $("gh-login").close(); afterLogin?.(false); afterLogin = null; };

  gh.onChanged((s) => {
    status = s;
    renderAccount();
    if ($("gh-login").open) $("gh-login").close();
    if (s.error) toast(s.error);
    else if (s.loggedIn) toast(`GitHub 에 ${s.user.login} 로 로그인했습니다.`);
    afterLogin?.(!!s.loggedIn);
    afterLogin = null;
  });

  // ---------- 내 저장소에서 clone ----------
  let repos = [];
  function renderRepoList() {
    const q = $("gh-filter").value.trim().toLowerCase();
    const list = repos.filter((r) => !q || r.fullName.toLowerCase().includes(q));
    $("gh-repo-list").innerHTML = list.length
      ? list.map((r, i) => `<button type="button" role="listitem" class="gh-repo" data-i="${repos.indexOf(r)}">
          <span class="n">${esc(r.fullName)}${r.private ? " · 비공개" : ""}</span>
          <span class="d">${esc(r.description || "")}</span></button>`).join("")
      : `<p class="muted">찾는 저장소가 없습니다.</p>`;
    $("gh-repo-list").querySelectorAll("[data-i]").forEach((b) => (b.onclick = async () => {
      const r = repos[+b.dataset.i];
      $("gh-repos").close();
      toast(`clone 하는 중… ${r.fullName}`);
      document.body.classList.add("busy");
      await open(gitApi.clone(r.cloneUrl));
      document.body.classList.remove("busy");
    }));
  }
  $("gh-filter").oninput = renderRepoList;
  $("gh-repos-close").onclick = () => $("gh-repos").close();
  $("welcome-gh").onclick = async () => {
    if (!(await requireLogin())) return;
    try {
      repos = await gh.repos();
    } catch (err) {
      return toast(String(err.message || err));
    }
    $("gh-filter").value = "";
    renderRepoList();
    $("gh-repos").showModal();
    $("gh-filter").focus();
  };

  // ---------- 지금 저장소를 GitHub 에 새로 만들어 올리기 ----------
  $("gh-publish").onclick = async () => {
    if (!(await requireLogin())) return;
    const name = await askText("새 GitHub 저장소 이름", state.repoName || "", `${status.user.login} 계정에 만들고, 원격으로 연결한 뒤 ${state.head} 브랜치를 push 합니다.`);
    if (!name) return;
    const isPrivate = confirm(`${status.user.login}/${name} 을(를) 비공개 저장소로 만들까요?\n확인 = 비공개, 취소 = 공개`);
    toast(`GitHub 에 ${name} 저장소를 만드는 중…`);
    document.body.classList.add("busy");
    try {
      const r = await gh.createRepo(name, isPrivate);
      log.push({ summary: `GitHub 저장소 ${r.fullName} 만들고 올리기`, cmd: [`POST /user/repos  # ${r.fullName}${isPrivate ? " (비공개)" : ""}`, ...r.cmds].join("\n") });
      show(r.repo);
      toast(`${r.fullName} 에 올렸습니다.`);
    } catch (err) {
      toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      document.body.classList.remove("busy");
    }
  };

  // ---------- PR 만들기 (브랜치 이름표 오른쪽 클릭 메뉴) ----------
  async function makePR(branch) {
    if (!(await requireLogin())) return;
    const d = await gh.prDefaults(branch).catch(() => null);
    if (!d || !d.fullName) return toast("이 브랜치의 원격이 GitHub 저장소가 아닙니다. 먼저 GitHub 원격을 연결하세요.");
    const base = await askText("어느 브랜치로 합칠까요? (base)", d.base, `${d.fullName} 에 PR 을 만듭니다. ${branch} 가 원격에 없으면 먼저 push 합니다.`);
    if (!base) return;
    if (base === branch) return toast("같은 브랜치로는 PR 을 만들 수 없습니다.");
    const tip = state.commits[state.branches[branch]];
    const title = await askText("PR 제목", tip ? tip.msg.split("\n")[0] : branch);
    if (!title) return;
    toast("PR 을 만드는 중…");
    document.body.classList.add("busy");
    try {
      const r = await gh.pr({ head: branch, base, title });
      log.push({ summary: `PR #${r.number}: ${branch} → ${r.base}`, cmd: [...r.cmds, `gh pr create --base ${r.base} --head ${branch} --title ${JSON.stringify(title)}`].join("\n") });
      show(r.repo);
      toast(`PR #${r.number} 을 만들고 브라우저에서 열었습니다.`);
    } catch (err) {
      toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      document.body.classList.remove("busy");
    }
  }

  const baseContextItems = contextItems;
  contextItems = function (src) {
    const items = baseContextItems(src);
    if (src.kind === "label" && state.branches[src.branch] && src.branch !== "HEAD") {
      items.push({
        label: "GitHub PR 만들기…", verb: "GitHub PR 만들기", src, tgt: { kind: "github" },
        res: { cmd: "gh pr create", conflicts: [], rewrites: [], state: { op: null } },
        custom: () => makePR(src.branch),
      });
    }
    return items;
  };

  // 저장소를 다시 그릴 때마다 "GitHub 에 올리기" 버튼 표시 여부를 맞춘다
  const baseRenderTree = renderTree;
  renderTree = function () { baseRenderTree(); renderPublishButton(); };

  gh.status().then((s) => { status = s; renderAccount(); });
})();
