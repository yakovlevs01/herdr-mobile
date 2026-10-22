/** A stroke remains a tap only while it stays within a finger's small resting jitter. */
export class TerminalTouch {
  private start: { x: number; y: number; pane: string | null } | null = null;
  private last = { x: 0, y: 0 };
  private dragged = false;

  begin(x: number, y: number, pane: string | null): void {
    this.start = { x, y, pane };
    this.last = { x, y };
    this.dragged = false;
  }

  move(x: number, y: number): { across: number; delta: number } | null {
    if (!this.start) return null;
    if (!this.dragged && Math.hypot(x - this.start.x, y - this.start.y) < 8) return null;
    this.dragged = true;
    const travel = { across: this.last.x - x, delta: this.last.y - y };
    this.last = { x, y };
    return travel;
  }

  tap(pane: string | null): { x: number; y: number } | null {
    const start = this.start;
    return start && !this.dragged && start.pane === pane ? start : null;
  }

  cancel(): void { this.start = null; }
}

/** A short, bounded fling. Pausing before release stops it, as does any new interaction. */
export class TerminalTouchMomentum {
  private samples: Array<{ delta: number; time: number }> = [];
  private lastTime = 0;
  private speed = 0;
  private remaining = 0;

  reset(): void {
    this.samples = [];
    this.speed = 0;
    this.remaining = 0;
  }

  begin(time: number): void {
    this.reset();
    this.lastTime = time;
    this.samples.push({ delta: 0, time });
  }

  move(delta: number, time: number): void {
    if (delta === 0) return;
    this.samples.push({ delta, time });
    while (this.samples.length > 2 && this.samples[1]!.time < time - 100) this.samples.shift();
  }

  release(time: number): boolean {
    const first = this.samples[0], last = this.samples.at(-1);
    if (!first || !last || time - last.time > 80 || last.time - first.time < 8) return false;
    const distance = this.samples.slice(1).reduce((sum, sample) => sum + sample.delta, 0);
    this.speed = Math.max(-2.5, Math.min(2.5, distance / (last.time - first.time)));
    if (Math.abs(this.speed) < 0.15) return false;
    this.remaining = 900;
    this.lastTime = time;
    return true;
  }

  advance(time: number): number {
    const elapsed = time - this.lastTime;
    // A suspended/throttled page must not catch up with a burst of stale wheel reports.
    if (elapsed <= 0 || elapsed > 80 || this.remaining <= 0 || Math.abs(this.speed) < 0.05) return 0;
    this.lastTime = time;
    this.remaining -= elapsed;
    const decay = Math.exp(-elapsed / 240);
    const distance = this.speed * 240 * (1 - decay);
    this.speed *= decay;
    return distance;
  }
}

/** Herdr's attach stream uses SGR cell coordinates, independent of the child TUI's mouse mode. */
export function terminalCell(x: number, y: number, rect: Pick<DOMRect, "left" | "top" | "width" | "height">, cols: number, rows: number): { col: number; row: number } | null {
  if (rect.width <= 0 || rect.height <= 0 || x < rect.left || y < rect.top || x >= rect.left + rect.width || y >= rect.top + rect.height) return null;
  return { col: Math.floor((x - rect.left) / rect.width * cols) + 1, row: Math.floor((y - rect.top) / rect.height * rows) + 1 };
}
