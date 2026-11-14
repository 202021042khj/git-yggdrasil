/** id 로 요소 찾기. 없으면 바로 알 수 있게 던진다 (index.html 과 코드가 어긋난 경우) */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 요소가 없습니다`);
  return el as T;
}
