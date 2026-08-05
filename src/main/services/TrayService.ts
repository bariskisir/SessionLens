/**
 * Minimal system tray icon: an instant, animation-free usage popup on hover.
 */

import { join } from 'node:path'
import { app, BrowserWindow, Menu, nativeImage, screen, Tray } from 'electron'
import type { NotificationLevel } from '@shared/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { AppSettings, TooltipCard } from '@shared/types'
import type { IconBar } from './usage/IconLayout'
import { renderTrayIconPng, TRAY_ICON_SIZE } from './usage/TrayIconRenderer'
import type LoggerService from './LoggerService'

type TraySettings = Pick<AppSettings, 'showTrayIcon' | 'minimizeToTrayOnClose'>

const TOOLTIP_MARGIN = 8

export default class TrayService {
  private tray: Tray | null = null
  private tooltip: BrowserWindow | null = null
  private tooltipLoad: Promise<BrowserWindow | null> | null = null
  private tooltipData: { cards: TooltipCard[]; scale: number } = { cards: [], scale: 100 }
  private hovering = false
  private refreshUsage: (() => void) | null = null
  private settings: TraySettings
  private quitting = false

  public constructor(
    private readonly window: BrowserWindow,
    settings: TraySettings,
    private readonly logger: LoggerService,
  ) {
    this.settings = { ...settings }
    this.updateTrayIcon()
  }

  public applySettings(settings: TraySettings): void {
    this.settings = { ...settings }
    this.updateTrayIcon()
  }

  public setUsage(bars: IconBar[]): void {
    if (!this.tray) return
    try {
      const image =
        bars.length === 0 || bars.every((bar) => bar.provider === 'None')
          ? this.defaultTrayImage()
          : nativeImage.createFromBuffer(renderTrayIconPng(bars))
      this.tray.setImage(image)
    } catch (error) {
      this.logger.error('TrayService', 'Usage tray icon could not be rendered.', error)
    }
  }

  public setTooltip(cards: TooltipCard[], scale: number): void {
    this.tooltipData = { cards, scale }
  }

  public setTooltipScale(scale: number): void {
    this.tooltipData = { ...this.tooltipData, scale }
  }

  public setRefreshHandler(handler: () => void): void {
    this.refreshUsage = handler
  }

  public shouldMinimizeOnClose(): boolean {
    return !this.quitting && this.settings.minimizeToTrayOnClose && this.tray !== null
  }

  public showNotification(level: NotificationLevel, message: string): boolean {
    if (!this.tray) return false
    this.tray.displayBalloon({
      title: '',
      content: message,
      iconType: level === 'critical' ? 'error' : level === 'high' ? 'warning' : 'info',
    })
    return true
  }

  public prepareToQuit(): void {
    this.quitting = true
    this.destroyTrayIcon()
  }

  public dispose(): void {
    this.destroyTrayIcon()
  }

  private updateTrayIcon(): void {
    if (this.quitting || !this.settings.showTrayIcon) {
      this.destroyTrayIcon()
      return
    }
    if (this.tray) return
    try {
      const tray = new Tray(this.defaultTrayImage())
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Settings', click: () => this.showSettings() },
          { label: 'Refresh', click: () => this.refreshUsage?.() },
          { label: 'Exit', role: 'quit' },
        ]),
      )
      tray.on('click', () => this.showWindow())
      tray.on('mouse-enter', () => this.onTrayEnter())
      tray.on('mouse-leave', () => this.onTrayLeave())
      this.tray = tray
      // Pre-create the popup so the first hover is as instant as later ones.
      void this.ensureTooltipWindow()
    } catch (error) {
      this.logger.error('TrayService', 'System tray icon could not be created.', error)
      this.tray = null
    }
  }

  private onTrayEnter(): void {
    if (this.hovering) return
    this.hovering = true
    void this.showTooltip()
  }

  private onTrayLeave(): void {
    if (!this.hovering) return
    this.hovering = false
    this.tooltip?.hide()
  }

  /** Returns the pre-created popup, creating and loading it once on first use. */
  private ensureTooltipWindow(): Promise<BrowserWindow | null> {
    if (this.tooltipLoad) return this.tooltipLoad
    if (this.tooltip && !this.tooltip.isDestroyed()) return Promise.resolve(this.tooltip)
    this.tooltipLoad = this.loadTooltipWindow()
    return this.tooltipLoad
  }

  private async loadTooltipWindow(): Promise<BrowserWindow | null> {
    const tooltip = this.createTooltipWindow()
    try {
      const devUrl = process.env.VITE_DEV_SERVER_URL
      if (devUrl) await tooltip.loadURL(`${devUrl.replace(/\/$/, '')}/tray-tooltip/index.html`)
      else await tooltip.loadFile(join(__dirname, '../renderer/tray-tooltip/index.html'))
    } catch (error) {
      this.logger.error('TrayService', 'Tray tooltip document could not be loaded.', error)
      this.destroyTooltipWindow()
      return null
    }
    return tooltip
  }

  /** Renders the cards into the ready popup and shows it next to the tray. */
  private async showTooltip(): Promise<void> {
    if (!this.tray || this.quitting) return
    const tooltip = await this.ensureTooltipWindow()
    if (!tooltip || tooltip.isDestroyed() || tooltip.isVisible()) return
    if (this.quitting || !this.hovering) return
    let size: { width: number; height: number }
    try {
      size = await this.measureTooltip(tooltip)
    } catch (error) {
      this.logger.warn('TrayService', 'Tray tooltip content could not be rendered.', error)
      return
    }
    if (this.tooltip !== tooltip || tooltip.isDestroyed() || tooltip.isVisible()) return
    if (this.quitting || !this.hovering) return
    this.placeAndShow(tooltip, size)
  }

  private createTooltipWindow(): BrowserWindow {
    this.tooltip?.destroy()
    this.tooltip = null
    const tooltip = new BrowserWindow({
      width: 280,
      height: 120,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    tooltip.setAlwaysOnTop(true, 'pop-up-menu')
    tooltip.setIgnoreMouseEvents(true)
    // Keep the renderer fully active while hidden so executeJavaScript still works
    // after hide/show cycles (a background-throttled renderer rejects scripts).
    tooltip.webContents.setBackgroundThrottling(false)
    this.tooltip = tooltip
    return tooltip
  }

  /** Renders the cards and returns the natural panel size. */
  private async measureTooltip(tooltip: BrowserWindow): Promise<{ width: number; height: number }> {
    const json = JSON.stringify(this.tooltipData)
    const b64 = Buffer.from(json, 'utf-8').toString('base64')
    const measured = (await tooltip.webContents.executeJavaScript(
      `(()=>{try{const d=JSON.parse(atob("${b64}"));window.setTooltip(d)}catch(e){return{error:String(e)}}const p=document.querySelector('.panel');if(!p)return{error:'no panel'};const r=p.getBoundingClientRect();return{width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`,
    )) as { width?: number; height?: number; error?: string }
    if (measured.error) throw new Error(`Tooltip render failed: ${measured.error}`)
    return {
      width: Math.max(1, Math.ceil(measured.width ?? 260)),
      height: Math.max(1, Math.ceil(measured.height ?? 60)),
    }
  }

  /** Anchors the popup inside the display work area next to the tray. */
  private placeAndShow(tooltip: BrowserWindow, size: { width: number; height: number }): void {
    const tray = this.tray
    if (!tray) return
    const bounds = tray.getBounds()
    const work = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea
    const width = Math.min(size.width, work.width - TOOLTIP_MARGIN * 2)
    const height = Math.min(size.height, work.height - TOOLTIP_MARGIN * 2)
    const x = clamp(
      bounds.x + Math.floor(bounds.width / 2) - Math.floor(width / 2),
      work.x + TOOLTIP_MARGIN,
      work.x + work.width - width - TOOLTIP_MARGIN,
    )
    const trayIsBelow = bounds.y >= work.y + Math.floor(work.height / 2)
    const preferredY = trayIsBelow
      ? bounds.y - height - TOOLTIP_MARGIN
      : bounds.y + bounds.height + TOOLTIP_MARGIN
    const y = clamp(
      preferredY,
      work.y + TOOLTIP_MARGIN,
      work.y + work.height - height - TOOLTIP_MARGIN,
    )
    tooltip.setBounds({ x, y, width, height })
    tooltip.showInactive()
  }

  private showWindow(): void {
    if (this.window.isDestroyed()) return
    if (this.window.isMinimized()) this.window.restore()
    this.window.show()
    this.window.focus()
  }

  private showSettings(): void {
    this.showWindow()
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(IpcChannel.SettingsOpenRequested)
    }
  }

  private defaultTrayImage() {
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(app.getAppPath(), 'build', 'icon.png')
    const sourceImage = nativeImage.createFromPath(iconPath)
    if (sourceImage.isEmpty()) throw new Error(`Tray icon could not be read from ${iconPath}.`)
    return sourceImage.resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE })
  }

  /** Destroys the popup so it consumes no memory while disabled or quitting. */
  private destroyTooltipWindow(): void {
    this.tooltip?.destroy()
    this.tooltip = null
    this.tooltipLoad = null
  }

  private destroyTrayIcon(): void {
    this.hovering = false
    this.tray?.destroy()
    this.tray = null
    this.destroyTooltipWindow()
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
