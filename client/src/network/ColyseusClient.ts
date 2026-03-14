// ─────────────────────────────────────────────────────────────
// Colyseus Client — Thin Network Adapter
// Per architecture: the client is a "dumb renderer" — it only
// sends inputs and receives authoritative state.
//
// Phase 4: Projectiles are NOT synced via state. They use
// event-driven "remote_shoot" broadcasts. Local player uses
// client-side prediction; remote players get ghost events.
// ─────────────────────────────────────────────────────────────

import { Client, Room } from 'colyseus.js';
import {
  CLIENT_MESSAGES,
  SERVER_MESSAGES,
} from '@space-shooter/shared';

/** State shapes received from Colyseus auto-sync */
export interface SyncedPlayerState {
  sessionId: string;
  position: string;
  seatIndex: number;
  betAmount: number;
  credits: number;
  turretX: number;
  turretY: number;
  turretAngle: number;
  weaponType: string;
}

export interface SyncedSpaceObjectState {
  id: string;
  x: number;
  y: number;
  objectType: string;
  multiplier: number;
}

/** Payout event from server broadcast */
export interface PayoutEventData {
  objectId: string;
  playerId: string;
  objectType: string;
  payout: number;
  multiplier: number;
  seatIndex: number;
}

/** AoE blast event from server */
export interface AoeEventData {
  x: number;
  y: number;
  totalPayout: number;
  playerId: string;
  seatIndex: number;
  destroyedTargetIds: string[];
}

/** Chain hit event from server */
export interface ChainHitEventData {
  projectileOwnerId: string;
  seatIndex: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  targetId: string;
  payout: number;
}

/** Event callbacks */
export interface GameClientCallbacks {
  onStateChange: (state: GameRoomStateSnapshot) => void;
  onObjectDestroyed: (event: PayoutEventData) => void;
  onShotRejected: (reason: string) => void;
  onOutOfFunds: (currentCredits: number, requiredBet: number) => void;
  onRemoteShoot: (seatIndex: number, angle: number, lockedTargetId?: string) => void;
  onJoined: (sessionId: string) => void;
  onError: (error: Error) => void;
  onAoeDestroyed?: (event: AoeEventData) => void;
  onChainHit?: (event: ChainHitEventData) => void;
}

export interface GameRoomStateSnapshot {
  players: Map<string, SyncedPlayerState>;
  spaceObjects: Map<string, SyncedSpaceObjectState>;
  tick: number;
}

/**
 * Thin client wrapper around Colyseus.js SDK.
 * Per architecture: the client is a "dumb renderer" — it only
 * sends inputs and receives authoritative state.
 */
export class GameClient {
  private readonly client: Client;
  private room: Room | null = null;
  private readonly callbacks: GameClientCallbacks;
  public sessionId: string = '';

  constructor(serverUrl: string, callbacks: GameClientCallbacks) {
    this.client = new Client(serverUrl);
    this.callbacks = callbacks;
  }

  /** Connect to game room */
  async joinRoom(): Promise<void> {
    try {
      this.room = await this.client.joinOrCreate('game_room');
      this.sessionId = this.room.sessionId;
      this.callbacks.onJoined(this.sessionId);

      // Listen for state changes
      this.room.onStateChange((state) => {
        const snapshot = this.snapshotState(state as unknown as Record<string, unknown>);
        this.callbacks.onStateChange(snapshot);
      });

      // Listen for object destroyed
      this.room.onMessage('objectDestroyed', (data: PayoutEventData) => {
        this.callbacks.onObjectDestroyed(data);
      });

      // Listen for shot rejected
      this.room.onMessage('shotRejected', (data: { reason: string }) => {
        this.callbacks.onShotRejected(data.reason);
      });

      // Listen for out of funds
      this.room.onMessage('outOfFunds', (data: { currentCredits: number; requiredBet: number }) => {
        this.callbacks.onOutOfFunds(data.currentCredits, data.requiredBet);
      });

      // Listen for remote shoot (ghost projectile events)
      this.room.onMessage(SERVER_MESSAGES.REMOTE_SHOOT, (data: { seatIndex: number; angle: number; lockedTargetId?: string }) => {
        this.callbacks.onRemoteShoot(data.seatIndex, data.angle, data.lockedTargetId);
      });

      // Listen for AoE destroyed events
      this.room.onMessage(SERVER_MESSAGES.AOE_DESTROYED, (data: AoeEventData) => {
        this.callbacks.onAoeDestroyed?.(data);
      });

      // Listen for chain hit events
      this.room.onMessage(SERVER_MESSAGES.CHAIN_HIT, (data: ChainHitEventData) => {
        this.callbacks.onChainHit?.(data);
      });

    } catch (err) {
      this.callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Send fire weapon message */
  fireWeapon(angle: number, betAmount: number, lockedTargetId?: string): void {
    if (!this.room) return;
    const msg: Record<string, unknown> = {
      type: CLIENT_MESSAGES.FIRE_WEAPON,
      angle,
      betAmount,
    };
    if (lockedTargetId) msg['lockedTargetId'] = lockedTargetId;
    this.room.send(CLIENT_MESSAGES.FIRE_WEAPON, msg);
  }

  /** Send pointer move (aim angle) for remote turret sync */
  sendPointerMove(angle: number): void {
    if (!this.room) return;
    this.room.send(CLIENT_MESSAGES.POINTER_MOVE, {
      type: CLIENT_MESSAGES.POINTER_MOVE,
      angle,
    });
  }

  /** Send change bet message */
  changeBet(amount: number): void {
    if (!this.room) return;
    this.room.send(CLIENT_MESSAGES.CHANGE_BET, {
      type: CLIENT_MESSAGES.CHANGE_BET,
      amount,
    });
  }

  /** Send switch weapon message */
  switchWeapon(weaponType: string): void {
    if (!this.room) return;
    this.room.send(CLIENT_MESSAGES.SWITCH_WEAPON, {
      type: CLIENT_MESSAGES.SWITCH_WEAPON,
      weaponType,
    });
  }

  /** Disconnect from the room */
  async leave(): Promise<void> {
    if (this.room) {
      await this.room.leave();
      this.room = null;
    }
  }

  /** Convert Colyseus state to a plain snapshot */
  private snapshotState(state: Record<string, unknown>): GameRoomStateSnapshot {
    const s = state;
    const players = new Map<string, SyncedPlayerState>();
    const spaceObjects = new Map<string, SyncedSpaceObjectState>();

    // Convert MapSchema → plain Map
    const playerMap = s['players'] as Map<string, Record<string, unknown>> | undefined;
    if (playerMap) {
      playerMap.forEach((p: Record<string, unknown>, key: string) => {
        players.set(key, {
          sessionId: typeof p['sessionId'] === 'string' ? p['sessionId'] : '',
          position: typeof p['position'] === 'string' ? p['position'] : '',
          seatIndex: Number(p['seatIndex'] ?? 0),
          betAmount: Number(p['betAmount'] ?? 1),
          credits: Number(p['credits'] ?? 0),
          turretX: Number(p['turretX'] ?? 0),
          turretY: Number(p['turretY'] ?? 0),
          turretAngle: Number(p['turretAngle'] ?? 0),
          weaponType: typeof p['weaponType'] === 'string' ? p['weaponType'] : 'standard',
        });
      });
    }

    const objMap = s['spaceObjects'] as Map<string, Record<string, unknown>> | undefined;
    if (objMap) {
      objMap.forEach((o: Record<string, unknown>, key: string) => {
        spaceObjects.set(key, {
          id: typeof o['id'] === 'string' ? o['id'] : '',
          x: Number(o['x'] ?? 0),
          y: Number(o['y'] ?? 0),
          objectType: typeof o['objectType'] === 'string' ? o['objectType'] : '',
          multiplier: Number(o['multiplier'] ?? 1),
        });
      });
    }

    return {
      players,
      spaceObjects,
      tick: Number(s['tick'] ?? 0),
    };
  }
}
