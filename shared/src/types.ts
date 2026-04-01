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

/** Space object types with increasing rarity/multiplier */
export enum SpaceObjectType {
  ASTEROID = 'ASTEROID',
  ROCKET = 'ROCKET',
  ALIEN_CRAFT = 'ALIEN_CRAFT',
  SPACE_JELLY = 'SPACE_JELLY',
  ALIEN_CREATURE = 'ALIEN_CREATURE',
  METEOR_SHOWER = 'METEOR_SHOWER',
  NEBULA_BEAST = 'NEBULA_BEAST',
  COSMIC_WHALE = 'COSMIC_WHALE',
  SUPERNOVA_BOMB = 'SUPERNOVA_BOMB',
  // Feature targets (spawn hazards on kill)
  BLACKHOLE_GEN = 'BLACKHOLE_GEN',
  QUANTUM_DRILL = 'QUANTUM_DRILL',
  EMP_RELAY = 'EMP_RELAY',
  ORBITAL_CORE = 'ORBITAL_CORE',
  COSMIC_VAULT = 'COSMIC_VAULT',
}

/** Weapon types — determines projectile behavior and cost scaling */
export type WeaponType = 'standard' | 'spread' | 'lightning';

/** Valid weapon types for runtime validation */
export const WEAPON_TYPES: readonly WeaponType[] = ['standard', 'spread', 'lightning'] as const;

/** Hazard types spawned by feature targets */
export type HazardType = 'blackhole' | 'drill' | 'emp' | 'orbital_laser';

/** Player buff types from feature targets */
export type BuffType = 'orbital_laser' | 'paused' | 'none';

/** Feature target types — hazards CANNOT destroy these (infinite loop prevention) */
export const FEATURE_TARGET_TYPES: ReadonlySet<SpaceObjectType> = new Set([
  SpaceObjectType.BLACKHOLE_GEN,
  SpaceObjectType.QUANTUM_DRILL,
  SpaceObjectType.EMP_RELAY,
  SpaceObjectType.ORBITAL_CORE,
  SpaceObjectType.COSMIC_VAULT,
  SpaceObjectType.SUPERNOVA_BOMB,
]);

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

/** Entity ID — always a positive integer. Semantic alias kept for readability. */
export type EntityId = number; // NOSONAR — semantic alias used across 10+ files

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
