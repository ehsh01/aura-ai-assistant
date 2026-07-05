export function firstName(fullName?: string | null, fallback = "there"): string {
  const trimmed = fullName?.trim();
  if (!trimmed) return fallback;
  return trimmed.split(/\s+/)[0] ?? fallback;
}
