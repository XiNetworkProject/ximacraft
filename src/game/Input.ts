export class Input {
  readonly keys = new Set<string>();
  readonly justPressed = new Set<string>();
  mouseDeltaX = 0;
  mouseDeltaY = 0;
  wheelDelta = 0;
  leftClick = false;
  rightClick = false;
  pointerLocked = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("contextmenu", (event) => event.preventDefault());
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
  }

  requestPointerLock(): void {
    this.canvas.requestPointerLock();
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  wasPressed(code: string): boolean {
    return this.justPressed.has(code);
  }

  endFrame(): void {
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.wheelDelta = 0;
    this.leftClick = false;
    this.rightClick = false;
    this.justPressed.clear();
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("wheel", this.onWheel);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.keys.has(event.code)) {
      this.justPressed.add(event.code);
    }
    this.keys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.pointerLocked) {
      return;
    }
    this.mouseDeltaX += event.movementX;
    this.mouseDeltaY += event.movementY;
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.pointerLocked) {
      return;
    }
    if (event.button === 0) this.leftClick = true;
    if (event.button === 2) this.rightClick = true;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    this.wheelDelta += event.deltaY;
    if (this.pointerLocked) {
      event.preventDefault();
    }
  };
}
