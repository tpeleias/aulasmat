// Internal domain used to convert child usernames into emails for Supabase Auth.
export const USERNAME_DOMAIN = "aluno.sistema.local";

const RE = /^[a-z0-9._-]{3,30}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidUsername(raw: string): boolean {
  return RE.test(normalizeUsername(raw));
}

export function usernameToEmail(raw: string): string {
  return `${normalizeUsername(raw)}@${USERNAME_DOMAIN}`;
}

export function emailToUsername(email: string | null | undefined): string | null {
  if (!email) return null;
  const suffix = `@${USERNAME_DOMAIN}`;
  return email.endsWith(suffix) ? email.slice(0, -suffix.length) : null;
}
