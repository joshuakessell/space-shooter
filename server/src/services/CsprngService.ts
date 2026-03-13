// ─────────────────────────────────────────────────────────────
// CSPRNG Service — Cryptographically Secure Random Numbers
// Uses Node.js crypto module. Injectable for testability.
// ─────────────────────────────────────────────────────────────

import { randomInt, randomBytes } from 'node:crypto';

/** Interface for RNG — allows swapping in a seeded RNG for tests */
export interface IRngService {
  /** Returns a random float in [0, 1) — uniformly distributed */
  random(): number;
  /** Returns a random integer in [min, max) */
  randomRange(min: number, max: number): number;
  /** Returns a random float in [min, max) */
  randomFloat(min: number, max: number): number;
}

/**
 * Production CSPRNG service using Node.js crypto module.
 * NEVER use Math.random() for casino/RTP calculations.
 */
export class CsprngService implements IRngService {
  /**
   * Generate a cryptographically secure random float in [0, 1).
   * Uses 4 bytes of entropy → 2^32 possible values.
   */
  random(): number {
    const bytes = randomBytes(4);
    const value = bytes.readUInt32BE(0);
    return value / 0x100000000; // Divide by 2^32
  }

  /** Random integer in [min, max) using crypto.randomInt */
  randomRange(min: number, max: number): number {
    return randomInt(min, max);
  }

  /** Random float in [min, max) */
  randomFloat(min: number, max: number): number {
    return min + this.random() * (max - min);
  }
}

/**
 * Seeded deterministic RNG for unit tests.
 * Uses a simple Mulberry32 PRNG with a fixed seed.
 * NOT cryptographically secure — for testing only.
 */
export class SeededRngService implements IRngService {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  random(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  randomRange(min: number, max: number): number {
    return Math.floor(min + this.random() * (max - min));
  }

  randomFloat(min: number, max: number): number {
    return min + this.random() * (max - min);
  }
}
