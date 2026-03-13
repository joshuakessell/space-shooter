// ─────────────────────────────────────────────────────────────
// Network Message Schemas — Client ↔ Server DTOs
// These define the WebSocket message contracts.
// ─────────────────────────────────────────────────────────────

import type { TurretPosition, SpaceObjectType, IVector2 } from './types.js';

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

/** Union type for all client → server messages */
export type ClientMessage =
  | FireWeaponMessage
  | ChangeBetMessage
  | SelectPositionMessage
  | PointerMoveMessage;

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
  | PlayerLeftMessage;

// ─── Message Type Constants ───

export const CLIENT_MESSAGES = {
  FIRE_WEAPON: 'fireWeapon',
  CHANGE_BET: 'changeBet',
  SELECT_POSITION: 'selectPosition',
  POINTER_MOVE: 'pointerMove',
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
} as const;
