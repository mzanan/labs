import type { Config, ObservationRecord, RainIntensity, Site } from './types.ts'

type MetarEntry = {
  icaoId: string
  obsTime: number
  wxString?: string | null
  rawOb: string
}

const PRECIPITATION_TYPES = ['RA', 'DZ', 'SN', 'GR', 'GS', 'PL', 'SG', 'UP']

export function parseWeatherString(wxString: string | null | undefined): {
  raining: boolean
  intensity: RainIntensity
  code: string | null
} {
  if (!wxString) return { raining: false, intensity: 'none', code: null }

  const tokens = wxString.trim().split(/\s+/).filter(Boolean)
  let best: { intensity: RainIntensity; code: string } | null = null

  for (const token of tokens) {
    if (token.startsWith('VC') || token.startsWith('RE')) continue
    const body = token.replace(/^[-+]/, '')
    if (!PRECIPITATION_TYPES.some((type) => body.includes(type))) continue

    const intensity: RainIntensity = token.startsWith('+')
      ? 'heavy'
      : token.startsWith('-')
        ? 'light'
        : 'moderate'

    if (!best || rank(intensity) > rank(best.intensity)) {
      best = { intensity, code: token }
    }
  }

  if (!best) return { raining: false, intensity: 'none', code: null }
  return { raining: true, intensity: best.intensity, code: best.code }
}

function rank(intensity: RainIntensity): number {
  return { none: 0, light: 1, moderate: 2, heavy: 3 }[intensity]
}

export async function fetchObservations(
  config: Config,
  siteName: string,
  site: Site,
): Promise<ObservationRecord[]> {
  const url = new URL(config.observation.endpoint)
  url.searchParams.set('ids', site.station)
  url.searchParams.set('format', 'json')
  url.searchParams.set('hours', String(config.observation.lookbackHours))

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`observation fetch failed: ${response.status} ${response.statusText}`)
  }

  const entries = (await response.json()) as MetarEntry[]
  return entries.map((entry) => {
    const parsed = parseWeatherString(entry.wxString)
    return {
      kind: 'observation',
      site: siteName,
      station: entry.icaoId,
      observedAt: new Date(entry.obsTime * 1000).toISOString(),
      raining: parsed.raining,
      intensity: parsed.intensity,
      weatherCode: parsed.code,
      raw: entry.rawOb,
    }
  })
}
