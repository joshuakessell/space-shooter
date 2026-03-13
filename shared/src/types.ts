// ─────────────────────────────────────────────────────────────
// Core Types — Shared between client and server
// Zero runtime dependencies. Pure TypeScript interfaces/enums.
// ─────────────────────────────────────────────────────────────

/** Six fixed turret positions around the game arena */
export enum TurretPosition {
  TOP_LEFT = 'TOP_LEFT',
  TOP_MIDDLE = 'TOP_MIDDLE',
  TOP_RIGHT = 'TOP_RIGHT',
  BOTTOM_LEFT = 'BOTTOM_LEFT',
  BOTTOM_MIDDLE = 'BOTTOM_MIDDLE',
  BOTTOM_RIGHT = 'BOTTOM_RIGHT',
}

/** Eight space object types with increasing rarity/multiplier */
export enum SpaceObjectType {
  ASTEROID = 'ASTEROID',
  ROCKET = 'ROCKET',
  ALIEN_CRAFT = 'ALIEN_CRAFT',
  SPACE_JELLY = 'SPACE_JELLY',
  ALIEN_CREATURE = 'ALIEN_CREATURE',
  METEOR_SHOWER = 'METEOR_SHOWER',
  NEBULA_BEAST = 'NEBULA_BEAST',
  COSMIC_WHALE = 'COSMIC_WHALE',
}

/** 2D vector */
export interface IVector2 {
  readonly x: number;
  readonly y: number;
}

/** Player state as broadcast to clients */
export interface IPlayerState {
  readonly sessionId: string;
  readonly position: TurretPosition;
  readonly betAmount: number;
  readonly credits: number;
}

/** Projectile (laser) state as broadcast to clients */
export interface IProjectileState {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly ownerId: string;
  readonly betAmount: number;
}

/** Space object state as broadcast to clients */
export interface ISpaceObjectState {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly type: SpaceObjectType;
  readonly active: boolean;
}

/** Turret state */
export interface ITurretState {
  readonly playerId: string;
  readonly position: TurretPosition;
  readonly x: number;
  readonly y: number;
}

/** Entity ID — always a positive integer */
export type EntityId = number;

/** RTP table entry for a single space object type */
export interface IRtpEntry {
  readonly type: SpaceObjectType;
  readonly multiplier: number;
  readonly destroyProbability: number;
}

/** Result of an RNG roll for target destruction */
export interface IDestroyResult {
  readonly destroyed: boolean;
  readonly payout: number;
}

/** Payout event emitted when a target is destroyed */
export interface IPayoutEvent {
  readonly objectId: string;
  readonly playerId: string;
  readonly objectType: SpaceObjectType;
  readonly betAmount: number;
  readonly multiplier: number;
  readonly payout: number;
}
