'use client';
import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]!) : null;
}

function applyTheme(t: Theme) {
  const dark =
    t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

function persist(t: Theme) {
  localStorage.setItem('cnw-theme', t);
  document.cookie = `cnw-theme=${t}; path=/; max-age=31536000; samesite=lax`;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fromCookie = readCookie('cnw-theme') as Theme | null;
    const fromStorage = localStorage.getItem('cnw-theme') as Theme | null;
    setTheme(fromCookie ?? fromStorage ?? 'system');
  }, []);

  function choose(t: Theme) {
    setTheme(t);
    persist(t);
    applyTheme(t);
    setOpen(false);
  }

  const label = theme === 'light' ? '☀ 亮' : theme === 'dark' ? '🌙 暗' : '💻 系统';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-sm px-3 py-1.5 text-sm text-fg-secondary hover:bg-subtle hover:text-fg-primary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="切换主题"
      >
        {label} ▼
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-32 overflow-hidden rounded-md border border-border-default bg-surface shadow-md"
        >
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button
              key={t}
              role="menuitemradio"
              aria-checked={theme === t}
              onClick={() => choose(t)}
              className={
                'flex w-full items-center justify-between px-3 py-2 text-sm ' +
                (theme === t
                  ? 'bg-brand-50 text-brand-600'
                  : 'text-fg-secondary hover:bg-subtle hover:text-fg-primary')
              }
            >
              <span>{t === 'light' ? '☀ 亮' : t === 'dark' ? '🌙 暗' : '💻 系统'}</span>
              {theme === t && <span className="text-brand-500">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}