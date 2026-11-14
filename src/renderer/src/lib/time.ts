const UNITS: Array<[string, number]> = [["년", 31536000], ["개월", 2592000], ["주", 604800], ["일", 86400], ["시간", 3600], ["분", 60]];

/** "3시간 전" 같은 상대 시간 */
export function relTime(t?: number): string {
  if (!t) return "";
  const sec = Math.round((Date.now() - t) / 1000);
  for (const [u, n] of UNITS) if (sec >= n) return `${Math.floor(sec / n)}${u} 전`;
  return "방금";
}

export const fullTime = (t: number) => new Date(t).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
