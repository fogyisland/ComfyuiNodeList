'use client';
import type { HTMLAttributes } from 'react';

type Kind = 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'mono';

const kindClasses: Record<Kind, string> = {
  default: 'bg-subtle text-fg-secondary',
  brand: 'bg-brand-50 text-brand-600',
  success: 'bg-green-50 text-success',
  warning: 'bg-amber-50 text-warning',
  danger: 'bg-red-50 text-danger',
  info: 'bg-cyan-50 text-accent-cyan',
  mono: 'bg-transparent border border-border-default text-fg-secondary font-mono',
};

type Props = HTMLAttributes<HTMLSpanElement> & { kind?: Kind };

export function Badge({ kind = 'default', className = '', ...rest }: Props) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-xs px-2 py-0.5 text-xs font-medium',
        kindClasses[kind],
        className,
      ].join(' ')}
      {...rest}
    />
  );
}