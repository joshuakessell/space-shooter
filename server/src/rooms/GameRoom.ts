// ─────────────────────────────────────────────────────────────
// GameRoom — Authoritative Server-Side Game Room
// ─────────────────────────────────────────────────────────────
// SECURITY: Server is the single source of truth. Client is
// a dumb renderer. All economy, RTP, and hit resolution
// happens here. absorbedCredits and hot-seat ID never leave
// server memory.
// CONFIG-DRIVEN: Economy behavior flows through GameBalanceConfig.
// AUDIT: Every collision resolution is available in tick results.
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
import { RoomEconomyManager } from '../services/RoomEconomyManager.js';
import { GAME_BALANCE_CONFIG } from '../config/GameBalanceConfig.js';

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
  private rtpEngine!: RtpEngine;
  private economy!: RoomEconomyManager;

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
    this.economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    this.rtpEngine = new RtpEngine(this.rng, this.economy, GAME_BALANCE_CONFIG);

    // Initialize ECS
    this.world = new World();
    const spawnSystem = new SpawnSystem(this.rng, GAME_BALANCE_CONFIG);
    this.systemRunner = new SystemRunner(
      this.world,
      this.rtpEngine,
      this.wallet,
      this.economy,
      spawnSystem,
    );

    // Start the fixed-timestep simulation loop
    this.simulationInterval = setInterval(() => {
      this.simulateTick();
    }, FIXED_TIMESTEP_MS);

    console.log(`[GameRoom] Room ${this.roomId} created. Tick rate: ${1000 / FIXED_TIMESTEP_MS} Hz`);
    console.log(`[GameRoom] RTP target: ${GAME_BALANCE_CONFIG.targetRtp * 100}%`);
    console.log(`[GameRoom] Max success threshold: ${GAME_BALANCE_CONFIG.maxSuccessThreshold * 100}%`);
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

    // Register player in RTP engine (pity timer tracking)
    this.rtpEngine.addPlayer(client.sessionId);

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

    // IMPORTANT: Do NOT destroy mid-air projectiles.
    // Per fish-table genre rules, bullets fired by a disconnected
    // player continue to simulate and resolve. Payouts credit
    // their server-side wallet even while offline.
    // The wallet survives until the player's seat reservation expires.

    this.playerPositions.delete(client.sessionId);
    this.playerBets.delete(client.sessionId);
    this.rtpEngine.removePlayer(client.sessionId);
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
    this.economy.reset();
    this.rtpEngine.reset();
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
    // Gather active player session IDs for hot-seat rotation
    const activePlayers = Array.from(this.playerPositions.keys());

    // Run the full ECS pipeline
    const result = this.systemRunner.tick(activePlayers);

    // ─── Sync ECS state → Colyseus schema (delta broadcasting) ───
    // NOTE: absorbedCredits and isDead are NEVER synced to clients.

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
    // SECURITY: Only sync type, position, multiplier. Never absorbedCredits.
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
      const targetClient = this.clients.find(c => c.sessionId === rejected.playerId);
      if (targetClient) {
        targetClient.send('shotRejected', { reason: rejected.reason });
      }
    }

    // NOTE: result.collisionResolutions contains every shot's full
    // modifier breakdown for audit logging. In production, pipe this
    // to AuditLogger.logResolutions(result.collisionResolutions).
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
