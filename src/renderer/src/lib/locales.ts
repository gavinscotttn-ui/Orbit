/**
 * The locales Orbit offers.
 *
 * A short, honest list rather than every BCP-47 tag in existence: these are the
 * ones whose date and number conventions Orbit has been checked against. The
 * setting only affects how dates and numbers are WRITTEN — Orbit's own text is
 * in English, and pretending otherwise with a half-finished translation would
 * be worse than not offering one.
 */
export const ALL_LOCALES: { code: string; label: string }[] = [
  { code: 'en-GB', label: 'English (United Kingdom)' },
  { code: 'en-IE', label: 'English (Ireland)' },
  { code: 'en-US', label: 'English (United States)' },
  { code: 'en-AU', label: 'English (Australia)' },
  { code: 'en-CA', label: 'English (Canada)' },
  { code: 'en-NZ', label: 'English (New Zealand)' },
  { code: 'en-ZA', label: 'English (South Africa)' },
  { code: 'en-IN', label: 'English (India)' },
  { code: 'de-DE', label: 'German number and date format' },
  { code: 'fr-FR', label: 'French number and date format' },
  { code: 'es-ES', label: 'Spanish number and date format' },
  { code: 'nl-NL', label: 'Dutch number and date format' },
  { code: 'sv-SE', label: 'Swedish number and date format' }
]
