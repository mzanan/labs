import { dataDir, loadConfig, resolveSite, siteKey } from './config.ts'
import { fetchForecast } from './forecast.ts'
import { fetchObservations } from './observation.ts'
import { appendForecast, appendObservations, readForecasts, readObservations } from './store.ts'
import { scoreAll } from './score.ts'

async function collect(): Promise<void> {
  const config = loadConfig()
  const { key, site } = resolveSite(config, siteKey())

  const forecast = await fetchForecast(config, key, site)
  appendForecast(forecast)

  const observations = await fetchObservations(config, key, site)
  const written = appendObservations(observations)

  const head = forecast.steps[0]
  console.log(
    [
      `[${forecast.issuedAt}] ${site.label}`,
      `forecast steps ${forecast.steps.length}, next ${head?.time ?? 'n/a'} ${head?.precipitationMm ?? 0} mm (${head?.probabilityPct ?? 'n/a'}%)`,
      `observations fetched ${observations.length}, new ${written}`,
    ].join('\n  '),
  )
}

function score(): void {
  const config = loadConfig()
  const key = siteKey()
  const forecasts = readForecasts().filter((entry) => entry.site === key)
  const observations = readObservations().filter((entry) => entry.site === key)

  if (forecasts.length === 0 || observations.length === 0) {
    console.log(`no data yet for site "${key}" in ${dataDir()}, run collect first`)
    return
  }

  const { cases, scores } = scoreAll(config, forecasts, observations)
  const rainingObservations = observations.filter((entry) => entry.raining).length

  console.log(`site: ${key}`)
  console.log(`forecasts: ${forecasts.length}, observations: ${observations.length} (raining ${rainingObservations})`)
  console.log(`scored cases: ${cases.length}`)
  console.log(`rule: ${config.thresholds.rule}, mm >= ${config.thresholds.forecastRainMm}, prob >= ${config.thresholds.forecastProbabilityPct}%`)
  console.table(scores)
}

const command = process.argv[2] ?? 'collect'

if (command === 'collect') {
  await collect()
} else if (command === 'score') {
  score()
} else {
  console.error(`unknown command "${command}", use: collect | score`)
  process.exit(1)
}
