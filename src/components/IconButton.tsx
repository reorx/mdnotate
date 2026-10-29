import type { ReactNode } from 'react';

/** An icon and nothing else, so the name it carries is the only name it has. */
export function IconButton({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className={`rounded-lg p-1.5 ${className}`} title={label} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}
