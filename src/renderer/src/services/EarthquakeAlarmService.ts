/** Plays the exact default realtime alarm bundled by the mobile application. */

import mobileAlarmUrl from '@renderer/assets/audio/earthquake-network-alarm.mp3'

let activeAlarm: HTMLAudioElement | null = null
let activeAlarmTimeout: number | null = null
const maximumLoopDurationMs = 3 * 60 * 1_000

/** Stops the active mobile-compatible alarm immediately. */
export const stopEarthquakeAlarm = (): void => {
  if (activeAlarmTimeout !== null) window.clearTimeout(activeAlarmTimeout)
  activeAlarmTimeout = null
  activeAlarm?.pause()
  if (activeAlarm) activeAlarm.currentTime = 0
  activeAlarm = null
}

/** Starts the static mobile alarm, optionally looping until the fullscreen alert is dismissed. */
export const playEarthquakeAlarm = async (loop: boolean): Promise<void> => {
  stopEarthquakeAlarm()
  const alarm = new Audio(mobileAlarmUrl)
  alarm.loop = loop
  alarm.preload = 'auto'
  alarm.volume = 1
  activeAlarm = alarm
  if (loop) {
    activeAlarmTimeout = window.setTimeout(stopEarthquakeAlarm, maximumLoopDurationMs)
  }
  alarm.addEventListener(
    'ended',
    () => {
      if (activeAlarm === alarm) activeAlarm = null
    },
    { once: true },
  )
  try {
    await alarm.play()
  } catch (error) {
    if (activeAlarm === alarm) stopEarthquakeAlarm()
    throw error
  }
}
