// ─────────────────────────────────────────────────────────────
// Network Message Schemas — Client ↔ Server DTOs
// These define the WebSocket message contracts.
// ─────────────────────────────────────────────────────────────

import type { TurretPosition, SpaceObjectType, IVector2, WeaponType, HazardType } from './types.js';

// ─── Client → Server Messages ───

/** Player fires a weapon from their turret */
export interface FireWeaponMessage {
  readonly type: 'fireWeapon';
  readonly angle: number;                // radians
  readonly betAmount: number;            // credits wagered on this shot
  readonly lockedTargetId?: string;      // optional lock-on target entity ID
}

/** Player changes their bet amount */
export interface ChangeBetMessage {
  readonly type: 'changeBet';
  readonly amount: number;      // new bet value
}

/** Player selects a turret position (on join) */
export interface SelectPositionMessage {
  readonly type: 'selectPosition';
  readonly position: TurretPosition;
}

/** Player aim angle update (throttled) */
export interface PointerMoveMessage {
  readonly type: 'pointerMove';
  readonly angle: number; // radians
}

/** Player switches active weapon type */
export interface SwitchWeaponMessage {
  readonly type: 'switchWeapon';
  readonly weaponType: WeaponType;
}

/** Union type for all client → server messages */
export type ClientMessage =
  | FireWeaponMessage
  | ChangeBetMessage
  | SelectPositionMessage
  | PointerMoveMessage
  | SwitchWeaponMessage;

// ─── Server → Client Messages ───

/** A space object was destroyed */
export interface ObjectDestroyedMessage {
  readonly type: 'objectDestroyed';
  readonly objectId: string;
  readonly playerId: string;
  readonly objectType: SpaceObjectType;
  readonly payout: number;
  readonly multiplier: number;
}

/** Player's credit balance updated */
export interface CreditUpdateMessage {
  readonly type: 'creditUpdate';
  readonly playerId: string;
  readonly balance: number;
}

/** A new space object has been spawned */
export interface SpawnObjectMessage {
  readonly type: 'spawnObject';
  readonly objectId: string;
  readonly objectType: SpaceObjectType;
  readonly path: readonly IVector2[];
  readonly speed: number;
}

/** A projectile was spawned (for other players' shots) */
export interface ProjectileSpawnedMessage {
  readonly type: 'projectileSpawned';
  readonly projectileId: string;
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

/** A projectile was removed (hit or went offscreen) */
export interface ProjectileRemovedMessage {
  readonly type: 'projectileRemoved';
  readonly projectileId: string;
}

/** Shot was rejected (insufficient funds, too many active projectiles, etc.) */
export interface ShotRejectedMessage {
  readonly type: 'shotRejected';
  readonly reason: string;
}

/** Player has insufficient funds to fire */
export interface OutOfFundsMessage {
  readonly type: 'outOfFunds';
  readonly currentCredits: number;
  readonly requiredBet: number;
}

/** Remote player fired a weapon (event-only, no state sync) */
export interface RemoteShootMessage {
  readonly type: 'remoteShoot';
  readonly sessionId: string;
  readonly seatIndex: number;
  readonly angle: number;
  readonly lockedTargetId?: string;
}

/** Player joined the game */
export interface PlayerJoinedMessage {
  readonly type: 'playerJoined';
  readonly playerId: string;
  readonly position: TurretPosition;
}

/** Player left the game */
export interface PlayerLeftMessage {
  readonly type: 'playerLeft';
  readonly playerId: string;
}

/** AoE blast destroyed multiple targets (Supernova Bomb) */
export interface AoeDestroyedMessage {
  readonly type: 'aoeDestroyed';
  readonly x: number;
  readonly y: number;
  readonly totalPayout: number;
  readonly playerId: string;
  readonly seatIndex: number;
  readonly destroyedTargetIds: readonly string[];
}

/** Chain lightning hit a target (for frontend trail rendering) */
export interface ChainHitMessage {
  readonly type: 'chainHit';
  readonly projectileOwnerId: string;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly targetId: string;
  readonly payout: number;
}

// ─── Feature Target Messages ───

/** A feature target was killed, spawning a hazard or instant effect */
export interface FeatureActivatedMessage {
  readonly type: 'featureActivated';
  readonly hazardType: HazardType | 'vault';
  readonly x: number;
  readonly y: number;
  readonly playerId: string;
  readonly seatIndex: number;
  readonly budget?: number;
}

/** Black hole tick: targets being pulled in */
export interface FeatureBlackholeTickMessage {
  readonly type: 'featureBlackholeTick';
  readonly hazardId: string;
  readonly capturedTargetIds: readonly string[];
  readonly x: number;
  readonly y: number;
}

/** Quantum drill bounced off a wall */
export interface FeatureDrillBounceMessage {
  readonly type: 'featureDrillBounce';
  readonly hazardId: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

/** EMP relay chain: instant list of victims */
export interface FeatureEmpChainMessage {
  readonly type: 'featureEmpChain';
  readonly victimIds: readonly string[];
  readonly sourceX: number;
  readonly sourceY: number;
  readonly playerId: string;
}

/** Orbital laser buff toggled on/off */
export interface FeatureOrbitalLaserMessage {
  readonly type: 'featureOrbitalLaser';
  readonly playerId: string;
  readonly seatIndex: number;
  readonly active: boolean;
  readonly betAmount: number;
}

/** Cosmic vault roulette result */
export interface FeatureVaultRouletteMessage {
  readonly type: 'featureVaultRoulette';
  readonly playerId: string;
  readonly multiplier: number;
  readonly payout: number;
}

/** A hazard has ended (budget exhausted or timer expired) */
export interface FeatureEndedMessage {
  readonly type: 'featureEnded';
  readonly hazardId: string;
  readonly totalPayout: number;
  readonly playerId: string;
}

/** Union type for all server → client messages */
export type ServerMessage =
  | ObjectDestroyedMessage
  | CreditUpdateMessage
  | SpawnObjectMessage
  | ProjectileSpawnedMessage
  | ProjectileRemovedMessage
  | ShotRejectedMessage
  | OutOfFundsMessage
  | RemoteShootMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | AoeDestroyedMessage
  | ChainHitMessage
  | FeatureActivatedMessage
  | FeatureBlackholeTickMessage
  | FeatureDrillBounceMessage
  | FeatureEmpChainMessage
  | FeatureOrbitalLaserMessage
  | FeatureVaultRouletteMessage
  | FeatureEndedMessage;

// ─── Message Type Constants ───

export const CLIENT_MESSAGES = {
  FIRE_WEAPON: 'fireWeapon',
  CHANGE_BET: 'changeBet',
  SELECT_POSITION: 'selectPosition',
  POINTER_MOVE: 'pointerMove',
  SWITCH_WEAPON: 'switchWeapon',
  ADMIN_REFILL: 'adminRefill', // Backdoor testing message
} as const;

export const SERVER_MESSAGES = {
  OBJECT_DESTROYED: 'objectDestroyed',
  CREDIT_UPDATE: 'creditUpdate',
  SPAWN_OBJECT: 'spawnObject',
  PROJECTILE_SPAWNED: 'projectileSpawned',
  PROJECTILE_REMOVED: 'projectileRemoved',
  SHOT_REJECTED: 'shotRejected',
  OUT_OF_FUNDS: 'outOfFunds',
  REMOTE_SHOOT: 'remoteShoot',
  PLAYER_JOINED: 'playerJoined',
  PLAYER_LEFT: 'playerLeft',
  AOE_DESTROYED: 'aoeDestroyed',
  CHAIN_HIT: 'chainHit',
  FEATURE_ACTIVATED: 'featureActivated',
  FEATURE_BLACKHOLE_TICK: 'featureBlackholeTick',
  FEATURE_DRILL_BOUNCE: 'featureDrillBounce',
  FEATURE_EMP_CHAIN: 'featureEmpChain',
  FEATURE_ORBITAL_LASER: 'featureOrbitalLaser',
  FEATURE_VAULT_ROULETTE: 'featureVaultRoulette',
  FEATURE_ENDED: 'featureEnded',
} as const;
