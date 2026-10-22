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

/** Herdr's attach stream uses SGR cell coordinates, independent of the child TUI's mouse mode. */
export function terminalCell(x: number, y: number, rect: Pick<DOMRect, "left" | "top" | "width" | "height">, cols: number, rows: number): { col: number; row: number } | null {
  if (rect.width <= 0 || rect.height <= 0 || x < rect.left || y < rect.top || x >= rect.left + rect.width || y >= rect.top + rect.height) return null;
  return { col: Math.floor((x - rect.left) / rect.width * cols) + 1, row: Math.floor((y - rect.top) / rect.height * rows) + 1 };
}
