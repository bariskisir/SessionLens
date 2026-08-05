/**
 * Verifies startup registration without mutating the host operating system.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  START_HIDDEN_ARGUMENT,
  configureStartOnLogin,
  isHiddenStartupLaunch,
} from '../src/main/startup'

describe('startup', () => {
  it('registers packaged Windows login with the hidden argument', () => {
    const setLoginItemSettings = vi.fn()

    configureStartOnLogin({ isPackaged: true, setLoginItemSettings }, 'win32', true)

    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      args: [START_HIDDEN_ARGUMENT],
    })
  })

  it('does not register development or Linux launches', () => {
    const developmentSetter = vi.fn()
    const linuxSetter = vi.fn()

    configureStartOnLogin(
      { isPackaged: false, setLoginItemSettings: developmentSetter },
      'win32',
      true,
    )
    configureStartOnLogin({ isPackaged: true, setLoginItemSettings: linuxSetter }, 'linux', true)

    expect(developmentSetter).not.toHaveBeenCalled()
    expect(linuxSetter).not.toHaveBeenCalled()
  })

  it('recognizes only an exact hidden startup argument', () => {
    expect(isHiddenStartupLaunch(['SessionLens.exe', START_HIDDEN_ARGUMENT])).toBe(true)
    expect(isHiddenStartupLaunch(['SessionLens.exe', '--hidden-window'])).toBe(false)
  })
})
