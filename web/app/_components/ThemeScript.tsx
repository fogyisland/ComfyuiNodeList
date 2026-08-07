export function ThemeScript() {
  const code = `(() => {
    try {
      var c = document.cookie.match(/(?:^|; )cnw-theme=([^;]+)/);
      var t = c ? c[1] : (localStorage.getItem('cnw-theme') || 'system');
      var apply = function() {
        var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.classList.toggle('dark', dark);
      };
      apply();
      if (t === 'system') matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
    } catch (_) {}
  })();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}