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

  // ─── Security / Anti-Cheat ───
  readonly security: {
    /** Minimum ms between shots per player (O(1) timestamp delta) */
    readonly maxFireRateMs: number;
    /** Rate-limit violations before auto-kick */
    readonly rateLimitViolationThreshold: number;
    /** Sliding window for violation counting */
    readonly rateLimitWindowMs: number;
    /** Seconds to reserve seat for a disconnected player */
    readonly reconnectionTimeoutSec: number;
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
  // Base RTP at 0.98 — modifiers and volatility swing around this center.
  // EATING (0.85x) creates mild lulls, FRENZY (1.4x) creates exciting bursts.
  // The distribution shape is: features > bosses > mid-tier > commons.
  targetRtp: 0.98,
  maxSuccessThreshold: 0.75, // Let common fish die reasonably while still preventing guarantees

  volatility: {
    phases: {
      [VolatilityPhase.EATING]:   0.85,  // Mild lull — kills slow by 15%, player notices but isn't frustrated
      [VolatilityPhase.BASELINE]: 1.0,
      [VolatilityPhase.FRENZY]:   1.4,   // Exciting burst — 40% more kills, screen lights up
    },
    eatingToBaselineProfitRatio: 0.03,   // Exit EATING quickly when profit thins to 3%
    baselineToFrenzyProfitRatio: 0.06,   // Enter FRENZY when house is up 6% — triggers often
    frenzyDurationTicks: 160,            // ~8 seconds — noticeable burst
    minTicksBetweenTransitions: 60,      // ~3 second cooldown — fast oscillation
  },

  hotSeat: {
    boostMultiplier: 1.12,
    penaltyMultiplier: 0.97,
    rotationIntervalTicks: 1200, // ~1 minute
  },

  pinata: {
    maxModifier: 1.5,      // Moderate boost as credits accumulate
    curveExponent: 2.0,    // Quadratic — boost ramps late
  },

  pity: {
    missThreshold: 50,     // Safety net after long dry spell
    pityModifier: 1.3,     // Gentle nudge
    appliesToMaxMultiplier: 5, // Low-tier targets only
  },

  security: {
    maxFireRateMs: 150,
    rateLimitViolationThreshold: 10,
    rateLimitWindowMs: 3000,
    reconnectionTimeoutSec: 30,
  },

  // ─── Economy Design Philosophy ───
  // Common fish (asteroid, rocket, alien_craft) are "ammo sinks" — low multipliers
  // mean players slowly drain credits shooting them. Winning comes from:
  //   1. Mid-tier kills (space_jelly through meteor_shower) — satisfying medium hits
  //   2. Boss kills (nebula_beast, cosmic_whale) — rare jackpot moments
  //   3. Feature triggers (blackhole, drill, emp, orbital, vault) — spectacular bonus rounds
  //
  // destroyProbability = targetRtp / multiplier (config invariant for tests)
  objectTypes: {
    // ─── Common "ammo sink" fish — frequent spawns, low reward ───
    [SpaceObjectType.ASTEROID]: {
      multiplier: 2,
      destroyProbability: 0.49,    // 2 × 0.49 = 0.98
      collisionRadius: 30,
      spawnWeight: 30,
    },
    [SpaceObjectType.ROCKET]: {
      multiplier: 3,
      destroyProbability: 0.3267,  // 3 × 0.3267 ≈ 0.98
      collisionRadius: 32,
      spawnWeight: 25,
    },
    [SpaceObjectType.ALIEN_CRAFT]: {
      multiplier: 4,
      destroyProbability: 0.245,   // 4 × 0.245 = 0.98
      collisionRadius: 35,
      spawnWeight: 20,
    },
    // ─── Mid-tier "bread and butter" — where average wins come from ───
    [SpaceObjectType.SPACE_JELLY]: {
      multiplier: 10,
      destroyProbability: 0.098,   // 10 × 0.098 = 0.98
      collisionRadius: 40,
      spawnWeight: 12,
    },
    [SpaceObjectType.ALIEN_CREATURE]: {
      multiplier: 20,
      destroyProbability: 0.049,   // 20 × 0.049 = 0.98
      collisionRadius: 45,
      spawnWeight: 8,
    },
    [SpaceObjectType.METEOR_SHOWER]: {
      multiplier: 40,
      destroyProbability: 0.0245,  // 40 × 0.0245 = 0.98
      collisionRadius: 50,
      spawnWeight: 5,
    },
    // ─── Boss-tier "jackpot" — rare, massive payouts, crowd goes wild ───
    [SpaceObjectType.NEBULA_BEAST]: {
      multiplier: 80,
      destroyProbability: 0.01225, // 80 × 0.01225 = 0.98
      collisionRadius: 65,
      spawnWeight: 3,
    },
    [SpaceObjectType.COSMIC_WHALE]: {
      multiplier: 200,
      destroyProbability: 0.0049,  // 200 × 0.0049 = 0.98
      collisionRadius: 80,
      spawnWeight: 1.5,
    },
    // ─── Feature targets — rare and exciting, trigger bonus rounds ───
    // These should feel SPECIAL when they appear. Hazard payouts bypass RTP,
    // so spawn frequency must be low enough that total hazard output stays
    // within the overall economy. Target: ~2-3% of spawns are features.
    [SpaceObjectType.SUPERNOVA_BOMB]: {
      multiplier: 15,
      destroyProbability: 0.0653,  // 15 × 0.0653 ≈ 0.98 (AoE on kill)
      collisionRadius: 50,
      spawnWeight: 0.8,            // Rare — exciting when it appears
    },
    [SpaceObjectType.BLACKHOLE_GEN]: {
      multiplier: 10,
      destroyProbability: 0.098,
      collisionRadius: 55,
      spawnWeight: 0.5,
    },
    [SpaceObjectType.QUANTUM_DRILL]: {
      multiplier: 10,
      destroyProbability: 0.098,
      collisionRadius: 55,
      spawnWeight: 0.5,
    },
    [SpaceObjectType.EMP_RELAY]: {
      multiplier: 10,
      destroyProbability: 0.098,
      collisionRadius: 50,
      spawnWeight: 0.6,
    },
    [SpaceObjectType.ORBITAL_CORE]: {
      multiplier: 15,
      destroyProbability: 0.0653,
      collisionRadius: 55,
      spawnWeight: 0.3,
    },
    [SpaceObjectType.COSMIC_VAULT]: {
      multiplier: 10,
      destroyProbability: 0.098,
      collisionRadius: 55,
      spawnWeight: 0.4,
    },
  },
};
