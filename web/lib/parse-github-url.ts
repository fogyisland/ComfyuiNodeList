/**
 * Pure, client-safe parser for GitHub repository URLs.
 * No Prisma, no Node-only imports — safe to import from both server and client modules.
 */
export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]! };
}