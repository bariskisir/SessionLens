/**
 * @file UsageFormatting.ts
 * @description Formatting utilities for currency amounts, text strings, and reset duration countdowns.
 */

/**
 * Formats a currency amount as `{symbol}0.00` using the given symbol (defaults to USD '$').
 *
 * @param value - Numeric currency amount
 * @param symbol - Currency symbol string
 * @returns Formatted currency string
 */
export const currency = (value: number, symbol = '$'): string => `${symbol}${value.toFixed(2)}`

/** Currency symbols keyed by ISO 4217 unit code for balance display. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  usd: '$',
  eur: '€',
  gbp: '£',
  jpy: '¥',
  cny: '¥',
  krw: '₩',
  inr: '₹',
  rub: '₽',
  try: '₺',
  brl: 'R$',
  cad: 'C$',
  aud: 'A$',
  chf: 'CHF',
  sek: 'kr',
  nok: 'kr',
  dkk: 'kr',
  pln: 'zł',
  mxn: 'MX$',
  zar: 'R',
  aed: 'AED',
  sar: 'SAR',
}

/**
 * Formats a balance amount using the symbol for its unit code. Unknown units
 * keep their original label after the amount.
 *
 * @param value - Numeric balance amount
 * @param unit - Currency or credit unit reported by the provider
 * @returns Formatted balance string
 */
export const currencyForUnit = (value: number, unit: string | null | undefined): string => {
  const label = unit?.trim()
  if (!label) return currency(value)
  const symbol = CURRENCY_SYMBOLS[label.toLowerCase()]
  return symbol ? currency(value, symbol) : `${value.toFixed(2)} ${label}`
}

/**
 * Capitalizes the first character of a plan or tier token string for display.
 *
 * @param value - Target string
 * @returns Capitalized string
 */
export const capitalize = (value: string): string =>
  value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1)

/**
 * Formats a reset countdown duration in milliseconds as `now`, `5m`, `2h 10m`, or `1d 3h`.
 *
 * @param durationMs - Remaining duration until reset in milliseconds
 * @returns Human-readable duration string
 */
export const resetDuration = (durationMs: number): string => {
  if (durationMs <= 0) return 'now'
  if (durationMs >= 86_400_000) {
    const totalMinutes = Math.ceil(durationMs / 60_000)
    const hours = Math.floor((totalMinutes % 1_440) / 60)
    const minutes = totalMinutes % 60
    const days = Math.floor(totalMinutes / 1_440)
    if (hours > 0) return `${days}d ${hours}h`
    if (minutes > 0) return `${days}d ${minutes}m`
    return `${days}d`
  }
  const totalMinutes = Math.max(1, Math.ceil(durationMs / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours >= 1 ? `${hours}h ${minutes}m` : `${minutes}m`
}
