export type Site = {
  label: string
  latitude: number
  longitude: number
  timezone: string
  station: string
  stationDistanceKm: number
}

export type Horizon = {
  label: string
  leadMinutes: number
  windowMinutes: number
}

export type Thresholds = {
  forecastRainMm: number
  forecastProbabilityPct: number
  rule: 'mm' | 'probability' | 'either'
}

export type Config = {
  sites: Record<string, Site>
  forecast: { provider: string; endpoint: string; steps: number }
  observation: { provider: string; endpoint: string; lookbackHours: number }
  horizons: Horizon[]
  thresholds: Thresholds
}

export type ForecastStep = {
  time: string
  precipitationMm: number
  probabilityPct: number | null
}

export type ForecastRecord = {
  kind: 'forecast'
  site: string
  issuedAt: string
  provider: string
  steps: ForecastStep[]
}

export type RainIntensity = 'none' | 'light' | 'moderate' | 'heavy'

export type ObservationRecord = {
  kind: 'observation'
  site: string
  station: string
  observedAt: string
  raining: boolean
  intensity: RainIntensity
  weatherCode: string | null
  raw: string
}

export type Outcome = 'hit' | 'miss' | 'false-alarm' | 'correct-negative'

export type ScoredCase = {
  issuedAt: string
  horizon: string
  windowStart: string
  windowEnd: string
  predictedRain: boolean
  forecastMm: number
  forecastProbabilityPct: number | null
  observedRain: boolean
  observationCount: number
  outcome: Outcome
}

export type HorizonScore = {
  horizon: string
  cases: number
  hits: number
  misses: number
  falseAlarms: number
  correctNegatives: number
  pod: number | null
  far: number | null
  csi: number | null
  accuracy: number | null
}
