import type { Timetable, TimeUnit } from './types'

export const UNIT_SECONDS: Record<TimeUnit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
  days: 86400,
}

export const DAY = 86400
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function toUnit(seconds: number, unit: TimeUnit): number {
  return seconds / UNIT_SECONDS[unit]
}

export function fromUnit(value: number, unit: TimeUnit): number {
  return value * UNIT_SECONDS[unit]
}

export function bestUnit(seconds: number): TimeUnit {
  if (seconds >= 2 * DAY) return 'days'
  if (seconds >= 2 * 3600) return 'hours'
  if (seconds >= 120) return 'minutes'
  return 'seconds'
}

function round(n: number): string {
  if (n >= 100) return Math.round(n).toString()
  if (n >= 10) return (Math.round(n * 10) / 10).toString()
  return (Math.round(n * 100) / 100).toString()
}

const SHORT: Record<TimeUnit, string> = { seconds: 's', minutes: 'min', hours: 'h', days: 'd' }

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds)) return '–'
  if (seconds === 0) return '0'
  const unit = bestUnit(seconds)
  return `${round(toUnit(seconds, unit))} ${SHORT[unit]}`
}

/** Parses ISO 8601 durations like PT2H30M or P1D. */
export function parseIsoDuration(text: string | undefined | null): number | undefined {
  if (!text) return undefined
  const m = text.trim().match(/^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i)
  if (!m) return undefined
  const [, w, d, h, mi, s] = m.map((x) => (x ? parseFloat(x) : 0))
  return w * 7 * DAY + d * DAY + h * 3600 + mi * 60 + s
}

function hm(text: string): number {
  const [h, m = '0', s = '0'] = text.split(':')
  return (parseInt(h, 10) || 0) * 3600 + (parseInt(m, 10) || 0) * 60 + (parseFloat(s) || 0)
}

/**
 * Working-time calendar. Times are seconds since the simulation start, and
 * `offset` is the start's position within its week (seconds since Monday 00:00).
 */
export class Calendar {
  private readonly week: [number, number][]
  readonly always: boolean

  constructor(timetable: Timetable | undefined, private readonly offset: number) {
    const raw: [number, number][] = []
    for (const r of timetable?.rules ?? []) {
      const from = hm(r.from)
      let to = hm(r.to)
      if (to <= from) to += DAY
      if (r.to.startsWith('23:59')) to = Math.ceil(to / 60) * 60
      const a = Math.min(r.fromDay, r.toDay)
      const b = Math.max(r.fromDay, r.toDay)
      for (let d = a; d <= b; d++) raw.push([d * DAY + from, d * DAY + to])
    }
    raw.sort((x, y) => x[0] - y[0])
    const merged: [number, number][] = []
    for (const iv of raw) {
      const last = merged[merged.length - 1]
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1])
      else merged.push([iv[0], iv[1]])
    }
    const total = merged.reduce((s, [a, b]) => s + (b - a), 0)
    this.always = merged.length === 0 || total >= 7 * DAY - 1
    this.week = merged
  }

  /** Working interval that contains t, or the next one after t. */
  private interval(t: number): [number, number] {
    const abs = t + this.offset
    const weekStart = Math.floor(abs / (7 * DAY)) * 7 * DAY
    for (let w = 0; w < 3; w++) {
      const base = weekStart + w * 7 * DAY
      for (const [a, b] of this.week) {
        if (base + b > abs) return [base + a - this.offset, base + b - this.offset]
      }
    }
    return [t, Infinity]
  }

  nextWorking(t: number): number {
    if (this.always) return t
    const [a] = this.interval(t)
    return Math.max(a, t)
  }

  /** Time at which `work` seconds of working time have been done, starting at t. */
  addWorking(t: number, work: number): number {
    if (this.always) return t + work
    let cur = t
    let left = work
    for (let i = 0; i < 100000; i++) {
      const [a, b] = this.interval(cur)
      const s = Math.max(a, cur)
      if (s + left <= b) return s + left
      left -= b - s
      cur = b
    }
    return cur + left
  }

  /** Working intervals between t0 and t1. */
  segments(t0: number, t1: number): [number, number][] {
    if (t1 <= t0) return []
    if (this.always) return [[t0, t1]]
    const out: [number, number][] = []
    let cur = t0
    for (let i = 0; i < 100000 && cur < t1; i++) {
      const [a, b] = this.interval(cur)
      if (a >= t1) break
      const s = Math.max(a, cur)
      const e = Math.min(b, t1)
      if (e > s) out.push([s, e])
      cur = b
    }
    return out
  }

  /** Working seconds between t0 and t1. */
  workingBetween(t0: number, t1: number): number {
    if (this.always) return Math.max(0, t1 - t0)
    let sum = 0
    let cur = t0
    for (let i = 0; i < 100000 && cur < t1; i++) {
      const [a, b] = this.interval(cur)
      if (a >= t1) break
      sum += Math.min(b, t1) - Math.max(a, cur)
      cur = b
    }
    return sum
  }
}

export function weekOffset(iso: string): number {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 0
  const day = (d.getUTCDay() + 6) % 7
  return day * DAY + d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()
}
