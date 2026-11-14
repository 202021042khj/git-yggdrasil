// 원격(SSH·HTTPS) 접속 오류를 사람이 읽을 수 있는 안내로 바꾼다
// git·ssh 의 영어 오류 문구(LC_ALL=C)를 보고 원인과 해결 방법을 고른다.

export interface RemoteHint {
  /** 한 줄 원인 */
  title: string;
  /** 해결 방법 (여러 줄 가능) */
  fix: string;
}

const host = (stderr: string) => /(?:Host key verification failed|resolve hostname|Connection (?:refused|timed out)|connect to host) ?(?:for )?([\w.-]+)?/.exec(stderr)?.[1];

const RULES: Array<{ test: RegExp; hint: (stderr: string) => RemoteHint }> = [
  {
    test: /Permission denied \(publickey/,
    hint: () => ({
      title: "SSH 키로 인증하지 못했습니다.",
      fix: [
        "· 키가 없다면 터미널에서 ssh-keygen -t ed25519 로 만들고, 공개 키(~/.ssh/id_ed25519.pub)를 GitHub 설정 → SSH and GPG keys 에 등록하세요.",
        "· 키에 암호가 걸려 있다면 ssh-add --apple-use-keychain ~/.ssh/id_ed25519 로 에이전트에 올려 두세요. 앱은 암호를 직접 묻지 않습니다.",
        "· 또는 원격 주소를 HTTPS(https://github.com/…)로 바꾸고 GitHub 로그인으로 인증하세요.",
      ].join("\n"),
    }),
  },
  {
    test: /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/,
    hint: (s) => ({
      title: /CHANGED/.test(s) ? "서버의 SSH 호스트 키가 예전과 다릅니다." : "처음 접속하는 SSH 서버라 호스트 키를 확인하지 못했습니다.",
      fix: /CHANGED/.test(s)
        ? "중간자 공격일 수도 있으니 서비스 공지를 먼저 확인하세요. 정상적인 변경이면 터미널에서 ssh-keygen -R <호스트> 로 옛 키를 지우고 다시 접속해 확인하세요."
        : "터미널에서 한 번 ssh -T git@github.com 처럼 접속해 지문을 확인하고 yes 를 누르면, 그다음부터 앱에서도 됩니다.",
    }),
  },
  {
    test: /Could not resolve hostname|Could not resolve host/,
    hint: (s) => ({ title: `서버 주소${host(s) ? ` ${host(s)}` : ""}를 찾지 못했습니다.`, fix: "인터넷 연결과 원격 주소 철자를 확인하세요." }),
  },
  {
    test: /Connection (refused|timed out)|Operation timed out|timed out after|시간 초과/,
    hint: () => ({ title: "원격 서버에 연결하지 못했습니다 (시간 초과 또는 거부).", fix: "인터넷·VPN·방화벽을 확인하세요. 회사망에서 SSH(22번 포트)가 막혀 있다면 HTTPS 주소를 쓰세요." }),
  },
  {
    test: /could not read Username|terminal prompts disabled|Authentication failed|Invalid username or password/,
    hint: (s) => ({
      title: "HTTPS 인증 정보가 없거나 맞지 않습니다.",
      fix: /github\.com/.test(s)
        ? "위의 GitHub 로그인 버튼으로 로그인하면 github.com 원격에 자동으로 인증합니다."
        : "이 호스트는 GitHub 로그인을 쓰지 않습니다. 터미널에서 한 번 접속해 자격 증명 도우미(git credential)에 저장하거나, SSH 주소를 쓰세요.",
    }),
  },
  {
    test: /Repository not found|does not appear to be a git repository|returned error: 404/,
    hint: () => ({ title: "원격 저장소를 찾지 못했습니다.", fix: "주소가 맞는지, 그 저장소에 접근 권한이 있는 계정으로 인증했는지 확인하세요. 비공개 저장소는 권한이 없으면 '없음'으로 보입니다." }),
  },
  {
    test: /Permission to .* denied|returned error: 403/,
    hint: () => ({ title: "이 저장소에 쓸 권한이 없습니다.", fix: "저장소 소유자에게 쓰기 권한을 받거나, fork 한 뒤 내 저장소로 push 해서 PR 을 만드세요." }),
  },
];

/** 원격 접속 오류면 안내를, 아니면 null */
export function explainRemoteError(stderr: string | undefined | null): RemoteHint | null {
  if (!stderr) return null;
  for (const r of RULES) if (r.test.test(stderr)) return r.hint(stderr);
  return null;
}

export const hintText = (h: RemoteHint) => `${h.title}\n${h.fix}`;
