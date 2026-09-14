import { z } from 'zod';

const observationSchema = z.object({
  count: z.number().int().nonnegative(),
  sum: z.number().finite().nonnegative(),
  min: z.number().finite().nonnegative().nullable(),
  max: z.number().finite().nonnegative().nullable(),
  mean: z.number().finite().nonnegative().nullable(),
  p50: z.number().finite().nonnegative().nullable(),
  p95: z.number().finite().nonnegative().nullable(),
  p99: z.number().finite().nonnegative().nullable(),
  truncated: z.boolean(),
});
/** Server observations, not browser FPS or physical kit latency. Window percentiles cannot
 * be averaged into run-wide percentiles. See scripts/perf-dev for the measurement contract. */
export const frameTimingSchema = z.object({
  version: z.literal(1), clock: z.literal('performance.now'), quantileMethod: z.literal('nearest-rank'),
  targetHz: z.number().finite().positive(), capacityPerMetric: z.number().int().positive(),
  windowMs: z.number().finite().positive(), warmupMs: z.number().finite().nonnegative(),
  recordingStartedAtMs: z.number().finite().nonnegative(),
  windowStartMs: z.number().finite().nonnegative(), windowEndMs: z.number().finite().nonnegative(),
  warmupRemainingMs: z.number().finite().nonnegative(),
  ticksObserved: z.number().int().nonnegative(), loopsObserved: z.number().int().nonnegative(),
  rejectedTicks: z.number().int().nonnegative(), rejectedLoops: z.number().int().nonnegative(),
  tickIntervalMs: observationSchema, renderDurationMs: observationSchema, loopIntervalMs: observationSchema,
  timerLatenessMs: observationSchema, clampedElapsedMs: observationSchema,
  discardedBacklogMs: observationSchema, stepsPerLoop: observationSchema,
  host: z.object({
    os: z.string(), osRelease: z.string(), arch: z.string(), node: z.string(), cpu: z.string(),
    logicalCpuCount: z.number().int().nonnegative(),
  }),
});
export type FrameTimingReport = z.infer<typeof frameTimingSchema>;
