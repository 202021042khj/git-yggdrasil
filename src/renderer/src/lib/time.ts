import { dateLocale, t } from "@shared/i18n/i18n";
const UNITS = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]] as const;

/** "3시간 전" 같은 상대 시간 */
export function relTime(ms?: number): string {
  if (!ms) return "";
  const sec = Math.round((Date.now() - ms) / 1000);
  for (const [u, n] of UNITS) if (sec >= n) return t(`time.${u}`, { n: Math.floor(sec / n) });
  return t("time.now");
}

export const fullTime = (ms: number) => new Date(ms).toLocaleString(dateLocale(), { dateStyle: "medium", timeStyle: "short" });
