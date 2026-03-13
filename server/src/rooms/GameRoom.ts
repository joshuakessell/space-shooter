// ─────────────────────────────────────────────────────────────
// GameRoom — Authoritative Server-Side Game Room
// The "brain" of the game: owns the ECS world,
// processes inputs, runs the simulation, and broadcasts state.
// ─────────────────────────────────────────────────────────────

import { Room, Client, type CloseCode } from 'colyseus';
import {
  MAX_PLAYERS,
  FIXED_TIMESTEP_MS,
  STARTING_CREDITS,
  TURRET_POSITIONS,
  TurretPosition,
  DEFAULT_BET,
  MIN_BET,
  MAX_BET,
  CLIENT_MESSAGES,
} from '@space-shooter/shared';
import type { FireWeaponMessage, ChangeBetMessage } from '@space-shooter/shared';

import {
  GameRoomState,
  PlayerSchema,
  ProjectileSchema,
  SpaceObjectSchema,
} from './schema/GameRoomState.js';

import { World } from '../ecs/World.js';
import { SystemRunner } from '../ecs/systems/SystemRunner.js';
import { SpawnSystem } from '../ecs/systems/SpawnSystem.js';
import { CsprngService } from '../services/CsprngService.js';
import { RtpEngine } from '../services/RtpEngine.js';
import { WalletManager } from '../services/WalletManager.js';

/** All available turret positions */
const ALL_POSITIONS: TurretPosition[] = [
  TurretPosition.TOP_LEFT,
  TurretPosition.TOP_MIDDLE,
  TurretPosition.TOP_RIGHT,
  TurretPosition.BOTTOM_LEFT,
  TurretPosition.BOTTOM_MIDDLE,
  TurretPosition.BOTTOM_RIGHT,
];

export class GameRoom extends Room<GameRoomState> {
  maxClients = MAX_PLAYERS;
  state = new GameRoomState();

  // ─── ECS + Services ───
  private world!: World;
  private systemRunner!: SystemRunner;
  private wallet!: WalletManager;
  private rng!: CsprngService;

  // ─── Tick loop ───
  private simulationInterval: ReturnType<typeof setInterval> | null = null;

  // ─── Player tracking ───
  private readonly playerPositions: Map<string, TurretPosition> = new Map();
  private readonly playerBets: Map<string, number> = new Map();

  // ─── Message handlers ───
  messages = {
    [CLIENT_MESSAGES.FIRE_WEAPON]: (client: Client, message: FireWeaponMessage) => {
      this.handleFireWeapon(client, message);
    },
    [CLIENT_MESSAGES.CHANGE_BET]: (client: Client, message: ChangeBetMessage) => {
      this.handleChangeBet(client, message);
    },
  };

  // ─── Lifecycle ───

  onCreate(_options: Record<string, unknown>): void {
    // Initialize services
    this.rng = new CsprngService();
    this.wallet = new WalletManager();

    // Initialize ECS
    this.world = new World();
    const rtpEngine = new RtpEngine(this.rng);
    const spawnSystem = new SpawnSystem(this.rng);
    this.systemRunner = new SystemRunner(this.world, rtpEngine, this.wallet, spawnSystem);

    // Start the fixed-timestep simulation loop
    this.simulationInterval = setInterval(() => {
      this.simulateTick();
    }, FIXED_TIMESTEP_MS);

    console.log(`[GameRoom] Room ${this.roomId} created. Tick rate: ${1000 / FIXED_TIMESTEP_MS} Hz`);
  }

  onJoin(client: Client, _options: Record<string, unknown>): void {
    // Assign turret position
    const position = this.getAvailablePosition();
    if (!position) {
      client.leave(4000); // No positions available
      return;
    }

    this.playerPositions.set(client.sessionId, position);
    this.playerBets.set(client.sessionId, DEFAULT_BET);

    // Initialize wallet
    this.wallet.initPlayer(client.sessionId, STARTING_CREDITS);

    // Create turret entity in ECS
    const turretId = this.world.createEntity();
    const tpos = TURRET_POSITIONS[position];
    this.world.positions.set(turretId, { x: tpos.x, y: tpos.y });
    this.world.turrets.set(turretId, {
      playerId: client.sessionId,
      position,
    });

    // Add to Colyseus state
    const playerSchema = new PlayerSchema();
    playerSchema.sessionId = client.sessionId;
    playerSchema.position = position;
    playerSchema.betAmount = DEFAULT_BET;
    playerSchema.credits = STARTING_CREDITS;
    playerSchema.turretX = tpos.x;
    playerSchema.turretY = tpos.y;
    this.state.players.set(client.sessionId, playerSchema);

    console.log(`[GameRoom] Player ${client.sessionId} joined at ${position}`);
  }

  onLeave(client: Client, _code: CloseCode): void {
    const position = this.playerPositions.get(client.sessionId);

    // Clean up turret entity
    for (const [entityId, turret] of this.world.turrets) {
      if (turret.playerId === client.sessionId) {
        this.world.destroyEntity(entityId);
        break;
      }
    }

    // Clean up projectiles owned by this player
    for (const [entityId, proj] of this.world.projectiles) {
      if (proj.ownerId === client.sessionId) {
        this.world.pendingDestroy.set(entityId, { markedAtTick: this.world.currentTick });
      }
    }

    this.playerPositions.delete(client.sessionId);
    this.playerBets.delete(client.sessionId);
    this.wallet.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);

    console.log(`[GameRoom] Player ${client.sessionId} left (was at ${position})`);
  }

  onDispose(): void {
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
    this.world.clear();
    this.wallet.clear();
    console.log(`[GameRoom] Room ${this.roomId} disposed.`);
  }

  // ─── Message Handlers ───

  private handleFireWeapon(client: Client, message: FireWeaponMessage): void {
    const betAmount = this.playerBets.get(client.sessionId) ?? DEFAULT_BET;

    // Queue a fire intent for the next tick (never mutate ECS mid-tick)
    const intentId = this.world.createEntity();
    this.world.fireIntents.set(intentId, {
      playerId: client.sessionId,
      angle: message.angle,
      betAmount,
    });
  }

  private handleChangeBet(client: Client, message: ChangeBetMessage): void {
    const amount = Math.max(MIN_BET, Math.min(MAX_BET, Math.floor(message.amount)));
    this.playerBets.set(client.sessionId, amount);

    // Update Colyseus state for UI sync
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.betAmount = amount;
    }
  }

  // ─── Simulation ───

  private simulateTick(): void {
    // Run the full ECS pipeline
    const result = this.systemRunner.tick();

    // ─── Sync ECS state → Colyseus schema (delta broadcasting) ───

    // Update projectiles
    this.state.projectiles.clear();
    for (const [entityId, proj] of this.world.projectiles) {
      const pos = this.world.positions.get(entityId);
      if (!pos) continue;

      const schema = new ProjectileSchema();
      schema.id = String(entityId);
      schema.x = Math.round(pos.x * 10) / 10; // 0.1px precision
      schema.y = Math.round(pos.y * 10) / 10;
      schema.angle = proj.angle;
      schema.ownerId = proj.ownerId;
      this.state.projectiles.set(String(entityId), schema);
    }

    // Update space objects
    this.state.spaceObjects.clear();
    for (const [entityId, obj] of this.world.spaceObjects) {
      const pos = this.world.positions.get(entityId);
      if (!pos) continue;

      const schema = new SpaceObjectSchema();
      schema.id = String(entityId);
      schema.x = Math.round(pos.x * 10) / 10;
      schema.y = Math.round(pos.y * 10) / 10;
      schema.objectType = obj.type;
      schema.multiplier = obj.multiplier;
      this.state.spaceObjects.set(String(entityId), schema);
    }

    // Update player credits
    for (const [playerId, player] of this.state.players) {
      player.credits = this.wallet.getBalance(playerId);
    }

    // Update tick counter
    this.state.tick = this.world.currentTick;

    // ─── Broadcast events via messages ───

    // Payouts (object destroyed events)
    for (const payout of result.payouts) {
      this.broadcast('objectDestroyed', {
        objectId: payout.objectId,
        playerId: payout.playerId,
        objectType: payout.objectType,
        payout: payout.payout,
        multiplier: payout.multiplier,
      });
    }

    // Rejected shots
    for (const rejected of result.rejectedShots) {
      // Send only to the specific player
      const targetClient = this.clients.find(c => c.sessionId === rejected.playerId);
      if (targetClient) {
        targetClient.send('shotRejected', { reason: rejected.reason });
      }
    }
  }

  // ─── Helpers ───

  private getAvailablePosition(): TurretPosition | null {
    const taken = new Set(this.playerPositions.values());
    for (const pos of ALL_POSITIONS) {
      if (!taken.has(pos)) return pos;
    }
    return null;
  }
}
