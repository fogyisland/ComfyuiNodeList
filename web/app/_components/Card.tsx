'use client';
import type { HTMLAttributes } from 'react';

type Variant = 'default' | 'elevated' | 'feature' | 'flat';

const base = 'rounded-md';

const variantClasses: Record<Variant, string> = {
  default:
    'bg-surface border border-border-default p-6 shadow-sm hover:border-border-strong hover:shadow-md transition',
  elevated: 'bg-surface p-6 shadow-md',
  feature: 'bg-white/5 backdrop-blur border border-white/10 p-6 text-white',
  flat: 'bg-subtle p-6',
};

type Props = HTMLAttributes<HTMLDivElement> & { variant?: Variant };

export function Card({ variant = 'default', className = '', ...rest }: Props) {
  return <div className={[base, variantClasses[variant], className].join(' ')} {...rest} />;
}

export function CardTitle({ className = '', ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={['text-display-sm text-fg-primary', className].join(' ')} {...rest} />;
}

export function CardMeta({ className = '', ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={['text-xs text-fg-tertiary', className].join(' ')} {...rest} />;
}