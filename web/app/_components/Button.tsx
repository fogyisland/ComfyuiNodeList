'use client';
import { forwardRef, type ButtonHTMLAttributes, type AnchorHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'icon';
type Size = 'sm' | 'md';

const base =
  'inline-flex items-center justify-center font-semibold tracking-tight transition disabled:opacity-50 disabled:cursor-not-allowed';

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-gradient-brand text-white shadow-sm hover:shadow-md hover:brightness-105 active:brightness-95',
  secondary:
    'bg-surface text-fg-primary border border-border-default hover:border-border-strong',
  ghost: 'text-fg-secondary hover:text-fg-primary',
  destructive: 'bg-danger text-white shadow-sm hover:bg-red-700',
  icon: 'h-9 w-9 rounded-md text-fg-secondary hover:bg-subtle hover:text-fg-primary',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-sm',
  md: 'px-5 py-2.5 text-sm rounded-sm',
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className = '', ...rest },
  ref,
) {
  const cls = [
    base,
    variant === 'icon' ? variantClasses.icon : variantClasses[variant],
    variant === 'icon' ? '' : sizeClasses[size],
    className,
  ].join(' ');
  return <button ref={ref} className={cls} {...rest} />;
});

type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: Variant;
  size?: Size;
};

export function LinkButton({
  variant = 'primary',
  size = 'md',
  className = '',
  ...rest
}: LinkButtonProps) {
  const cls = [
    base,
    variant === 'icon' ? variantClasses.icon : variantClasses[variant],
    variant === 'icon' ? '' : sizeClasses[size],
    className,
  ].join(' ');
  return <a className={cls} {...rest} />;
}