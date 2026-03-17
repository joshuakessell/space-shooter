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

/** Betting tiers — casino-standard discrete bet amounts */
export const BET_TIERS = [10, 50, 100, 500, 1000] as const;
export type BetTier = (typeof BET_TIERS)[number];

/** Betting limits (derived from tiers) */
export const MIN_BET = BET_TIERS[0];
export const MAX_BET = BET_TIERS.at(-1)!;
export const DEFAULT_BET = BET_TIERS[0];

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
export const MAX_SPACE_OBJECTS = 30;

/** Space object base speed range (pixels per second) */
export const OBJECT_MIN_SPEED = 60;
export const OBJECT_MAX_SPEED = 200;

/** Spawn interval range in ticks */
export const SPAWN_MIN_INTERVAL_TICKS = 5;   // 250ms
export const SPAWN_MAX_INTERVAL_TICKS = 20;  // 1000ms

/** Turret positions: pixel coordinates for each of the 6 turret slots */
export const TURRET_POSITIONS: Record<string, { x: number; y: number }> = {
  TOP_LEFT:      { x: 240,  y: 60 },
  TOP_MIDDLE:    { x: 960,  y: 60 },
  TOP_RIGHT:     { x: 1680, y: 60 },
  BOTTOM_LEFT:   { x: 240,  y: 1020 },
  BOTTOM_MIDDLE: { x: 960,  y: 1020 },
  BOTTOM_RIGHT:  { x: 1680, y: 1020 },
};

/**
 * Seat-indexed turret coordinates (seatIndex 0–5).
 * 0=bottom-left, 1=bottom-middle, 2=bottom-right,
 * 3=top-left, 4=top-middle, 5=top-right.
 */
export const SEAT_COORDINATES: readonly { readonly x: number; readonly y: number }[] = [
  { x: 240,  y: 1020 }, // seat 0 — bottom-left
  { x: 960,  y: 1020 }, // seat 1 — bottom-middle
  { x: 1680, y: 1020 }, // seat 2 — bottom-right
  { x: 240,  y: 60 },   // seat 3 — top-left
  { x: 960,  y: 60 },   // seat 4 — top-middle
  { x: 1680, y: 60 },   // seat 5 — top-right
];

/** Maximum wall bounces before a projectile expires */
export const MAX_BOUNCES = 4;

/** Object pool pre-allocation sizes */
export const PROJECTILE_POOL_SIZE = 200;
export const SPACE_OBJECT_POOL_SIZE = 50;

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
export const DRILL_MAX_DURATION_SEC = 10;

/** EMP relay: staggered kill delay per victim (ms) */
export const EMP_CHAIN_DELAY_MS = 100;

/** Orbital laser buff duration (seconds) */
export const ORBITAL_LASER_DURATION_SEC = 10;

/** Orbital laser beam width (pixels) */
export const ORBITAL_LASER_WIDTH = 100;

/** Cosmic vault roulette multiplier tiers */
export const VAULT_MULTIPLIERS = [50, 100, 250, 500, 1000] as const;

/** Hazard payout budget range (multiplied by bet) */
export const HAZARD_BUDGET_MIN = 100;
export const HAZARD_BUDGET_MAX = 400;
