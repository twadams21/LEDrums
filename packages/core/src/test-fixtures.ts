/**
 * TEST-ONLY entry point (`@ledrums/core/test-fixtures`) — a second ENTRY POINT, not a second
 * public API. Nothing in the production graph may import this module.
 *
 * It exists so cross-package test suites can reach core's parity fixtures without those fixtures
 * living on the shipped `voice` namespace. The motivating case: `legacyEnvValue` is a
 * reimplementation of the SUPERSEDED envelope formula, kept only so a migration test can prove the
 * new mapping path is sample-identical to the old one. Published on `voice`, an implementer could
 * reach for it and get deliberately-wrong math (middle-man-0003).
 *
 * Same purity rules as the rest of `packages/core`: no Node/DOM/IO imports, and no vitest — these
 * are plain data and pure functions, so a non-vitest consumer can use them too.
 */
export {
  MODULATION_PARITY_CASES,
  PARITY_PHASES,
  legacyEnvValue,
  mappingEnvValue,
  type ParityCase,
} from './voice/modulation-parity';
