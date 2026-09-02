/**
 * Media ingest: containers, codecs and file bytes.
 *
 * The contract, and nothing more: turn a source of bytes into the signal
 * `sync-core` correlates, plus the metadata the exporters need. Everything
 * codec-specific stops at this boundary — nothing above this package knows
 * what a codec is.
 *
 * See `docs/02-architecture.md` for the fallback ladder and
 * `docs/08-build-plan.md` for what is built and what is not.
 */

export * from './source.js';
export * from './wav.js';
export * from './iso.js';
export * from './container.js';
export * from './derive.js';
export * from './group.js';
export * from './identity.js';
export * from './ingest.js';
