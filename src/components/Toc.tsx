import type { TocItem } from '../lib/toc';

interface TocProps {
  items: TocItem[];
  activeId: string | null;
  onJump: (id: string) => void;
}

export function Toc({ items, activeId, onJump }: TocProps) {
  if (items.length === 0) {
    return <p className="px-3 py-2 text-[12px] text-neutral-400">No headings</p>;
  }
  const minLevel = Math.min(...items.map((i) => i.level));
  return (
    <nav className="py-2">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onJump(item.id)}
          title={item.text}
          className={`block w-full truncate px-3 py-[3px] text-left text-[13px] leading-snug ${
            item.id === activeId
              ? 'bg-amber-50 font-medium text-amber-700'
              : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
          }`}
          style={{ paddingLeft: `${12 + (item.level - minLevel) * 14}px` }}
        >
          {item.text}
        </button>
      ))}
    </nav>
  );
}
