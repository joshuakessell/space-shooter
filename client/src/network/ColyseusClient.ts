// ─────────────────────────────────────────────────────────────
// Colyseus Client — WebSocket Connection Manager
// Handles room join, state sync, and message sending.
// ─────────────────────────────────────────────────────────────

import { Client, Room } from 'colyseus.js';
import {
  CLIENT_MESSAGES,
  TurretPosition,
} from '@space-shooter/shared';

/** State shapes received from Colyseus auto-sync */
export interface SyncedPlayerState {
  sessionId: string;
  position: string;
  betAmount: number;
  credits: number;
  turretX: number;
  turretY: number;
}

export interface SyncedProjectileState {
  id: string;
  x: number;
  y: number;
  angle: number;
  ownerId: string;
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
}

/** Event callbacks */
export interface GameClientCallbacks {
  onStateChange: (state: GameRoomStateSnapshot) => void;
  onObjectDestroyed: (event: PayoutEventData) => void;
  onShotRejected: (reason: string) => void;
  onJoined: (sessionId: string) => void;
  onError: (error: Error) => void;
}

export interface GameRoomStateSnapshot {
  players: Map<string, SyncedPlayerState>;
  projectiles: Map<string, SyncedProjectileState>;
  spaceObjects: Map<string, SyncedSpaceObjectState>;
  tick: number;
}

/**
 * Thin client wrapper around Colyseus.js SDK.
 * Per architecture: the client is a "dumb renderer" — it only
 * sends inputs and receives authoritative state.
 */
export class GameClient {
  private client: Client;
  private room: Room | null = null;
  private callbacks: GameClientCallbacks;
  public sessionId: string = '';

  constructor(serverUrl: string, callbacks: GameClientCallbacks) {
    this.client = new Client(serverUrl);
    this.callbacks = callbacks;
  }

  /** Connect to the game room */
  async joinRoom(): Promise<void> {
    try {
      this.room = await this.client.joinOrCreate('game_room');
      this.sessionId = this.room.sessionId;
      this.callbacks.onJoined(this.sessionId);

      // Listen for state changes
      this.room.onStateChange((state: Record<string, unknown>) => {
        this.callbacks.onStateChange(this.snapshotState(state));
      });

      // Listen for object destroyed broadcasts
      this.room.onMessage('objectDestroyed', (data: PayoutEventData) => {
        this.callbacks.onObjectDestroyed(data);
      });

      // Listen for shot rejected
      this.room.onMessage('shotRejected', (data: { reason: string }) => {
        this.callbacks.onShotRejected(data.reason);
      });

    } catch (err) {
      this.callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Send fire weapon message */
  fireWeapon(angle: number, betAmount: number): void {
    if (!this.room) return;
    this.room.send(CLIENT_MESSAGES.FIRE_WEAPON, {
      type: CLIENT_MESSAGES.FIRE_WEAPON,
      angle,
      betAmount,
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

  /** Disconnect from the room */
  async leave(): Promise<void> {
    if (this.room) {
      await this.room.leave();
      this.room = null;
    }
  }

  /** Convert Colyseus state to a plain snapshot */
  private snapshotState(state: Record<string, unknown>): GameRoomStateSnapshot {
    const s = state as Record<string, unknown>;
    const players = new Map<string, SyncedPlayerState>();
    const projectiles = new Map<string, SyncedProjectileState>();
    const spaceObjects = new Map<string, SyncedSpaceObjectState>();

    // Convert MapSchema → plain Map
    const playerMap = s['players'] as Map<string, Record<string, unknown>> | undefined;
    if (playerMap) {
      playerMap.forEach((p: Record<string, unknown>, key: string) => {
        players.set(key, {
          sessionId: String(p['sessionId'] ?? ''),
          position: String(p['position'] ?? ''),
          betAmount: Number(p['betAmount'] ?? 1),
          credits: Number(p['credits'] ?? 0),
          turretX: Number(p['turretX'] ?? 0),
          turretY: Number(p['turretY'] ?? 0),
        });
      });
    }

    const projMap = s['projectiles'] as Map<string, Record<string, unknown>> | undefined;
    if (projMap) {
      projMap.forEach((p: Record<string, unknown>, key: string) => {
        projectiles.set(key, {
          id: String(p['id'] ?? ''),
          x: Number(p['x'] ?? 0),
          y: Number(p['y'] ?? 0),
          angle: Number(p['angle'] ?? 0),
          ownerId: String(p['ownerId'] ?? ''),
        });
      });
    }

    const objMap = s['spaceObjects'] as Map<string, Record<string, unknown>> | undefined;
    if (objMap) {
      objMap.forEach((o: Record<string, unknown>, key: string) => {
        spaceObjects.set(key, {
          id: String(o['id'] ?? ''),
          x: Number(o['x'] ?? 0),
          y: Number(o['y'] ?? 0),
          objectType: String(o['objectType'] ?? ''),
          multiplier: Number(o['multiplier'] ?? 1),
        });
      });
    }

    return {
      players,
      projectiles,
      spaceObjects,
      tick: Number(s['tick'] ?? 0),
    };
  }
}
