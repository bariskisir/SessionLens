/**
 * Verifies parsing of the Windows toast activator registry repair helpers.
 */

import { describe, expect, it } from 'vitest'
import {
  buildLocalServerCommand,
  parseActivatorClsids,
  parseLocalServerValue,
} from '../src/main/services/ToastActivatorRepair'

describe('ToastActivatorRepair', () => {
  it('extracts activator CLSID keys from reg query search output', () => {
    const output = [
      '',
      'HKEY_CURRENT_USER\\Software\\Classes\\CLSID\\{2425810D-0BC4-495B-B30F-BD66B29A3D2B}',
      '    (Default)    REG_SZ    Electron Notification Activator',
      '',
      'HKEY_CURRENT_USER\\Software\\Classes\\CLSID\\{b2cbbc74-883f-445d-a0dd-61dec408abca}',
      '    (Default)    REG_SZ    Electron Notification Activator',
      '',
      'End of search: 2 match(es) found.',
    ].join('\n')

    expect(parseActivatorClsids(output)).toEqual([
      '{2425810D-0BC4-495B-B30F-BD66B29A3D2B}',
      '{B2CBBC74-883F-445D-A0DD-61DEC408ABCA}',
    ])
  })

  it('reads the default value of a LocalServer32 query', () => {
    const output = [
      '',
      'HKEY_CURRENT_USER\\Software\\Classes\\CLSID\\{2425810D-0BC4-495B-B30F-BD66B29A3D2B}\\LocalServer32',
      '    (Default)    REG_SZ    C:\\repo\\node_modules\\electron\\dist\\electron.exe',
      '',
    ].join('\n')

    expect(parseLocalServerValue(output)).toBe(
      'C:\\repo\\node_modules\\electron\\dist\\electron.exe',
    )
  })

  it('returns null when the default value is missing', () => {
    expect(parseLocalServerValue('HKEY_CURRENT_USER\\...\n')).toBeNull()
  })

  it('builds a quoted command line carrying the app path', () => {
    expect(buildLocalServerCommand('C:\\tools\\electron.exe', 'C:\\work\\My App')).toBe(
      '"C:\\tools\\electron.exe" "C:\\work\\My App"',
    )
  })
})
