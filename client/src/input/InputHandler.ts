// ─────────────────────────────────────────────────────────────
// Input Handler — Captures User Input and Creates Intents
// Per ECS skill contract: raw input → Intent Components.
//
// LOCK-ON: Right-click on a target to lock. Left-click empty
// space to clear lock. While locked, auto-fire aims at target.
// ─────────────────────────────────────────────────────────────

import type { SyncedSpaceObjectState } from '../network/ColyseusClient.js';
import type { WeaponType } from '@space-shooter/shared';

export interface FireIntent {
  angle: number;
  lockedTargetId?: string;
}

export interface InputState {
  mouseX: number;
  mouseY: number;
  mouseDown: boolean;
  justPressed: boolean;
}

/** Render radius per object type — mirrors GameRenderer for hit detection */
const LOCK_ON_HIT_RADII: Record<string, number> = {
  ASTEROID: 30,
  ALIEN_CRAFT: 25,
  ROCKET: 20,
  NEBULA_BEAST: 50,
  COSMIC_WHALE: 55,
  SUPERNOVA_BOMB: 48,
};

/**
 * Captures mouse/pointer input for aiming, firing, and lock-on targeting.
 * Translates raw DOM events into game intents.
 */
export class InputHandler {
  private readonly state: InputState = {
    mouseX: 0,
    mouseY: 0,
    mouseDown: false,
    justPressed: false,
  };
  private previousMouseDown = false;
  private readonly canvas: HTMLElement;

  // Lock-on state
  private lockedTargetId: string | null = null;
  private lockedTargetPos: { x: number; y: number } | null = null;

  // Weapon switching
  private activeWeaponType: WeaponType = 'standard';
  public onWeaponChange: ((weaponType: WeaponType) => void) | null = null;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) throw new Error(`Container '${containerId}' not found`);
    this.canvas = container;
    this.setupListeners();
    this.setupWeaponKeys();
  }

  /** Convert client pixel coordinates to game world coordinates (1920×1080) */
  private clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * 1920,
      y: ((clientY - rect.top) / rect.height) * 1080,
    };
  }

  private setupListeners(): void {
    this.canvas.addEventListener('mousemove', (e: MouseEvent) => {
      const { x, y } = this.clientToWorld(e.clientX, e.clientY);
      this.state.mouseX = x;
      this.state.mouseY = y;
    });

    this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 0) {
        // Left click
        this.state.mouseDown = true;
      }
    });

    this.canvas.addEventListener('mouseup', (e: MouseEvent) => {
      if (e.button === 0) {
        this.state.mouseDown = false;
      }
    });

    // Right-click for lock-on (prevent context menu)
    this.canvas.addEventListener('contextmenu', (e: Event) => {
      e.preventDefault();
    });
    this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 2) {
        const { x, y } = this.clientToWorld(e.clientX, e.clientY);
        this.state.mouseX = x;
        this.state.mouseY = y;
        this.pendingRightClick = true;
      }
    });

    // Touch support
    this.canvas.addEventListener('touchstart', (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      const { x, y } = this.clientToWorld(touch.clientX, touch.clientY);
      this.state.mouseX = x;
      this.state.mouseY = y;
      this.state.mouseDown = true;
    }, { passive: false });

    this.canvas.addEventListener('touchend', () => {
      this.state.mouseDown = false;
    });

    this.canvas.addEventListener('touchmove', (e: TouchEvent) => {
      const touch = e.touches[0];
      const { x, y } = this.clientToWorld(touch.clientX, touch.clientY);
      this.state.mouseX = x;
      this.state.mouseY = y;
    });
  }

  /** Pending right-click flag for lock-on targeting */
  private pendingRightClick = false;

  /** Call once per frame to update justPressed */
  update(): void {
    this.state.justPressed = this.state.mouseDown && !this.previousMouseDown;
    this.previousMouseDown = this.state.mouseDown;
  }

  /**
   * Try to lock onto a target under the mouse cursor.
   * Call this after update() with the current space objects.
   */
  tryLockOn(spaceObjects: Map<string, SyncedSpaceObjectState>): void {
    if (!this.pendingRightClick) return;
    this.pendingRightClick = false;

    // Hit-test against all space objects
    for (const [id, obj] of spaceObjects) {
      const hitRadius = LOCK_ON_HIT_RADII[obj.objectType] ?? 30;
      const dx = this.state.mouseX - obj.x;
      const dy = this.state.mouseY - obj.y;

      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        this.lockedTargetId = id;
        this.lockedTargetPos = { x: obj.x, y: obj.y };
        return;
      }
    }

    // Clicked empty space — clear lock
    this.clearLock();
  }

  /**
   * Update locked target position from latest server state.
   * Must be called each frame to keep reticle tracking.
   */
  updateLockedTarget(spaceObjects: Map<string, SyncedSpaceObjectState>): void {
    if (!this.lockedTargetId) return;

    const target = spaceObjects.get(this.lockedTargetId);
    if (!target) {
      // Target died or left screen
      this.clearLock();
      return;
    }

    this.lockedTargetPos = { x: target.x, y: target.y };
  }

  /** Clear the lock-on */
  clearLock(): void {
    this.lockedTargetId = null;
    this.lockedTargetPos = null;
  }

  /** Get the fire intent if the player just clicked */
  getFireIntent(turretX: number, turretY: number): FireIntent | null {
    if (!this.state.justPressed) return null;

    const result: FireIntent = { angle: this.getAimAngle(turretX, turretY) };
    if (this.lockedTargetId) {
      result.lockedTargetId = this.lockedTargetId;
    }
    return result;
  }

  /** Get the current aim angle from turret position to target (or mouse) */
  getAimAngle(turretX: number, turretY: number): number {
    // If locked, aim at locked target
    if (this.lockedTargetPos) {
      const dx = this.lockedTargetPos.x - turretX;
      const dy = this.lockedTargetPos.y - turretY;
      return Math.atan2(dy, dx);
    }

    const dx = this.state.mouseX - turretX;
    const dy = this.state.mouseY - turretY;
    return Math.atan2(dy, dx);
  }

  /** Get locked target info for rendering reticle */
  getLockedTarget(): { id: string; x: number; y: number } | null {
    if (!this.lockedTargetId || !this.lockedTargetPos) return null;
    return { id: this.lockedTargetId, x: this.lockedTargetPos.x, y: this.lockedTargetPos.y };
  }

  /** Get raw state for debugging */
  getState(): Readonly<InputState> {
    return this.state;
  }

  /** Check if mouse/touch is currently held down (for auto-fire) */
  isMouseDown(): boolean {
    return this.state.mouseDown;
  }

  /** Set up weapon switching keyboard shortcuts: Q=standard, W=spread, E=lightning */
  private setupWeaponKeys(): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      let newWeapon: WeaponType | null = null;
      switch (e.key.toLowerCase()) {
        case 'q': newWeapon = 'standard'; break;
        case 'w': newWeapon = 'spread'; break;
        case 'e': newWeapon = 'lightning'; break;
      }
      if (newWeapon && newWeapon !== this.activeWeaponType) {
        this.activeWeaponType = newWeapon;
        this.onWeaponChange?.(newWeapon);
      }
    });
  }

  /** Get the currently selected weapon type */
  getWeaponType(): WeaponType {
    return this.activeWeaponType;
  }

  /** Force update weapon type (called when HUD UI is clicked) */
  setWeaponType(weapon: WeaponType): void {
    this.activeWeaponType = weapon;
  }

  destroy(): void {
    // Listeners are gc'd with the element
  }
}
