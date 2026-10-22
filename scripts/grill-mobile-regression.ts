/** Optional integration against the installed Grill TUI; agent replies come from a local stub. */
import "./test-herdr.ts";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright-core";
import { createServer } from "../server/index.ts";
import { workspaceCreate, workspaceClose, paneSendText, paneSendKeys, paneRead } from "../server/herdr/client.ts";
import { chromePath } from "./chrome-path.ts";

const skill = process.env.GRILL_SKILL_DIR ?? join(homedir(), ".codex/skills/grill-ui");
const python = process.env.GRILL_PYTHON ?? join(homedir(), ".local/share/grill-ui/venv/bin/python");
assert(existsSync(join(skill, "scripts/grill_tui.py")) && existsSync(python), "Install grill-ui or set GRILL_SKILL_DIR and GRILL_PYTHON");
const root = mkdtempSync(join(tmpdir(), "herdr-mobile-grill-"));
const session = join(root, "session");
const evidence = process.env.UI_EVIDENCE_DIR ?? join(root, "evidence");
mkdirSync(evidence, { recursive: true });
mkdirSync(join(root, "bin"));
// No external model calls: exercise Grill's actual exec and resume transport with fixed replies.
writeFileSync(join(root, "bin/codex"), `#!/usr/bin/env python3
import sys,json
if 'exec' not in sys.argv:
 print('[]'); sys.exit(0)
sys.stdin.read()
print(json.dumps({'type':'thread.started','thread_id':'mobile-test'}))
print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':'Ответ тестового агента. ' * 80}}))
`, { mode: 0o700 });
const env = { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` };
const round = join(root, "round.json");
writeFileSync(round, JSON.stringify({ id: "mobile-test", title: "Проверка телефона", goal: "Проверить TUI", context: "Изолированный тест без настоящих агентов.", questions: [
  { id: "choice", title: "Выбор пальцем", body: "Выбери вариант и открой чат.", recommendation: "Выбери Первый вариант.", context: "Тест", mode: "single", options: [{ id: "first", label: "Первый вариант" }, { id: "second", label: "Второй вариант" }] },
  { id: "text", title: "Длинный вопрос", body: Array.from({ length: 30 }, (_, i) => `Абзац ${i + 1}. Прокрутка длинного текста на телефоне.`).join("\n\n"), recommendation: "Напиши Ответ с телефона.", context: "Тест", mode: "text", options: [] },
] }));
const init = Bun.spawnSync([python, join(skill, "scripts/grill_ui.py"), "init", "--round", round, "--session", session, "--cwd", root, "--harness", "codex", "--model", "smoke", "--effort", "high"], { env });
assert.equal(init.exitCode, 0, new TextDecoder().decode(init.stderr));
const grill = Bun.spawn([python, join(skill, "scripts/grill_ui.py"), "serve", "--session", session], { env, stdout: "ignore", stderr: Bun.file(join(root, "grill.log")), stdin: "ignore" });
const server = createServer({ port: 0, hostname: "127.0.0.1", stateDir: join(root, "web-state"), token: "" });
const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
const owned: string[] = [];
async function until(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!(await check())) { assert(Date.now() < deadline, label); await Bun.sleep(50); }
}
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
try {
  await until(() => existsSync(join(session, "server.json")), "Grill API ready");
  const made = await workspaceCreate({ cwd: root, label: "Grill on iPhone" });
  owned.push(made.workspace.workspace_id);
  const pane = made.root_pane.pane_id;
  await paneSendText(pane, `${quote(python)} ${quote(join(skill, "scripts/grill_tui.py"))} --session ${quote(session)}`);
  await paneSendKeys(pane, ["Enter"]);
  await until(async () => (await paneRead({ paneId: pane, source: "visible" })).text.includes("Grill"), "Grill TUI ready");
  const context = await browser.newContext({ ...devices["iPhone 16 Pro"], viewport: { width: 402, height: 874 }, locale: "en-US" });
  await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" })));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const url = `http://127.0.0.1:${server.port}/?pane=${encodeURIComponent(pane)}`;
  console.log(`GRILL_QA_URL=${url}`);
  console.log(`GRILL_QA_ROOT=${root}`);
  await page.goto(url);
  const text = () => page.locator(".xterm-rows").innerText();
  await until(async () => (await text()).includes("Первый вариант"), "first question rendered on phone");
  const tapText = async (needle: string) => {
    const point = await page.evaluate((needle) => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>(".xterm-rows > div"));
      for (const row of rows.reverse()) {
        const text = (row.textContent ?? "").replaceAll("\u00a0", " ");
        const at = text.indexOf(needle);
        if (at < 0) continue;
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        let offset = 0;
        let started = false;
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const end = offset + (node.textContent?.length ?? 0);
          if (!started && at < end) { range.setStart(node, at - offset); started = true; }
          if (started && at + needle.length <= end) {
            range.setEnd(node, at + needle.length - offset);
            const rect = range.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          }
          offset = end;
        }
      }
      return null;
    }, needle);
    assert(point, `visible terminal text: ${needle}`);
    await page.touchscreen.tap(point.x, point.y);
  };
  await page.screenshot({ path: join(evidence, "grill-iphone-question.png") });
  await tapText("Первый вариант");
  await tapText("Чат");
  await until(async () => (await text()).includes("Сообщение"), "chat opens with one tap");
  await page.screenshot({ path: join(evidence, "grill-iphone-chat.png") });
  // Textual focuses its message field through F6; the actual phone has customizable F keys.
  // Tap the empty field directly, using the row below its label.
  const point = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll<HTMLElement>(".xterm-rows > div")).find((r) => r.textContent?.includes("Сообщение"))!;
    const rect = row.getBoundingClientRect();
    return { x: rect.left + 50, y: rect.top + rect.height * 2.5 };
  });
  await page.touchscreen.tap(point.x, point.y);
  await page.getByRole("button", { name: "Show keyboard", exact: true }).tap();
  await page.keyboard.insertText("Тестовый вопрос");
  await page.locator('.key[data-key="Enter"]').tap();
  await page.getByRole("button", { name: "Hide keyboard", exact: true }).tap();
  await until(async () => (await text()).includes("Ответ тестового"), "stub answer arrives through real Grill CLI bridge");
  await page.screenshot({ path: join(evidence, "grill-iphone-reply.png") });
  const cdp = await context.newCDPSession(page);
  const screen = (await page.locator(".xterm-screen").boundingBox())!;
  const x = screen.x + screen.width / 2;
  const y = screen.y + screen.height / 2;
  const before = await text();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + i * 15, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await until(async () => (await text()) !== before, "swipe scrolls the actual Grill conversation");
  await tapText("Назад");
  await until(async () => (await text()).includes("Первый вариант"), "back returns to question");
  await tapText("Подтвердить");
  await until(async () => (await text()).includes("Абзац 1."), "selection confirmed and next question opened");
  const longBefore = await text();
  const bodyY = screen.y + 150;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: bodyY, id: 1 }] });
  for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: bodyY - i * 12, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await until(async () => (await text()) !== longBefore, "long question scrolls");
  const answerPoint = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll<HTMLElement>(".xterm-rows > div")).find((r) => r.textContent?.includes("Ваш ответ"))!;
    const rect = row.getBoundingClientRect();
    return { x: rect.left + 50, y: rect.top + rect.height * 2.5 };
  });
  await page.touchscreen.tap(answerPoint.x, answerPoint.y);
  await page.getByRole("button", { name: "Show keyboard", exact: true }).tap();
  await page.keyboard.insertText("Ответ с телефона");
  await page.locator('.key[data-key="Enter"]').tap();
  await page.getByRole("button", { name: "Hide keyboard", exact: true }).tap();
  await until(async () => (await text()).includes("Отправить все"), "round can be submitted");
  await tapText("Отправить все");
  const resultPath = join(session, "submissions/0001.json");
  await until(() => existsSync(resultPath), "touch submission writes the actual result");
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert.deepEqual(result.answers[0].selected, ["first"]);
  assert.equal(result.answers[1].text, "Ответ с телефона");
  await page.screenshot({ path: join(evidence, "grill-iphone-submitted.png") });
  assert.deepEqual(errors, []);
  console.log("PASS real Grill: choice tap, chat, Russian input, stub CLI reply, conversation swipe, back, long question, text answer and final submission");
  if (process.env.MOBILE_QA_HOLD === "1") {
    await context.close(); // release the owned attach before agent-browser opens the same test pane
    console.log(`Inspection ready; create ${join(root, "done")} to stop.`);
    const deadline = Date.now() + 20 * 60_000;
    while (!existsSync(join(root, "done"))) {
      if (Date.now() > deadline) throw new Error("Inspection timed out");
      await Bun.sleep(500);
    }
  }
} finally {
  await browser.close();
  server.stop();
  for (const id of owned) await workspaceClose(id).catch(() => undefined);
  grill.kill();
  await grill.exited;
  rmSync(root, { recursive: true, force: true });
}
