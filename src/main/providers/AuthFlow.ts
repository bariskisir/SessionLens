/**
 * @file AuthFlow.ts
 * @description Shared OAuth lifecycle flow for providers that refresh credentials on expiration and retry upon HTTP 401/403 errors.
 */

import { ProviderError } from './Http'

/**
 * Determines whether an error represents an HTTP 401 or 403 authentication failure.
 */
export const isAuthenticationFailure = (error: unknown): boolean =>
  error instanceof ProviderError &&
  (error.message.includes('HTTP 401') || error.message.includes('HTTP 403'))

/**
 * Executes an authenticated request, refreshing the token first when due and retrying once
 * after an authentication failure.
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
    if (isAuthenticationFailure(error)) {
      const refreshed = await refreshAsync(current)
      return { auth: refreshed, result: await executeAsync(refreshed) }
    }
    throw error
  }
}
