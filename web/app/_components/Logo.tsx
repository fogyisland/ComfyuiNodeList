type Props = { className?: string; size?: number };

export function Logo({ className, size = 28 }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-label="ComfyUI Node Wiki"
    >
      <defs>
        <linearGradient id="brand" x1="0" y1="0" x2="24" y2="24">
          <stop offset="0%" stopColor="#4F46E5" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      <path
        d="M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z"
        stroke="url(#brand)"
        strokeWidth="1.75"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="12" cy="12" r="2" fill="url(#brand)" />
      <line x1="12" y1="12" x2="6" y2="6" stroke="url(#brand)" strokeWidth="1.25" strokeLinecap="round" />
      <line x1="12" y1="12" x2="18" y2="6" stroke="url(#brand)" strokeWidth="1.25" strokeLinecap="round" />
      <line x1="12" y1="12" x2="18" y2="18" stroke="url(#brand)" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="6" cy="6" r="1" fill="url(#brand)" />
      <circle cx="18" cy="6" r="1" fill="url(#brand)" />
      <circle cx="18" cy="18" r="1" fill="url(#brand)" />
    </svg>
  );
}