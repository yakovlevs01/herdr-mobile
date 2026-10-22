import { describe, expect, it } from "bun:test";
import { TerminalTouch, terminalCell } from "./terminalTouch.ts";

describe("terminal touch routing", () => {
  it("tolerates resting jitter, but never turns a completed drag back into a tap", () => {
    const stroke = new TerminalTouch();
    stroke.begin(100, 100, "pane-a");
    expect(stroke.move(103, 102)).toBeNull();
    expect(stroke.tap("pane-a")).toMatchObject({ x: 100, y: 100 });
    expect(stroke.move(100, 130)).toEqual({ across: 0, delta: -30 });
    stroke.move(100, 100);
    expect(stroke.tap("pane-a")).toBeNull();
  });
  it("drops a tap after navigation, cancellation or a pinch", () => {
    const stroke = new TerminalTouch();
    stroke.begin(10, 20, "pane-a");
    expect(stroke.tap("pane-b")).toBeNull();
    stroke.cancel();
    expect(stroke.tap("pane-a")).toBeNull();
    expect(stroke.move(50, 60)).toBeNull();
  });
  it("uses one-based cells after zoom and rejects padding outside the rendered screen", () => {
    const rect = { left: 8, top: 50, width: 380, height: 600 };
    expect(terminalCell(8, 50, rect, 40, 30)).toEqual({ col: 1, row: 1 });
    expect(terminalCell(387, 649, rect, 40, 30)).toEqual({ col: 40, row: 30 });
    expect(terminalCell(388, 650, rect, 40, 30)).toBeNull();
    expect(terminalCell(7, 50, rect, 40, 30)).toBeNull();
  });
});
