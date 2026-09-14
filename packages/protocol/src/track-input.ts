import { z } from 'zod';
import { voice, trackInputIdSchema } from '@ledrums/core';
export { trackInputIdSchema } from '@ledrums/core';

/** Local track-device transport. Devices can provide inputs, never author documents. */
export const TRACK_INPUT_PORT = 4322;
export const TRACK_INPUT_MAX_BYTES = 2048;
export const TRACK_INPUT_LIMIT = 32;
export const TRACK_INPUT_TIMEOUT_MS = 3000;
const identity = {
  v: z.literal(1),
  id: trackInputIdSchema,
  session: trackInputIdSchema,
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
};
const channel = z.number().int().min(1).max(16);
const midiByte = z.number().int().min(0).max(127);
export const trackPacketSchema = z.discriminatedUnion('t', [
  z.object({ ...identity, t: z.literal('hello'), name: z.string().trim().min(1).max(80), kind: z.enum(['midi', 'audio']) }).strict(),
  z.object({ ...identity, t: z.literal('bye') }).strict(),
  z.object({ ...identity, t: z.literal('midi'), note: midiByte, velocity: midiByte, on: z.boolean(), channel }).strict(),
  z.object({ ...identity, t: z.literal('cc'), controller: midiByte, value: midiByte, channel }).strict(),
  z.object({ ...identity, t: z.literal('audio'), ...voice.audioFeatureFrameSchema.shape }).strict(),
  // Eight normalized, track-scoped controls; map with existing OSC modulation nodes.
  z.object({ ...identity, t: z.literal('macro'), index: z.number().int().min(1).max(8), value: z.number().finite().min(0).max(1) }).strict(),
]);
export type TrackPacket = z.infer<typeof trackPacketSchema>;
export const trackInputInfoSchema = z.object({
  id: trackInputIdSchema,
  name: z.string(),
  kind: z.enum(['midi', 'audio']),
  connected: z.boolean(),
  lastNote: midiByte.nullable(),
  lastChannel: channel.nullable(),
  received: z.number().int().nonnegative(),
  dropped: z.number().int().nonnegative(),
  audio: voice.audioFeatureFrameSchema,
});
export type TrackInputInfo = z.infer<typeof trackInputInfoSchema>;
export const trackInputsStatusSchema = z.object({
  status: z.enum(['listening', 'error', 'off']),
  port: z.number().int().min(0).max(65535),
  error: z.string().optional(),
  inputs: z.array(trackInputInfoSchema).max(TRACK_INPUT_LIMIT),
});
export type TrackInputsStatus = z.infer<typeof trackInputsStatusSchema>;

/** Stable, collision-free names use saved device IDs, never editable track labels. */
export function trackInputAddress(id: string, control: string): string {
  return `/tracks/${id}/${control}`;
}
