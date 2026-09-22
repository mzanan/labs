import type { Config, ForecastRecord, ForecastStep, Site } from './types.ts'

type OpenMeteoResponse = {
  minutely_15?: {
    time: string[]
    precipitation: (number | null)[]
    precipitation_probability: (number | null)[]
  }
  error?: boolean
  reason?: string
}

function toUtcIso(utcTime: string): string {
  return new Date(`${utcTime}:00Z`).toISOString()
}

export async function fetchForecast(
  config: Config,
  siteName: string,
  site: Site,
  now = new Date(),
): Promise<ForecastRecord> {
  const url = new URL(config.forecast.endpoint)
  url.searchParams.set('latitude', String(site.latitude))
  url.searchParams.set('longitude', String(site.longitude))
  url.searchParams.set('minutely_15', 'precipitation,precipitation_probability')
  url.searchParams.set('forecast_minutely_15', String(config.forecast.steps))
  url.searchParams.set('timezone', 'UTC')

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`forecast fetch failed: ${response.status} ${response.statusText}`)
  }

  const body = (await response.json()) as OpenMeteoResponse
  if (body.error || !body.minutely_15) {
    throw new Error(`forecast provider error: ${body.reason ?? 'no minutely_15 block'}`)
  }

  const block = body.minutely_15
  const steps: ForecastStep[] = block.time.map((time, index) => ({
    time: toUtcIso(time),
    precipitationMm: block.precipitation[index] ?? 0,
    probabilityPct: block.precipitation_probability[index] ?? null,
  }))

  return {
    kind: 'forecast',
    site: siteName,
    issuedAt: now.toISOString(),
    provider: config.forecast.provider,
    steps,
  }
}
