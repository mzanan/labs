import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Config, Site } from './types.ts'

const configPath = resolve(import.meta.dirname, '..', 'config.json')

export function loadConfig(): Config {
  return JSON.parse(readFileSync(configPath, 'utf8')) as Config
}

export function resolveSite(config: Config, key: string): { key: string; site: Site } {
  const site = config.sites[key]
  if (!site) {
    throw new Error(`unknown site "${key}", available: ${Object.keys(config.sites).join(', ')}`)
  }
  return { key, site }
}

export function siteKey(): string {
  return process.env.NOWCAST_SITE ?? 'danang'
}

export function dataDir(): string {
  return resolve(import.meta.dirname, '..', process.env.NOWCAST_DATA_DIR ?? './data')
}
