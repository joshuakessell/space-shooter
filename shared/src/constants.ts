// ─────────────────────────────────────────────────────────────
// Game Constants — Shared between client and server
// ─────────────────────────────────────────────────────────────

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

/** Betting limits */
export const MIN_BET = 1;
export const MAX_BET = 100;
export const DEFAULT_BET = 1;

/** Target Return-to-Player percentage */
export const TARGET_RTP = 0.98;

/** Starting credits for new players */
export const STARTING_CREDITS = 1000;

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

/** Object pool pre-allocation sizes */
export const PROJECTILE_POOL_SIZE = 200;
export const SPACE_OBJECT_POOL_SIZE = 50;

/** Quadtree configuration */
export const QUADTREE_MAX_OBJECTS = 10;
export const QUADTREE_MAX_LEVELS = 5;
