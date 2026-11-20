// 원격(SSH·HTTPS) 접속 오류를 사람이 읽을 수 있는 안내로 바꾼다
// git·ssh 의 영어 오류 문구(LC_ALL=C)를 보고 원인과 해결 방법을 고른다.
import { t } from "@shared/i18n/i18n";

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
      title: t("re.sshKey.title"),
      fix: t("re.sshKey.fix"),
    }),
  },
  {
    test: /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/,
    hint: (s) => ({
      title: /CHANGED/.test(s) ? t("re.hostChanged.title") : t("re.hostUnknown.title"),
      fix: /CHANGED/.test(s)
        ? t("re.hostChanged.fix")
        : t("re.hostUnknown.fix"),
    }),
  },
  {
    test: /Could not resolve hostname|Could not resolve host/,
    hint: (s) => ({ title: t("re.dns.title", { host: host(s) ?? null }), fix: t("re.dns.fix") }),
  },
  {
    test: /Connection (refused|timed out)|Operation timed out|timed out after|Timed out, stopped|시간 초과/,
    hint: () => ({ title: t("re.connect.title"), fix: t("re.connect.fix") }),
  },
  {
    test: /could not read Username|terminal prompts disabled|Authentication failed|Invalid username or password/,
    hint: (s) => ({
      title: t("re.https.title"),
      fix: /github\.com/.test(s) ? t("re.https.fixGithub") : t("re.https.fixOther"),
    }),
  },
  {
    test: /Repository not found|does not appear to be a git repository|returned error: 404/,
    hint: () => ({ title: t("re.notFound.title"), fix: t("re.notFound.fix") }),
  },
  {
    test: /Permission to .* denied|returned error: 403/,
    hint: () => ({ title: t("re.denied.title"), fix: t("re.denied.fix") }),
  },
];

/** 원격 접속 오류면 안내를, 아니면 null */
export function explainRemoteError(stderr: string | undefined | null): RemoteHint | null {
  if (!stderr) return null;
  for (const r of RULES) if (r.test.test(stderr)) return r.hint(stderr);
  return null;
}

export const hintText = (h: RemoteHint) => `${h.title}\n${h.fix}`;
