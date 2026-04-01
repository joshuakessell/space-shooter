// ─────────────────────────────────────────────────────────────
// Game Constants — Shared between client and server
// ─────────────────────────────────────────────────────────────

import type { WeaponType } from './types.js';

/** Game world dimensions (pixels) */
export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;

/** Server simulation tick rate (ticks per second) */
export const TICK_RATE = 20;

/** Fixed time step per tick in milliseconds */
export const FIXED_TIMESTEP_MS = 1000 / TICK_RATE; // 50ms

/** Fixed time step per tick in seconds (for physics math) */
export const FIXED_TIMESTEP_SEC = FIXED_TIMESTEP_MS / 1000; // 0.05s

/** Maximum players per room */
export const MAX_PLAYERS = 6;

/** Betting: $10 to $300 in increments of $10 */
export const BET_INCREMENT = 10;
export const MIN_BET = 10;
export const MAX_BET = 300;
export const DEFAULT_BET = MIN_BET;

/** All valid bet tiers (generated from range) */
export const BET_TIERS: readonly number[] = Array.from(
  { length: (MAX_BET - MIN_BET) / BET_INCREMENT + 1 },
  (_, i) => MIN_BET + i * BET_INCREMENT,
);
/** Target Return-to-Player percentage */
export const TARGET_RTP = 0.98;

/** Starting credits for new players */
export const STARTING_CREDITS = 10000;

/** Projectile speed (pixels per second) */
export const PROJECTILE_SPEED = 800;

/** Projectile radius for collision detection (pixels) */
export const PROJECTILE_RADIUS = 6;

/** Minimum space object radius for collision (pixels) */
export const MIN_OBJECT_RADIUS = 20;

/** Maximum simultaneous projectiles per player */
export const MAX_PROJECTILES_PER_PLAYER = 20;

/** Maximum simultaneous space objects on screen */
export const MAX_SPACE_OBJECTS = 78;

/** Space object base speed range (pixels per second) */
export const OBJECT_MIN_SPEED = 70;
export const OBJECT_MAX_SPEED = 220;

/** Spawn interval range in ticks */
export const SPAWN_MIN_INTERVAL_TICKS = 1;   // 50ms — fast spawns to keep targets plentiful
export const SPAWN_MAX_INTERVAL_TICKS = 3;   // 150ms

/** Turret pivot offset from screen edge (pixels) */
export const TURRET_EDGE_OFFSET = 5;

/** Turret positions: pixel coordinates for each of the 6 turret slots.
 *  Pivot centers sit 5px from the screen edge. */
export const TURRET_POSITIONS: Record<string, { x: number; y: number }> = {
  TOP_LEFT:      { x: 240,  y: TURRET_EDGE_OFFSET },
  TOP_MIDDLE:    { x: 960,  y: TURRET_EDGE_OFFSET },
  TOP_RIGHT:     { x: 1680, y: TURRET_EDGE_OFFSET },
  BOTTOM_LEFT:   { x: 240,  y: GAME_HEIGHT - TURRET_EDGE_OFFSET },
  BOTTOM_MIDDLE: { x: 960,  y: GAME_HEIGHT - TURRET_EDGE_OFFSET },
  BOTTOM_RIGHT:  { x: 1680, y: GAME_HEIGHT - TURRET_EDGE_OFFSET },
};

/**
 * Seat-indexed turret coordinates (seatIndex 0–5).
 * 0=bottom-left, 1=bottom-middle, 2=bottom-right,
 * 3=top-left, 4=top-middle, 5=top-right.
 * Pivot centers sit 5px from the screen edge.
 */
export const SEAT_COORDINATES: readonly { readonly x: number; readonly y: number }[] = [
  { x: 240,  y: GAME_HEIGHT - TURRET_EDGE_OFFSET }, // seat 0 — bottom-left
  { x: 960,  y: GAME_HEIGHT - TURRET_EDGE_OFFSET }, // seat 1 — bottom-middle
  { x: 1680, y: GAME_HEIGHT - TURRET_EDGE_OFFSET }, // seat 2 — bottom-right
  { x: 240,  y: TURRET_EDGE_OFFSET },               // seat 3 — top-left
  { x: 960,  y: TURRET_EDGE_OFFSET },               // seat 4 — top-middle
  { x: 1680, y: TURRET_EDGE_OFFSET },               // seat 5 — top-right
];

/** Whether a seat index is on the top edge (seats 3–5) */
export function isSeatTop(seatIndex: number): boolean {
  return seatIndex >= 3;
}

/** Clamp an angle to the valid 180° firing arc for the given seat.
 *  Bottom seats fire upward [-π, 0], top seats fire downward [0, π]. */
export function clampTurretAngle(angle: number, seatIndex: number): number {
  if (isSeatTop(seatIndex)) {
    // Top turrets fire downward: valid range [0, π]
    if (angle < 0) return angle > -Math.PI / 2 ? 0 : Math.PI;
  } else {
    // Bottom turrets fire upward: valid range [-π, 0]
    if (angle > 0) return angle < Math.PI / 2 ? 0 : -Math.PI;
  }
  return angle;
}

/** Maximum wall bounces before a projectile expires */
export const MAX_BOUNCES = 4;

/** Object pool pre-allocation sizes */
export const PROJECTILE_POOL_SIZE = 200;
export const SPACE_OBJECT_POOL_SIZE = 80;

/** Quadtree configuration */
export const QUADTREE_MAX_OBJECTS = 10;
export const QUADTREE_MAX_LEVELS = 5;

/** Homing missile turn rate (lerp factor per tick, 0–1) */
export const HOMING_TURN_RATE = 0.08;

// ─── Weapon System ───

/** Cost multiplier per weapon type (applied to betAmount) */
export const WEAPON_COST: Record<WeaponType, number> = {
  standard: 1,
  spread: 3,
  lightning: 5,
};

/** Spread shot angle offset in radians (15°) */
export const SPREAD_ANGLE_OFFSET = Math.PI / 12;

/** Chain lightning: max search radius for next target (pixels) */
export const CHAIN_LIGHTNING_RADIUS = 300;

/** Chain lightning: max number of chain jumps */
export const CHAIN_LIGHTNING_MAX_CHAINS = 4;

/** Supernova bomb: AoE blast radius (pixels) */
export const AOE_BLAST_RADIUS = 400;

/** Seat colors — distinct hex color per seat (0–5) */
export const SEAT_COLORS: readonly string[] = [
  '#FF4444', // seat 0 — Red
  '#4488FF', // seat 1 — Blue
  '#44FF88', // seat 2 — Green
  '#FFD700', // seat 3 — Gold
  '#CC44FF', // seat 4 — Purple
  '#FF8844', // seat 5 — Orange
];

// ─── Feature Targets / Hazard System ───

/** Black hole pull radius (pixels) */
export const BLACKHOLE_PULL_RADIUS = 500;

/** Black hole pull speed (pixels per second) */
export const BLACKHOLE_PULL_SPEED = 200;

/** Quantum drill projectile speed (pixels per second) */
export const DRILL_SPEED = 600;

/** Quantum drill max duration (seconds) */
export const DRILL_MAX_DURATION_SEC = 8;

/** EMP relay: staggered kill delay per victim (ms) */
export const EMP_CHAIN_DELAY_MS = 100;

/** Orbital laser buff duration (seconds) */
export const ORBITAL_LASER_DURATION_SEC = 8;

/** Orbital laser beam width (pixels) */
export const ORBITAL_LASER_WIDTH = 100;

/** Cosmic vault roulette multiplier tiers (weighted toward lower tiers) */
export const VAULT_MULTIPLIERS = [20, 30, 50, 80, 100, 150] as const;

/** Hazard payout budget range (multiplied by bet) — exciting but bounded */
export const HAZARD_BUDGET_MIN = 30;
export const HAZARD_BUDGET_MAX = 80;
