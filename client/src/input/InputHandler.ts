// ─────────────────────────────────────────────────────────────
// Input Handler — Captures User Input and Creates Intents
// Per ECS skill contract: raw input → Intent Components.
// ─────────────────────────────────────────────────────────────

export interface FireIntent {
  angle: number;
}

export interface InputState {
  mouseX: number;
  mouseY: number;
  mouseDown: boolean;
  justPressed: boolean;
}

/**
 * Captures mouse/pointer input for aiming and firing.
 * Translates raw DOM events into game intents.
 */
export class InputHandler {
  private state: InputState = {
    mouseX: 0,
    mouseY: 0,
    mouseDown: false,
    justPressed: false,
  };
  private previousMouseDown = false;
  private readonly canvas: HTMLElement;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) throw new Error(`Container '${containerId}' not found`);
    this.canvas = container;
    this.setupListeners();
  }

  private setupListeners(): void {
    this.canvas.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      // Scale mouse coordinates to game world coordinates (1920×1080)
      this.state.mouseX = ((e.clientX - rect.left) / rect.width) * 1920;
      this.state.mouseY = ((e.clientY - rect.top) / rect.height) * 1080;
    });

    this.canvas.addEventListener('mousedown', () => {
      this.state.mouseDown = true;
    });

    this.canvas.addEventListener('mouseup', () => {
      this.state.mouseDown = false;
    });

    // Touch support
    this.canvas.addEventListener('touchstart', (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      this.state.mouseX = ((touch.clientX - rect.left) / rect.width) * 1920;
      this.state.mouseY = ((touch.clientY - rect.top) / rect.height) * 1080;
      this.state.mouseDown = true;
    }, { passive: false });

    this.canvas.addEventListener('touchend', () => {
      this.state.mouseDown = false;
    });

    this.canvas.addEventListener('touchmove', (e: TouchEvent) => {
      const touch = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      this.state.mouseX = ((touch.clientX - rect.left) / rect.width) * 1920;
      this.state.mouseY = ((touch.clientY - rect.top) / rect.height) * 1080;
    });
  }

  /** Call once per frame to update justPressed */
  update(): void {
    this.state.justPressed = this.state.mouseDown && !this.previousMouseDown;
    this.previousMouseDown = this.state.mouseDown;
  }

  /** Get the fire intent if the player just clicked */
  getFireIntent(turretX: number, turretY: number): FireIntent | null {
    if (!this.state.justPressed) return null;

    const dx = this.state.mouseX - turretX;
    const dy = this.state.mouseY - turretY;
    const angle = Math.atan2(dy, dx);

    return { angle };
  }

  /** Get the current aim angle from turret position to mouse */
  getAimAngle(turretX: number, turretY: number): number {
    const dx = this.state.mouseX - turretX;
    const dy = this.state.mouseY - turretY;
    return Math.atan2(dy, dx);
  }

  /** Get raw state for debugging */
  getState(): Readonly<InputState> {
    return this.state;
  }

  destroy(): void {
    // Listeners are gc'd with the element
  }
}
