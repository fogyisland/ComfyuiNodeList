'use client';
import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const fieldCls =
  'block w-full rounded-sm border border-border-default bg-surface px-3.5 py-2.5 text-base text-fg-primary placeholder:text-fg-tertiary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50';

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = '', invalid, ...rest },
  ref,
) {
  const cls = [fieldCls, invalid ? 'border-danger' : '', className].join(' ');
  return <input ref={ref} className={cls} {...rest} />;
});

type TAProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export const Textarea = forwardRef<HTMLTextAreaElement, TAProps>(function Textarea(
  { className = '', invalid, ...rest },
  ref,
) {
  const cls = [fieldCls, 'min-h-[88px] resize-y', invalid ? 'border-danger' : '', className].join(' ');
  return <textarea ref={ref} className={cls} {...rest} />;
});

type FieldProps = {
  label: string;
  htmlFor: string;
  helper?: string;
  error?: string | null;
  children: React.ReactNode;
};

export function Field({ label, htmlFor, helper, error, children }: FieldProps) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-fg-secondary">
        {label}
      </label>
      {children}
      {(helper || error) && (
        <p className={'mt-1.5 text-xs ' + (error ? 'text-danger' : 'text-fg-tertiary')}>
          {error ?? helper}
        </p>
      )}
    </div>
  );
}