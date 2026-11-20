import { Fragment, type ReactNode } from "react";

const TAG = /<(b|kbd|code)>(.*?)<\/\1>/g;

/**
 * 사전 문구 안의 <b> · <kbd> · <code> 만 요소로 바꿔 그린다 (문장 안에서 낱말 순서가 언어마다 달라서).
 * innerHTML 을 쓰지 않으므로 인자로 들어간 값도 글자로만 보인다.
 */
const RichText = ({ text }: { text: string }) => {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const Tag = m[1] as "b" | "kbd" | "code";
    out.push(<Tag key={m.index}>{m[2]}</Tag>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out.map((n, i) => <Fragment key={i}>{n}</Fragment>)}</>;
};

export default RichText;
