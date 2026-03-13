// ─────────────────────────────────────────────────────────────
// ECS Components — Pure Data, Zero Dependencies
// Per Phaser 4 skill contract: no Phaser imports, no methods.
// ─────────────────────────────────────────────────────────────

import type { SpaceObjectType, TurretPosition, EntityId, IVector2 } from '@space-shooter/shared';

/** 2D position in the game world */
export interface PositionComponent {
  x: number;
  y: number;
}

/** 2D velocity vector */
export interface VelocityComponent {
  vx: number;
  vy: number;
}

// ─── Path Types ───

/** Supported path evaluation strategies */
export type PathType = 'bezier' | 'sine' | 'linear';

/**
 * Deterministic path component (server-only — NEVER synced to clients).
 * Drives time-normalized pathing via PathMath evaluators.
 */
export interface PathComponent {
  /** Curve evaluation strategy */
  readonly pathType: PathType;
  /** Control points for the curve (2=linear, 3=quadratic, 4=cubic Bézier) */
  readonly controlPoints: readonly IVector2[];
  /** Total time in milliseconds to traverse the path */
  readonly duration: number;
  /** Milliseconds elapsed since spawn (advanced by MovementSystem) */
  timeAlive: number;
  /** Formation offset added after curve evaluation (for V-formations, etc.) */
  readonly offset: IVector2;
  /** Sine-wave amplitude (only used when pathType='sine') */
  readonly sineAmplitude: number;
  /** Sine-wave frequency (only used when pathType='sine') */
  readonly sineFrequency: number;
}

// ─── Game Entity Components ───

/** Space object data attached to enemy entities */
export interface SpaceObjectComponent {
  readonly type: SpaceObjectType;
  readonly multiplier: number;
  readonly destroyProbability: number;
  /**
   * Hidden absorbed credits from failed hits (Piñata mechanic).
   * CRITICAL SECURITY: This value is NEVER synced to clients
   * via @colyseus/schema. It exists only in server memory.
   */
  absorbedCredits: number;
  /**
   * First-kill mutex flag. Set to true immediately on successful
   * RNG roll within the same tick's collision resolution loop.
   * Prevents double-payout when multiple projectiles hit
   * the same target in the same tick.
   * Separate from PendingDestroy (which is deferred cleanup).
   */
  isDead: boolean;
}

/** Projectile (laser) data */
export interface ProjectileComponent {
  readonly ownerId: string;
  readonly betAmount: number;
  /** Current travel angle in radians */
  angle: number;
  /** Number of wall bounces remaining before expiry */
  bouncesRemaining: number;
  /** Optional lock-on target entity ID (homing + piercing) */
  lockedTargetId?: number;
}

/** Turret data tied to a player */
export interface TurretComponent {
  readonly playerId: string;
  readonly position: TurretPosition;
}

/** Collision bounds (circle-based for simplicity) */
export interface BoundsComponent {
  readonly radius: number;
}

/** Tag component: marks entity for deferred destruction */
export interface PendingDestroyComponent {
  readonly markedAtTick: number;
}

/** Fire intent: queued player input processed at start of next tick */
export interface FireIntentComponent {
  readonly playerId: string;
  readonly angle: number;
  readonly betAmount: number;
  /** Optional lock-on target entity ID */
  readonly lockedTargetId?: number;
}

// ─── Component Store Types ───

/** A component store is a Map from EntityId to component data */
export type ComponentStore<T> = Map<EntityId, T>;
