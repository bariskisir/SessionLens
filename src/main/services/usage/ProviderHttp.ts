/**
 * @file ProviderHttp.ts
 * @description Shared HTTP fetch helper routines for provider API requests, handling authentication headers and response parsing.
 */

import { getString } from './ProviderJson'

/** Error thrown when a provider request fails or returns non-success status code. */
export class ProviderError extends Error {}

/**
 * Reads and truncates HTTP response text body up to 240 characters for error messages.
 *
 * @param response - Fetch Response object
 * @returns Truncated text string
 */
const readBody = async (response: Response): Promise<string> => {
  const body = await response.text()
  return body.length > 240 ? body.slice(0, 240) : body
}

/**
 * Sends an HTTP request and parses the response body as JSON, throwing ProviderError on failure.
 *
 * @param request - Request object to execute
 * @returns Parsed JSON body content
 * @throws ProviderError if the HTTP request status is not ok
 */
export const getJson = async (request: Request): Promise<unknown> => {
  const response = await fetch(request)
  if (!response.ok) {
    const body = await readBody(response)
    throw new ProviderError(
      `Provider request failed with HTTP ${response.status}${body ? `: ${body}` : ''}.`,
    )
  }
  return (await response.json()) as unknown
}

/**
 * Performs a GET request with the API key in the Authorization Bearer header.
 *
 * @param url - Target request URL
 * @param apiKey - Bearer token string
 * @returns Parsed JSON body content
 */
export const getJsonWithBearer = async (url: string, apiKey: string): Promise<unknown> => {
  const request = new Request(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  return getJson(request)
}

/**
 * Performs a GET request with a custom header for the API key.
 *
 * @param url - Target request URL
 * @param apiKey - Header credential value
 * @param headerName - Custom header name (e.g. 'xi-api-key')
 * @returns Parsed JSON body content
 */
export const getJsonWithKeyHeader = async (
  url: string,
  apiKey: string,
  headerName: string,
): Promise<unknown> => {
  const request = new Request(url, {
    headers: { [headerName]: apiKey },
  })
  return getJson(request)
}

/**
 * Performs a GET request with arbitrary headers.
 *
 * @param url - Target request URL
 * @param headers - Key-value pair header dictionary
 * @returns Parsed JSON body content
 */
export const getJsonWithHeaders = async (
  url: string,
  headers: Record<string, string>,
): Promise<unknown> => {
  const request = new Request(url, { headers })
  return getJson(request)
}

/**
 * Sends a POST JSON request with arbitrary headers and parses the response as JSON.
 *
 * @param url - Target request URL
 * @param body - JSON serializable body payload
 * @param headers - Custom header map
 * @returns Parsed JSON response
 * @throws ProviderError if HTTP status is not ok
 */
export const postJsonWithHeaders = async (
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<unknown> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await readBody(response)
    throw new ProviderError(
      `Provider request failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}.`,
    )
  }
  return (await response.json()) as unknown
}

/**
 * Sends a POST form request and returns parsed JSON. Used for OAuth token refresh calls.
 *
 * @param url - Token refresh URL endpoint
 * @param body - URLSearchParams form body
 * @returns Parsed JSON response
 * @throws ProviderError if refresh request fails
 */
export const postForm = async (url: string, body: URLSearchParams): Promise<unknown> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  if (!response.ok) {
    const detail = await readBody(response)
    throw new ProviderError(`Token refresh failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}.`)
  }
  return (await response.json()) as unknown
}

/**
 * Sends a POST JSON request and returns raw fetch Response object. Used for webhook notifications.
 *
 * @param url - Target webhook URL
 * @param payload - Webhook JSON payload
 * @returns Raw fetch Response object
 */
export const postJson = async (url: string, payload: unknown): Promise<Response> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return response
}

/**
 * Extracts a Bearer access token string from a parsed JSON document.
 *
 * @param document - Response JSON document
 * @returns Extracted access token string or null
 */
export const readAccessToken = (document: unknown): string | null =>
  getString(document, 'access_token', 'accessToken')

