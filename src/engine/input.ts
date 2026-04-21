export interface InputState {
  onKeyDown(code: string): void;
  onKeyUp(code: string): void;
  isDown(code: string): boolean;
  justPressed(code: string): boolean;
  addMouseDelta(dx: number, dy: number): void;
  consumeMouseDelta(): { dx: number; dy: number };
}

export function createInputState(): InputState {
  const down = new Set<string>();
  const freshPress = new Set<string>();
  let mx = 0;
  let my = 0;
  return {
    onKeyDown(code) {
      if (!down.has(code)) {
        down.add(code);
        freshPress.add(code);
      }
    },
    onKeyUp(code) {
      down.delete(code);
      freshPress.delete(code);
    },
    isDown(code) { return down.has(code); },
    justPressed(code) {
      if (freshPress.has(code)) {
        freshPress.delete(code);
        return true;
      }
      return false;
    },
    addMouseDelta(dx, dy) { mx += dx; my += dy; },
    consumeMouseDelta() {
      const r = { dx: mx, dy: my };
      mx = 0; my = 0;
      return r;
    },
  };
}

export interface InputAttachment {
  detach(): void;
  isLocked(): boolean;
}

export function attachInput(canvas: HTMLCanvasElement, state: InputState): InputAttachment {
  let locked = false;

  const onKeyDown = (e: KeyboardEvent) => state.onKeyDown(e.code);
  const onKeyUp = (e: KeyboardEvent) => state.onKeyUp(e.code);
  const onClick = () => {
    if (!locked) canvas.requestPointerLock();
  };
  const onLockChange = () => {
    locked = document.pointerLockElement === canvas;
    const prompt = document.getElementById('prompt');
    if (prompt) prompt.classList.toggle('hidden', locked);
  };
  const onMouseMove = (e: MouseEvent) => {
    if (locked) state.addMouseDelta(e.movementX, e.movementY);
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('click', onClick);
  document.addEventListener('pointerlockchange', onLockChange);
  window.addEventListener('mousemove', onMouseMove);

  return {
    detach() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('click', onClick);
      document.removeEventListener('pointerlockchange', onLockChange);
      window.removeEventListener('mousemove', onMouseMove);
    },
    isLocked() { return locked; },
  };
}
