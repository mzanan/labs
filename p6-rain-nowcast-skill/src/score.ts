import type {
  Config,
  ForecastRecord,
  Horizon,
  HorizonScore,
  ObservationRecord,
  Outcome,
  ScoredCase,
  Thresholds,
} from './types.ts'

const MINUTE = 60_000

export function predictsRain(
  precipitationMm: number,
  probabilityPct: number | null,
  thresholds: Thresholds,
): boolean {
  const byMm = precipitationMm >= thresholds.forecastRainMm
  const byProbability =
    probabilityPct !== null && probabilityPct >= thresholds.forecastProbabilityPct

  if (thresholds.rule === 'mm') return byMm
  if (thresholds.rule === 'probability') return byProbability
  return byMm || byProbability
}

function windowFor(issuedAt: string, horizon: Horizon): { start: number; end: number } {
  const issued = new Date(issuedAt).getTime()
  const start = issued + horizon.leadMinutes * MINUTE
  return { start, end: start + horizon.windowMinutes * MINUTE }
}

function outcomeOf(predicted: boolean, observed: boolean): Outcome {
  if (predicted && observed) return 'hit'
  if (predicted && !observed) return 'false-alarm'
  if (!predicted && observed) return 'miss'
  return 'correct-negative'
}

export function scoreCase(
  forecast: ForecastRecord,
  horizon: Horizon,
  observations: ObservationRecord[],
  thresholds: Thresholds,
): ScoredCase | null {
  const { start, end } = windowFor(forecast.issuedAt, horizon)

  const steps = forecast.steps.filter((step) => {
    const time = new Date(step.time).getTime()
    return time >= start && time < end
  })
  if (steps.length === 0) return null

  const inWindow = observations.filter((entry) => {
    const time = new Date(entry.observedAt).getTime()
    return time >= start && time < end
  })
  if (inWindow.length === 0) return null

  const forecastMm = steps.reduce((total, step) => total + step.precipitationMm, 0)
  const probabilities = steps
    .map((step) => step.probabilityPct)
    .filter((value): value is number => value !== null)
  const forecastProbabilityPct = probabilities.length > 0 ? Math.max(...probabilities) : null

  const predictedRain = predictsRain(forecastMm, forecastProbabilityPct, thresholds)
  const observedRain = inWindow.some((entry) => entry.raining)

  return {
    issuedAt: forecast.issuedAt,
    horizon: horizon.label,
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(end).toISOString(),
    predictedRain,
    forecastMm: Number(forecastMm.toFixed(2)),
    forecastProbabilityPct,
    observedRain,
    observationCount: inWindow.length,
    outcome: outcomeOf(predictedRain, observedRain),
  }
}

export function scoreAll(
  config: Config,
  forecasts: ForecastRecord[],
  observations: ObservationRecord[],
): { cases: ScoredCase[]; scores: HorizonScore[] } {
  const cases: ScoredCase[] = []
  for (const forecast of forecasts) {
    for (const horizon of config.horizons) {
      const scored = scoreCase(forecast, horizon, observations, config.thresholds)
      if (scored) cases.push(scored)
    }
  }
  return { cases, scores: config.horizons.map((horizon) => summarize(horizon.label, cases)) }
}

export function summarize(horizonLabel: string, cases: ScoredCase[]): HorizonScore {
  const subset = cases.filter((entry) => entry.horizon === horizonLabel)
  const count = (outcome: Outcome) => subset.filter((entry) => entry.outcome === outcome).length

  const hits = count('hit')
  const misses = count('miss')
  const falseAlarms = count('false-alarm')
  const correctNegatives = count('correct-negative')

  const ratio = (numerator: number, denominator: number) =>
    denominator === 0 ? null : Number((numerator / denominator).toFixed(3))

  return {
    horizon: horizonLabel,
    cases: subset.length,
    hits,
    misses,
    falseAlarms,
    correctNegatives,
    pod: ratio(hits, hits + misses),
    far: ratio(falseAlarms, hits + falseAlarms),
    csi: ratio(hits, hits + misses + falseAlarms),
    accuracy: ratio(hits + correctNegatives, subset.length),
  }
}
