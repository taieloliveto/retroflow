/** Alfabeto sin caracteres ambiguos (sin 0, O, 1, I, L). Debe coincidir con la base. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
export const NAME_MAX = 30;

/** Mayúsculas y sin espacios (acepta "abc 123 " → "ABC123"). */
export function normalizeCode(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function isValidCodeShape(code: string): boolean {
  return /^[A-Z0-9]{6}$/.test(code);
}
