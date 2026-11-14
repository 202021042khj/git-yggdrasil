const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** HTML 문자열에 넣을 값 이스케이프 */
export const esc = (t: unknown) => String(t ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** 길면 끝을 … 으로 */
export const trunc = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

/** 길면 가운데를 … 으로 (브랜치 이름처럼 앞뒤가 다 중요한 경우) */
export function truncMiddle(t: string, n: number): string {
  if (t.length <= n) return t;
  return t.slice(0, Math.ceil((n - 1) / 2)) + "…" + t.slice(t.length - Math.floor((n - 1) / 2));
}

export const short = (oid: string) => oid.slice(0, 7);

/** IPC 오류 메시지 앞에 붙는 Electron 문구를 떼어 낸다 */
export const errorText = (err: unknown) =>
  String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
