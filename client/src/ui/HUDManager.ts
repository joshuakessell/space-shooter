// ─────────────────────────────────────────────────────────────
// HUD Manager — DOM-Based Casino UI Overlay
// ─────────────────────────────────────────────────────────────
// Absolute-positioned HTML elements over the canvas.
// CSS transitions handle the slot-roll counting effect.
//
// CONSTRAINT: If multiple wins happen rapidly, the tween
// updates its destination dynamically without resetting.
// ─────────────────────────────────────────────────────────────

import { BET_TIERS, DEFAULT_BET } from '@space-shooter/shared';
import type { WeaponType } from '@space-shooter/shared';

/** How long the credit counter roll animation lasts (ms) */
const ROLL_DURATION_MS = 600;
const ROLL_STEP_INTERVAL_MS = 16; // ~60fps

/**
 * Casino-style HUD overlay rendered as DOM elements positioned
 * over the game canvas. Manages credit display (with slot-roll
 * counting animation), bet tier selector, and visual warnings.
 */
export class HUDManager {
  private readonly container: HTMLElement;
  private readonly creditsEl: HTMLElement;
  private readonly betEl: HTMLElement;
  private readonly betUpBtn: HTMLElement;
  private readonly betDownBtn: HTMLElement;
  private readonly flashOverlay: HTMLElement;

  private displayedCredits = 0;
  private targetCredits = 0;
  private rollTimer: ReturnType<typeof setInterval> | null = null;
  private rollStartTime = 0;
  private rollStartValue = 0;

  private currentTierIndex = 0;
  private currentWeapon: WeaponType = 'standard';
  private readonly weaponBtns: Record<string, HTMLElement> = {};

  /** Callback fired when player changes bet tier */
  public onBetChange: ((newBet: number) => void) | null = null;
  /** Callback fired when player changes weapon via HUD */
  public onWeaponChange: ((weaponRawType: WeaponType) => void) | null = null;

  constructor(containerId: string) {
    const parent = document.getElementById(containerId);
    if (!parent) throw new Error(`HUD container '${containerId}' not found`);

    // Create wrapper
    this.container = document.createElement('div');
    this.container.id = 'hud-overlay';
    this.container.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none; z-index: 10;
      font-family: 'Inter', 'Segoe UI', sans-serif;
    `;
    parent.style.position = 'relative';
    parent.appendChild(this.container);

    // ─── Credits Panel (top-left) ───
    const creditsPanel = this.createPanel('hud-credits-panel', 'top: 16px; left: 16px;');
    const creditsLabel = document.createElement('div');
    creditsLabel.textContent = 'CREDITS';
    creditsLabel.style.cssText = 'font-size: 11px; letter-spacing: 2px; color: #aaa; margin-bottom: 4px;';
    this.creditsEl = document.createElement('div');
    this.creditsEl.id = 'hud-credits-value';
    this.creditsEl.style.cssText = 'font-size: 28px; font-weight: 700; color: #FFD700; text-shadow: 0 0 12px rgba(255,215,0,0.5);';
    this.creditsEl.textContent = '0';
    creditsPanel.appendChild(creditsLabel);
    creditsPanel.appendChild(this.creditsEl);
    this.container.appendChild(creditsPanel);

    // ─── Bet Panel (top-right) ───
    const betPanel = this.createPanel('hud-bet-panel', 'top: 16px; right: 16px;');
    const betLabel = document.createElement('div');
    betLabel.textContent = 'BET';
    betLabel.style.cssText = 'font-size: 11px; letter-spacing: 2px; color: #aaa; margin-bottom: 4px; text-align: center;';

    const betRow = document.createElement('div');
    betRow.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    this.betDownBtn = this.createBetButton('−', () => this.cycleBet(-1));
    this.betEl = document.createElement('div');
    this.betEl.id = 'hud-bet-value';
    this.betEl.style.cssText = 'font-size: 24px; font-weight: 700; color: #00ffcc; min-width: 60px; text-align: center;';
    this.betEl.textContent = String(DEFAULT_BET);
    this.betUpBtn = this.createBetButton('+', () => this.cycleBet(1));

    betRow.appendChild(this.betDownBtn);
    betRow.appendChild(this.betEl);
    betRow.appendChild(this.betUpBtn);
    betPanel.appendChild(betLabel);
    betPanel.appendChild(betRow);
    this.container.appendChild(betPanel);

    // ─── Weapon Panel (bottom-right) ───
    const weaponPanel = this.createPanel('hud-weapon-panel', 'bottom: 24px; right: 24px; pointer-events: auto;');
    weaponPanel.style.display = 'flex';
    weaponPanel.style.gap = '8px';

    this.weaponBtns['standard'] = this.createWeaponButton('⚡', 'standard', () => this.selectWeapon('standard'));
    this.weaponBtns['spread'] = this.createWeaponButton('💢', 'spread', () => this.selectWeapon('spread'));
    this.weaponBtns['lightning'] = this.createWeaponButton('🌩️', 'lightning', () => this.selectWeapon('lightning'));

    weaponPanel.appendChild(this.weaponBtns['standard']);
    weaponPanel.appendChild(this.weaponBtns['spread']);
    weaponPanel.appendChild(this.weaponBtns['lightning']);
    this.container.appendChild(weaponPanel);

    // Initialize weapon selection visual
    this.selectWeapon('standard', true);

    // ─── Flash Overlay (insufficient funds) ───
    this.flashOverlay = document.createElement('div');
    this.flashOverlay.id = 'hud-flash';
    this.flashOverlay.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      background: radial-gradient(circle, rgba(255,0,0,0.3) 0%, transparent 70%);
      opacity: 0; transition: opacity 0.15s ease-out;
      pointer-events: none;
    `;
    this.container.appendChild(this.flashOverlay);

    // ─── Insufficient Funds Text ───
    const fundsWarning = document.createElement('div');
    fundsWarning.id = 'hud-funds-warning';
    fundsWarning.textContent = '💸 INSUFFICIENT FUNDS';
    fundsWarning.style.cssText = `
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      font-size: 32px; font-weight: 900; color: #ff4444;
      text-shadow: 0 0 20px rgba(255,0,0,0.7);
      opacity: 0; transition: opacity 0.2s ease-out;
      pointer-events: none;
    `;
    this.container.appendChild(fundsWarning);

    this.currentTierIndex = 0;
  }

  // ─── Public API ───

  /** Update displayed credits with slot-roll animation */
  updateCredits(newCredits: number): void {
    if (newCredits === this.targetCredits) return;

    // If a roll is already animating, update its destination dynamically
    this.rollStartValue = this.displayedCredits;
    this.targetCredits = newCredits;
    this.rollStartTime = performance.now();

    if (!this.rollTimer) {
      this.rollTimer = setInterval(() => this.tickRoll(), ROLL_STEP_INTERVAL_MS);
    }
  }

  /** Flash the insufficient funds warning */
  flashInsufficientFunds(): void {
    const flash = this.flashOverlay;
    const warning = document.getElementById('hud-funds-warning');

    flash.style.opacity = '1';
    if (warning) warning.style.opacity = '1';

    setTimeout(() => {
      flash.style.opacity = '0';
      if (warning) warning.style.opacity = '0';
    }, 800);
  }

  /** Get current bet amount */
  getCurrentBet(): number {
    return BET_TIERS[this.currentTierIndex];
  }

  /** Clean up DOM elements */
  destroy(): void {
    if (this.rollTimer) {
      clearInterval(this.rollTimer);
      this.rollTimer = null;
    }
    this.container.remove();
  }

  // ─── Private Helpers ───

  private createPanel(id: string, positionCss: string): HTMLElement {
    const panel = document.createElement('div');
    panel.id = id;
    panel.style.cssText = `
      position: absolute; ${positionCss}
      background: rgba(0, 0, 0, 0.75);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 12px 20px;
      backdrop-filter: blur(8px);
      pointer-events: auto;
    `;
    return panel;
  }

  private createBetButton(label: string, onClick: () => void): HTMLElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.3);
      color: #fff; font-size: 20px; font-weight: 700;
      cursor: pointer; pointer-events: auto;
      transition: background 0.15s, transform 0.1s;
      display: flex; align-items: center; justify-content: center;
      line-height: 1; padding: 0;
    `;
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(255,255,255,0.2)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(255,255,255,0.1)';
    });
    btn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      btn.style.transform = 'scale(0.9)';
    });
    btn.addEventListener('mouseup', (e) => {
      e.stopPropagation();
      btn.style.transform = 'scale(1)';
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  private cycleBet(direction: number): void {
    const newIndex = Math.max(0, Math.min(BET_TIERS.length - 1, this.currentTierIndex + direction));
    if (newIndex === this.currentTierIndex) return;

    this.currentTierIndex = newIndex;
    const newBet = BET_TIERS[this.currentTierIndex];
    this.betEl.textContent = String(newBet);

    // Pulse animation
    this.betEl.style.transform = 'scale(1.15)';
    setTimeout(() => { this.betEl.style.transform = 'scale(1)'; }, 120);

    this.onBetChange?.(newBet);
  }

  private createWeaponButton(emoji: string, weaponType: string, onClick: () => void): HTMLElement {
    const btn = document.createElement('button');
    btn.innerHTML = `${emoji}<br><span style="font-size:10px;color:#aaa">${weaponType.toUpperCase()}</span>`;
    btn.style.cssText = `
      width: 70px; height: 50px; border-radius: 8px;
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.3);
      color: #fff; font-size: 18px; font-weight: 700;
      cursor: pointer; transition: all 0.15s;
    `;
    btn.addEventListener('mouseenter', () => {
      if (this.currentWeapon !== weaponType) btn.style.background = 'rgba(255,255,255,0.2)';
    });
    btn.addEventListener('mouseleave', () => {
      if (this.currentWeapon !== weaponType) btn.style.background = 'rgba(255,255,255,0.1)';
    });
    btn.addEventListener('mousedown', (e) => { e.stopPropagation(); btn.style.transform = 'scale(0.95)'; });
    btn.addEventListener('mouseup', (e) => { e.stopPropagation(); btn.style.transform = 'scale(1)'; });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  /** Called when user clicks a weapon HUD button, or when InputHandler syncs a keyboard shortcut */
  public selectWeapon(weaponType: WeaponType, skipCallback = false): void {
    if (this.currentWeapon === weaponType && !skipCallback) return;
    this.currentWeapon = weaponType;

    // Reset visuals
    Object.values(this.weaponBtns).forEach(btn => {
      btn.style.background = 'rgba(255,255,255,0.1)';
      btn.style.border = '1px solid rgba(255,255,255,0.3)';
      btn.style.boxShadow = 'none';
    });

    // Highlight selected
    const activeBtn = this.weaponBtns[weaponType];
    if (activeBtn) {
      activeBtn.style.background = 'rgba(0, 255, 204, 0.2)';
      activeBtn.style.border = '2px solid #00ffcc';
      activeBtn.style.boxShadow = '0 0 10px rgba(0, 255, 204, 0.5)';
    }

    if (!skipCallback) {
      this.onWeaponChange?.(weaponType);
    }
  }

  /** Animate the credit counter rolling toward targetCredits */
  private tickRoll(): void {
    const elapsed = performance.now() - this.rollStartTime;
    const progress = Math.min(elapsed / ROLL_DURATION_MS, 1);

    // Ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3);

    this.displayedCredits = Math.round(
      this.rollStartValue + (this.targetCredits - this.rollStartValue) * eased,
    );

    this.creditsEl.textContent = this.displayedCredits.toLocaleString();

    // Color flash: green for gain, red for loss
    if (this.targetCredits > this.rollStartValue) {
      this.creditsEl.style.color = '#00ff88';
    } else if (this.targetCredits < this.rollStartValue) {
      this.creditsEl.style.color = '#ff4444';
    }

    if (progress >= 1) {
      // Roll complete
      this.displayedCredits = this.targetCredits;
      this.creditsEl.textContent = this.displayedCredits.toLocaleString();
      this.creditsEl.style.color = '#FFD700'; // Reset to gold

      if (this.rollTimer) {
        clearInterval(this.rollTimer);
        this.rollTimer = null;
      }
    }
  }
}
