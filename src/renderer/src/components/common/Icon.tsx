export type IconName = "folder" | "file" | "box" | "trash" | "inbox" | "cloud" | "users" | "branch" | "grip" | "undo" | "redo";

interface IconProps {
  name: IconName;
}

/** 스프라이트(IconSprite)의 아이콘. 글자 색을 따르고 화면 낭독에서는 숨긴다 */
const Icon = ({ name }: IconProps) => (
  <svg className="i" aria-hidden="true">
    <use href={`#i-${name}`} />
  </svg>
);

export default Icon;
