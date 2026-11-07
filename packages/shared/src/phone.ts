import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Нормализует телефон в E.164 (+79991234567). Российские номера можно вводить с 8 или без кода страны. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || !/^[\d\s()+\-.]+$/.test(trimmed)) return null;
  const parsed = parsePhoneNumberFromString(trimmed, 'RU');
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** +79991234567 → "+7 999 123 45 67"; остальные страны — международный формат. */
export function formatPhone(e164: string): string {
  const ru = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  if (ru) return `+7 ${ru[1]} ${ru[2]} ${ru[3]} ${ru[4]}`;
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}
