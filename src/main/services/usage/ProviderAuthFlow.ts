/**
 * @file ProviderAuthFlow.ts
 * @description Shared OAuth lifecycle flow for providers that refresh credentials on expiration and retry upon HTTP 401/403 errors.
 */

import { ProviderError } from './ProviderHttp'

/**
 * Determines whether an error represents an HTTP 401 or 403 authentication failure.
 *
 * @param error - Caught error object
 * @returns True if error is a ProviderError containing 401 or 403 status code
 */
export const isAuthenticationFailure = (error: unknown): boolean =>
  error instanceof ProviderError &&
  (error.message.includes('HTTP 401') || error.message.includes('HTTP 403'))

/**
 * Checks if an authentication object contains a non-empty refresh token string.
 *
 * @param auth - Credential authentication object
 * @returns True if a valid refresh token exists
 */
const hasRefreshToken = <TAuth>(auth: TAuth): boolean => {
  const refreshToken = (auth as { refreshToken?: string | null }).refreshToken
  return Boolean(refreshToken && refreshToken.trim() !== '')
}

/**
 * Executes an authenticated request, refreshing the token first when due and retrying once
 * after an authentication failure.
 *
 * @param params - Execution configuration options
 * @returns Object containing latest authentication credentials and query result
 */
export const executeAuthFlow = async <TAuth>({
  auth,
  allowRefresh,
  readLatestAuth,
  shouldRefresh,
  refreshAsync,
  executeAsync,
}: {
  auth: TAuth
  allowRefresh: boolean
  readLatestAuth: () => Promise<TAuth | null>
  shouldRefresh: (auth: TAuth) => boolean
  refreshAsync: (auth: TAuth) => Promise<TAuth>
  executeAsync: (auth: TAuth) => Promise<unknown>
}): Promise<{ auth: TAuth; result: unknown }> => {
  if (!allowRefresh) {
    return { auth, result: await executeAsync(auth) }
  }

  let current = (await readLatestAuth()) ?? auth
  if (shouldRefresh(current)) current = await refreshAsync(current)

  try {
    return { auth: current, result: await executeAsync(current) }
  } catch (error) {
    if (isAuthenticationFailure(error) && hasRefreshToken(current)) {
      const refreshed = await refreshAsync(current)
      return { auth: refreshed, result: await executeAsync(refreshed) }
    }
    throw error
  }
}
