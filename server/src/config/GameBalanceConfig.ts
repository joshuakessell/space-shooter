// ─────────────────────────────────────────────────────────────
// GameBalanceConfig — Externalized Tuning Data
// ─────────────────────────────────────────────────────────────
// CONFIG-DRIVEN: All game economy values live here.
// Operators can modify thresholds without touching game logic.
// No hardcoded multipliers, rates, or RTP math in systems.
// ─────────────────────────────────────────────────────────────

import { SpaceObjectType } from '@space-shooter/shared';

// ─── Volatility Tide States ───

/** Room volatility phase */
export enum VolatilityPhase {
  /** Room is "eating" — lower kill rates to build house profit */
  EATING = 'EATING',
  /** Normal operating baseline */
  BASELINE = 'BASELINE',
  /** High-payout frenzy burst to clear the board */
  FRENZY = 'FRENZY',
}

// ─── Config Interface ───

export interface IGameBalanceConfig {
  // ─── RTP ───
  readonly targetRtp: number;
  readonly maxSuccessThreshold: number; // Hard clamp — no guaranteed kills

  // ─── Volatility Tides ───
  readonly volatility: {
    readonly phases: Record<VolatilityPhase, number>; // Global multiplier per phase
    readonly eatingToBaselineProfitRatio: number;      // Switch out of EATING when profit drops below this
    readonly baselineToFrenzyProfitRatio: number;      // Trigger FRENZY when profit exceeds this
    readonly frenzyDurationTicks: number;               // How long FRENZY lasts
    readonly minTicksBetweenTransitions: number;        // Cooldown between phase changes
  };

  // ─── Hot-Seat ───
  readonly hotSeat: {
    readonly boostMultiplier: number;     // Hot-seat player's RNG threshold multiplier
    readonly penaltyMultiplier: number;   // Other players' penalty to balance room RTP
    readonly rotationIntervalTicks: number; // Ticks between hot-seat rotations
  };

  // ─── Piñata Boss (Sunk-Cost Escalation) ───
  readonly pinata: {
    /** Piñata modifier ramps from 1.0 → this value as absorbed credits approach maxExpectedPayout */
    readonly maxModifier: number;
    /** Curve exponent: 1.0=linear, 2.0=quadratic acceleration, 0.5=sqrt diminishing */
    readonly curveExponent: number;
  };

  // ─── Pity Timer (Churn Prevention) ───
  readonly pity: {
    readonly missThreshold: number;      // Consecutive misses before pity kicks in
    readonly pityModifier: number;       // Kill chance multiplier during pity
    readonly appliesToMaxMultiplier: number; // Only applies to targets ≤ this multiplier
  };

  /** Per-object-type balance data (multiplier, radius, spawn weight) */
  readonly objectTypes: Record<SpaceObjectType, IObjectTypeConfig>;
}

/** Config for a single space object type */
export interface IObjectTypeConfig {
  readonly multiplier: number;
  readonly destroyProbability: number;
  readonly collisionRadius: number;
  readonly spawnWeight: number;
}

// ─────────────────────────────────────────────────────────────
// DEFAULT CONFIG INSTANCE
// Operators tune this object to change all game economy behavior.
// Math invariant: destroyProbability × multiplier ≈ targetRtp
// ─────────────────────────────────────────────────────────────

export const GAME_BALANCE_CONFIG: IGameBalanceConfig = {
  targetRtp: 0.98,
  maxSuccessThreshold: 0.85, // Clamp: no shot is ever >85% guaranteed

  volatility: {
    phases: {
      [VolatilityPhase.EATING]:   0.7,
      [VolatilityPhase.BASELINE]: 1,
      [VolatilityPhase.FRENZY]:   1.5,
    },
    eatingToBaselineProfitRatio: 0.05,  // Exit EATING when profit < 5% of credits_in
    baselineToFrenzyProfitRatio: 0.15,  // Enter FRENZY when profit > 15% of credits_in
    frenzyDurationTicks: 200,            // ~10 seconds at 20 ticks/sec
    minTicksBetweenTransitions: 100,     // ~5 second cooldown
  },

  hotSeat: {
    boostMultiplier: 1.3,
    penaltyMultiplier: 0.94,
    rotationIntervalTicks: 2400, // ~2 minutes at 20 ticks/sec
  },

  pinata: {
    maxModifier: 3,    // Up to 3x boost as credits accumulate
    curveExponent: 1.5,  // Between linear and quadratic
  },

  pity: {
    missThreshold: 30,
    pityModifier: 2,
    appliesToMaxMultiplier: 10, // Only for targets ≤ 10x
  },

  objectTypes: {
    [SpaceObjectType.ASTEROID]: {
      multiplier: 2,
      destroyProbability: 0.49,    // 2 × 0.49 = 0.98
      collisionRadius: 40,
      spawnWeight: 30,
    },
    [SpaceObjectType.ROCKET]: {
      multiplier: 3,
      destroyProbability: 0.3267,  // 3 × 0.3267 ≈ 0.98
      collisionRadius: 35,
      spawnWeight: 25,
    },
    [SpaceObjectType.ALIEN_CRAFT]: {
      multiplier: 5,
      destroyProbability: 0.196,   // 5 × 0.196 = 0.98
      collisionRadius: 32,
      spawnWeight: 18,
    },
    [SpaceObjectType.SPACE_JELLY]: {
      multiplier: 8,
      destroyProbability: 0.1225,  // 8 × 0.1225 = 0.98
      collisionRadius: 30,
      spawnWeight: 12,
    },
    [SpaceObjectType.ALIEN_CREATURE]: {
      multiplier: 15,
      destroyProbability: 0.0653,  // 15 × 0.0653 ≈ 0.98
      collisionRadius: 28,
      spawnWeight: 7,
    },
    [SpaceObjectType.METEOR_SHOWER]: {
      multiplier: 25,
      destroyProbability: 0.0392,  // 25 × 0.0392 = 0.98
      collisionRadius: 26,
      spawnWeight: 4,
    },
    [SpaceObjectType.NEBULA_BEAST]: {
      multiplier: 50,
      destroyProbability: 0.0196,  // 50 × 0.0196 = 0.98
      collisionRadius: 24,
      spawnWeight: 2.5,
    },
    [SpaceObjectType.COSMIC_WHALE]: {
      multiplier: 100,
      destroyProbability: 0.0098,  // 100 × 0.0098 = 0.98
      collisionRadius: 22,
      spawnWeight: 1.5,
    },
  },
};
