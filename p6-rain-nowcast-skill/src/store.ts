import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './config.ts'
import type { ForecastRecord, ObservationRecord } from './types.ts'

function pathFor(name: string): string {
  const dir = dataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, name)
}

function append(name: string, record: unknown): void {
  appendFileSync(pathFor(name), `${JSON.stringify(record)}\n`, 'utf8')
}

function read<T>(name: string): T[] {
  const path = pathFor(name)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T)
}

export function appendForecast(record: ForecastRecord): void {
  append('forecasts.jsonl', record)
}

export function appendObservations(records: ObservationRecord[]): number {
  const seen = new Set(readObservations().map((entry) => `${entry.station}@${entry.observedAt}`))
  let written = 0
  for (const record of records) {
    const key = `${record.station}@${record.observedAt}`
    if (seen.has(key)) continue
    append('observations.jsonl', record)
    seen.add(key)
    written += 1
  }
  return written
}

export function readForecasts(): ForecastRecord[] {
  return read<ForecastRecord>('forecasts.jsonl')
}

export function readObservations(): ObservationRecord[] {
  return read<ObservationRecord>('observations.jsonl')
}
