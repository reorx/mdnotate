import type { ReactNode } from 'react';

/**
 * The row every home-screen card is built from: an icon, one line of text, an
 * optional action on the right, and any number of secondary lines below,
 * indented to line up under the label.
 *
 * The icon is passed in already rendered so each card can colour it by state.
 */
export function ActionCard({
  icon,
  label,
  action,
  children,
}: {
  icon: ReactNode;
  label: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-left">
      <div className="flex items-center gap-2">
        {icon}
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-neutral-700">{label}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

/** A secondary line under an ActionCard's label. */
export function CardNote({
  tone = 'muted',
  className = '',
  children,
}: {
  tone?: 'muted' | 'error';
  className?: string;
  children: ReactNode;
}) {
  const color = tone === 'error' ? 'text-red-600' : 'text-neutral-500';
  return <p className={`mt-1.5 pl-6 text-[12px] leading-snug ${color} ${className}`}>{children}</p>;
}

/** An ActionCard's right-hand button. `primary` is the one that opens something. */
export function CardButton({
  variant = 'primary',
  type = 'button',
  disabled,
  onClick,
  children,
}: {
  variant?: 'primary' | 'secondary';
  /** `submit` for the button that ends a card's own form. */
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const style =
    variant === 'primary'
      ? 'bg-amber-500 text-white hover:bg-amber-600'
      : 'border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100';
  return (
    <button
      className={`shrink-0 rounded px-2.5 py-1 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${style}`}
      type={type}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
