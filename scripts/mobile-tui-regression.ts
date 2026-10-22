/** iPhone touch → real WebSocket → Herdr → raw PTY. No model and no user workspace. */
import "./test-herdr.ts";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, devices } from "playwright-core";
import { createServer } from "../server/index.ts";
import { workspaceCreate, workspaceClose, paneSendText, paneSendKeys, paneRead, herdrRpc } from "../server/herdr/client.ts";
import { setTerminalInputMode } from "./mobile-terminal-controls.ts";
import { chromePath } from "./chrome-path.ts";

const root = mkdtempSync(join(tmpdir(), "herdr-mobile-tui-"));
const evidence = process.env.UI_EVIDENCE_DIR ?? join(root, "evidence");
mkdirSync(evidence, { recursive: true });
const owned: string[] = [];
const errors: string[] = [];
const server = createServer({ port: 0, hostname: "127.0.0.1", stateDir: join(root, "state"), token: "" });
const safari = process.env.MOBILE_BROWSER === "webkit";
const browser = safari ? await webkit.launch({ headless: true }) : await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });

async function until(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!(await check())) {
    assert(Date.now() < deadline, label);
    await Bun.sleep(25);
  }
}

try {
  const made = await workspaceCreate({ cwd: root, label: "Mobile TUI touch test" });
  owned.push(made.workspace.workspace_id);
  const pane = made.root_pane.pane_id;
  const log = join(root, "input.hex");
  const probe = resolve("scripts/fixtures/modifier-probe.py");
  await paneSendText(pane, `clear; printf '\\033[?1049h\\033[?1000h\\033[?1006h'; python3 -u '${probe}' '${log}' plain`);
  await paneSendKeys(pane, ["Enter"]);
  await until(async () => (await paneRead({ paneId: pane, source: "visible" })).text.includes("PROBE READY"), "raw PTY ready");
  // An agent pane must open its terminal without relying on the web transcript parser.
  await herdrRpc("pane.report_agent", { pane_id: pane, source: "manual", agent: "codex", state: "idle" });
  const context = await browser.newContext({ ...devices["iPhone 16 Pro"], locale: "en-US" });
  await context.addInitScript(() => {
    localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" }));
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  let ready = false;
  page.on("websocket", (ws) => ws.on("framereceived", ({ payload }) => {
    const message = JSON.parse(String(payload));
    if (message.type === "input-ready" && message.pane_id === pane) ready = message.ready !== false;
  }));
  const url = `http://127.0.0.1:${server.port}/?pane=${encodeURIComponent(pane)}`;
  await page.goto(url);
  await until(() => ready, "mobile input lease ready");
  await page.locator(".xterm-screen").waitFor();
  assert.equal(await page.locator(".terminal-stack.is-chat").count(), 0, "Codex opens the live TUI by default");
  const field = page.locator(".xterm-helper-textarea");
  const keyboard = page.getByRole("button", { name: "Show keyboard", exact: true });
  const focused = () => field.evaluate((node) => document.activeElement === node);
  const raw = () => existsSync(log) ? Buffer.from(readFileSync(log, "utf8"), "hex").toString("utf8") : "";
  let consumed = 0;
  const fresh = () => raw().slice(consumed);
  const clear = () => { consumed = raw().length; };
  const cdp = safari ? null : await context.newCDPSession(page);
  const box = (await page.locator(".xterm-screen").boundingBox())!;
  const x = box.x + box.width * 0.25;
  const y = box.y + box.height * 0.4;
  const touch = (type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", points: Array<{ x: number; y: number; id: number }>) => cdp ? cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points }) : page.evaluate(({ type, points }) => {
    // WebKit has no CDP gesture API: taps below use its native touchscreen API;
    // swipe/cancel tests dispatch DOM TouchEvents through the same handlers.
    const w = window as Window & { mobileTouchTarget?: Element; mobileTouches?: Array<Pick<Touch, "identifier" | "target" | "clientX" | "clientY">> };
    if (type === "touchStart") w.mobileTouchTarget = document.elementFromPoint(points[0]!.x, points[0]!.y)!;
    const target = w.mobileTouchTarget!;
    const touches = points.map((p) => ({ identifier: p.id, target, clientX: p.x, clientY: p.y }));
    const event = new Event(type.toLowerCase(), { bubbles: true, cancelable: true });
    Object.assign(event, { touches, targetTouches: touches, changedTouches: touches.length ? touches : w.mobileTouches });
    target.dispatchEvent(event);
    w.mobileTouches = touches;
  }, { type, points });
  const tap = async (px: number, py: number) => {
    await page.touchscreen.tap(px, py);
  };
  // fixed wait: prove no delayed compatibility click arrives after the gesture.
  const quiet = async () => { await Bun.sleep(300); };

  assert.equal(await focused(), false, "opening does not focus terminal input");
  clear();
  await tap(x, y);
  await until(() => /\x1b\[<0;\d+;\d+m/.test(fresh()), "tap reaches PTY as press and release");
  await quiet();
  assert.match(fresh(), /^\x1b\[<0;(\d+);(\d+)M\x1b\[<0;\1;\2m$/, "one tap, exactly one matching press/release");
  assert.equal(await focused(), false, "TUI tap never opens input");
  await page.screenshot({ path: join(evidence, `${safari ? "webkit" : "chromium"}-iphone-portrait.png`) });

  clear();
  await touch("touchStart", [{ x, y, id: 1 }]);
  for (let i = 1; i <= 10; i++) await touch("touchMove", [{ x: x + i * 12, y: y + i * 12, id: 1 }]);
  await touch("touchEnd", []);
  const atRelease = raw().length;
  await until(() => raw().length > atRelease, "flick coasts after finger release");
  await until(() => /\x1b\[<6[45];/.test(fresh()), "swipe reaches PTY as wheel reports");
  await quiet();
  assert.doesNotMatch(fresh(), /\x1b\[<0;/, "a diagonal swipe never clicks");
  const wheelCells = [...fresh().matchAll(/\x1b\[<6[45];(\d+);(\d+)M/g)].map((m) => `${m[1]}:${m[2]}`);
  assert(wheelCells.length > 1, "scroll sends several steps");
  assert.equal(new Set(wheelCells).size, 1, "the original TUI panel owns the entire swipe");
  assert.equal(await focused(), false, "scroll keeps keyboard closed");

  // A flick keeps moving after release; touching again cancels that inertia.
  await touch("touchStart", [{ x, y, id: 1 }]);
  await touch("touchCancel", []);
  await quiet(); // fixed wait: allow already sent bytes to drain before checking the stop.
  clear();
  await quiet();
  assert.equal(fresh(), "", "new touch stops momentum");

  clear();
  await touch("touchStart", [{ x, y, id: 1 }]);
  await touch("touchCancel", []);
  await quiet();
  assert.equal(fresh(), "", "cancelled tap sends nothing");
  await touch("touchStart", [{ x, y, id: 1 }]);
  await touch("touchMove", [{ x: x + 30, y, id: 1 }]);
  await touch("touchMove", [{ x, y, id: 1 }]);
  await touch("touchEnd", []);
  await quiet();
  assert.equal(fresh(), "", "moving out and back cannot become a tap");

  clear();
  await page.locator('.key[data-key="ArrowUp"]').tap();
  await until(() => fresh().includes("\x1b[A"), "key bar arrow reaches PTY");
  assert.equal(await focused(), false, "service keys work with keyboard closed");
  await page.locator('.key[data-key="Control"]').tap();
  assert.equal(await focused(), false, "modifier does not summon keyboard");
  await page.locator('.key[data-key="Control"]').tap();

  // The probe leaves its cursor on the line immediately after PROBE READY.
  const inputRow = await page.locator(".xterm-rows > div").evaluateAll((rows) => {
    const index = rows.findIndex((row) => row.textContent?.includes("PROBE READY"));
    if (index < 0 || !rows[index + 1]) throw new Error("probe input row missing");
    const rect = rows[index + 1]!.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await tap(inputRow.x, inputRow.y);
  await until(focused, "tapping the actual terminal input row opens the keyboard");
  await page.getByRole("button", { name: "Hide keyboard", exact: true }).tap();
  await touch("touchStart", [{ ...inputRow, id: 1 }]);
  await touch("touchMove", [{ x: inputRow.x, y: inputRow.y + 60, id: 1 }]);
  await touch("touchEnd", []);
  assert.equal(await focused(), false, "swiping from the input row does not open the keyboard");

  await keyboard.tap();
  await until(focused, "explicit keyboard action focuses the input");
  clear();
  await page.keyboard.insertText("Привет iPhone");
  await until(() => fresh().includes("Привет iPhone"), "Unicode text reaches real PTY");
  await page.getByRole("button", { name: "Hide keyboard", exact: true }).tap();
  assert.equal(await focused(), false, "explicit hide blurs input");
  await field.focus();
  assert.equal(await focused(), false, "unexpected focus cannot reopen locked keyboard");

  // Opening the keyboard shrinks only the browser's visible area; cover layout separately.
  await page.setViewportSize({ width: 402, height: 400 });
  await keyboard.waitFor({ state: "visible" });
  assert((await keyboard.boundingBox())!.height >= 44, "keyboard target stays at least 44 CSS px");
  await page.screenshot({ path: join(evidence, `${safari ? "webkit" : "chromium"}-iphone-short-viewport.png`) });
  await page.setViewportSize({ width: 874, height: 402 });
  await until(async () => (await page.locator(".xterm-screen").boundingBox())!.width > 500, "landscape fits grid");
  await page.screenshot({ path: join(evidence, `${safari ? "webkit" : "chromium"}-iphone-landscape.png`) });
  await page.setViewportSize({ width: 402, height: 874 });
  await keyboard.tap();
  ready = false;
  await page.reload();
  await until(() => ready, "reload restores terminal attachment");
  assert.equal(await focused(), false, "reload always starts with keyboard closed");
  await setTerminalInputMode(page, "line");
  const line = page.locator(".terminal-input-text");
  await line.tap();
  assert.equal(await line.evaluate((node) => document.activeElement === node), true, "tapping the optional input line opens it directly");
  assert.deepEqual(errors, [], "no browser errors");
  console.log("PASS iPhone TUI: tap bytes, anchored scroll, cancelled gestures, hidden-keyboard keys, Unicode input, reload, portrait/landscape");
} finally {
  await browser.close();
  server.stop();
  for (const id of owned) await workspaceClose(id).catch(() => undefined);
  rmSync(root, { recursive: true, force: true });
}
