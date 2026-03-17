// ─────────────────────────────────────────────────────────────
// Game Room State Schema — Colyseus State Synchronization
// Uses @colyseus/schema for efficient delta-state broadcasting.
//
// BANDWIDTH: Projectiles are NOT synced via schema. They use
// event-driven "remote_shoot" broadcasts instead. Only space
// objects, players, and tick counter live in state.
// ─────────────────────────────────────────────────────────────

import { Schema, type, MapSchema } from '@colyseus/schema';

/** Player state synchronized to all clients */
export class PlayerSchema extends Schema {
  @type('string') sessionId: string = '';
  @type('string') position: string = ''; // TurretPosition enum value
  @type('number') seatIndex: number = 0; // Seat 0–5
  @type('number') betAmount: number = 1;
  @type('number') credits: number = 1000;
  @type('number') turretX: number = 0;
  @type('number') turretY: number = 0;
  @type('number') turretAngle: number = 0; // Aim angle from pointer_move
  @type('boolean') connected: boolean = true; // False during reconnection window
  @type('string') weaponType: string = 'standard'; // WeaponType
  @type('string') activeBuff: string = 'none'; // BuffType
  @type('number') buffTimeLeft: number = 0;
}

/** Space object state synchronized to all clients */
export class SpaceObjectSchema extends Schema {
  @type('string') id: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('string') objectType: string = ''; // SpaceObjectType enum value
  @type('number') multiplier: number = 1;
  @type('boolean') isCaptured: boolean = false;
}

/** Root game state containing all entity collections */
export class GameRoomState extends Schema {
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type({ map: SpaceObjectSchema }) spaceObjects = new MapSchema<SpaceObjectSchema>();
  @type('number') tick: number = 0;
}
