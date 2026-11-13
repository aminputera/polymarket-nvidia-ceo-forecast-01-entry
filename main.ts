import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95] as const;
const NORMAL_Z = [-1.644854, -0.67449, 0, 0.67449, 1.644854] as const;

const RECENT_WINDOW = 120;
const EMPIRICAL_WINDOW = 720;
const WINSOR_LEVEL = 0.98;
const BASELINE_SIGMA = 0.0025;
const SIGMA_FLOOR = 0.0005;
const SIGMA_CEILING = 0.012;
const EMPIRICAL_WEIGHT = 0.25;

interface Market {
  id: string;
  prices: number[];
}

interface ForecastCase {
  horizon_minutes: number;
  quantiles: number[];
  markets: Market[];
}

function clampPrice(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function price6(value: number): number {
  return Math.round(clampPrice(value) * 1e6) / 1e6 + 0;
}

function quantile(sorted: number[], level: number): number {
  if (sorted.length === 0) throw new Error('quantile of empty sample');
  const position = (sorted.length - 1) * level;
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, sorted.length - 1);
  const weight = position - lower;
  return (sorted[lower] as number) * (1 - weight) + (sorted[upper] as number) * weight;
}

function recentSigma(prices: number[]): number {
  const start = Math.max(1, prices.length - RECENT_WINDOW);
  const changes: number[] = [];
  for (let i = start; i < prices.length; i++) {
    changes.push((prices[i] as number) - (prices[i - 1] as number));
  }
  if (changes.length < 30) return BASELINE_SIGMA;

  const magnitudes = changes.map(Math.abs).sort((a, b) => a - b);
  const cap = quantile(magnitudes, WINSOR_LEVEL);
  let squaredSum = 0;
  for (const change of changes) {
    const clipped = Math.min(cap, Math.max(-cap, change));
    squaredSum += clipped * clipped;
  }
  const observed = Math.sqrt(squaredSum / changes.length);
  return Math.min(SIGMA_CEILING, Math.max(SIGMA_FLOOR, observed));
}

function forecastMarket(market: Market, horizon: number): number[][] {
  if (market.prices.length === 0) throw new Error(`market ${market.id} has no prices`);
  const prices = market.prices;
  const current = prices[prices.length - 1] as number;
  const sigma = recentSigma(prices);
  const rows = new Array<number[]>(horizon);

  for (let h = 1; h <= horizon; h++) {
    const rootH = Math.sqrt(h);
    const gaussian = NORMAL_Z.map((z) => clampPrice(current + z * sigma * rootH));
    const sampleStart = Math.max(h, prices.length - EMPIRICAL_WINDOW);
    const changes: number[] = [];
    for (let i = sampleStart; i < prices.length; i++) {
      changes.push((prices[i] as number) - (prices[i - h] as number));
    }

    if (changes.length < 30) {
      rows[h - 1] = gaussian.map(price6);
      continue;
    }

    changes.sort((a, b) => a - b);
    rows[h - 1] = QUANTILES.map((level, index) => {
      const empirical = clampPrice(current + quantile(changes, level));
      return price6((1 - EMPIRICAL_WEIGHT) * (gaussian[index] as number) + EMPIRICAL_WEIGHT * empirical);
    });
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const inputFiles = readdirSync(INPUT_DIR).filter((file) => file.endsWith('.in')).sort();
for (const inputFile of inputFiles) {
  const caseId = inputFile.slice(0, -3);
  const forecastCase = JSON.parse(readFileSync(join(INPUT_DIR, inputFile), 'utf8')) as ForecastCase;
  if (
    forecastCase.quantiles.length !== QUANTILES.length
    || forecastCase.quantiles.some((level, index) => level !== QUANTILES[index])
  ) {
    throw new Error(`${inputFile} requests unsupported quantiles`);
  }
  const forecasts = forecastCase.markets.map((market) => ({
    id: market.id,
    q: forecastMarket(market, forecastCase.horizon_minutes),
  }));
  writeFileSync(join(OUTPUT_DIR, `${caseId}.out`), `${JSON.stringify({ forecasts })}\n`);
}
