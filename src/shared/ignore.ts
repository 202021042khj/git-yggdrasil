// .gitignore 패턴 만들기 (main 과 화면이 같은 규칙을 쓴다). 경로는 저장소 기준 상대 경로, / 구분.

/** glob 특수 문자 (\ * ? [ ]) 와 끝 공백을 escape. 맨 앞 # · ! 도 글자 그대로가 되게 */
export function escapeGlob(s: string): string {
  let out = s.replace(/[\\*?[\]]/g, "\\$&");
  if (/^[#!]/.test(out)) out = "\\" + out;
  return out.replace(/ +$/, (m) => "\\ ".repeat(m.length));
}

const baseName = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);

/** 파일 하나만 (저장소 맨 위 기준으로 고정: /경로) */
export const filePattern = (rel: string) => "/" + rel.split("/").map(escapeGlob).join("/");

/** 같은 확장자 전부 (어느 폴더든: *.확장자). 확장자가 없거나 .env 처럼 점으로 시작하는 이름뿐이면 null */
export function extPattern(rel: string): string | null {
  const name = baseName(rel);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return `*.${escapeGlob(name.slice(dot + 1)).replace(/^\\([#!])/, "$1")}`;
}

/** 파일이 든 폴더 전체 (/폴더/). 저장소 맨 위 파일이면 null */
export function dirPattern(rel: string): string | null {
  const i = rel.lastIndexOf("/");
  return i <= 0 ? null : filePattern(rel.slice(0, i)) + "/";
}
