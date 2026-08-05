/**
 * @file ProviderJson.ts
 * @description Safe JSON document parsing utilities for tolerant property retrieval from provider APIs.
 */

/**
 * Checks whether a given value is a non-null plain object.
 *
 * @param value - Unknown value to inspect
 * @returns True if value is an object (and not an array or null)
 */
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Converts a numeric value or numeric string into a finite number.
 *
 * @param value - Value to convert
 * @returns Parsed number or null if invalid
 */
const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

/**
 * Returns the first string property matching any of the given property names.
 *
 * @param element - Target object element
 * @param propertyNames - Variadic property names to search for
 * @returns Matching string value or null
 */
export const getString = (element: unknown, ...propertyNames: string[]): string | null => {
  if (!isObject(element)) return null
  for (const name of propertyNames) {
    const value = element[name]
    if (typeof value === 'string') return value
  }
  return null
}

/**
 * Returns a numeric property value, tolerating numbers encoded as strings.
 *
 * @param element - Target object element
 * @param propertyName - Property key name
 * @returns Extracted numeric value or null
 */
export const getNumber = (element: unknown, propertyName: string): number | null => {
  if (!isObject(element)) return null
  return asNumber(element[propertyName])
}

/**
 * Returns an object property value, or null when missing or not an object.
 *
 * @param element - Target object element
 * @param propertyName - Property key name
 * @returns Extracted record object or null
 */
export const getObject = (
  element: unknown,
  propertyName: string,
): Record<string, unknown> | null => {
  if (!isObject(element)) return null
  const value = element[propertyName]
  return isObject(value) ? value : null
}

/**
 * Returns an array property value, or null when missing or not an array.
 *
 * @param element - Target object element
 * @param propertyName - Property key name
 * @returns Extracted array or null
 */
export const getArray = (element: unknown, propertyName: string): unknown[] | null => {
  if (!isObject(element)) return null
  const value = element[propertyName]
  return Array.isArray(value) ? value : null
}

/**
 * Returns a boolean property value, or false when missing or not a boolean.
 *
 * @param element - Target object element
 * @param propertyName - Property key name
 * @returns Boolean value
 */
export const getBoolean = (element: unknown, propertyName: string): boolean => {
  if (!isObject(element)) return false
  return element[propertyName] === true
}
