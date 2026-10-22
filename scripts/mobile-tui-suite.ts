/** The mobile fork's repeatable browser feedback loop, all on check.ts's isolated Herdr. */
export {};

const checks = [
  { script: "mobile-tui-regression.ts", engine: "chromium" },
  { script: "mobile-tui-regression.ts", engine: "webkit" },
  { script: "terminal-arrows-clicks-regression.ts", engine: "chromium" },
  { script: "terminal-pinch-regression.ts", engine: "chromium" },
  { script: "key-bar-hold-repeat-regression.ts", engine: "chromium" },
  { script: "sticky-modifiers-regression.ts", engine: "chromium" },
  { script: "key-bar-customization-demo-regression.ts", engine: "chromium" },
  ...(process.env.GRILL_MOBILE_TEST === "1" ? [{ script: "grill-mobile-regression.ts", engine: "chromium" }] : []),
];
const failed: string[] = [];
for (const check of checks) {
  const label = `${check.script} (${check.engine})`;
  console.log(`Running ${label}`);
  const child = Bun.spawn([process.execPath, `scripts/${check.script}`], {
    env: { ...process.env, MOBILE_BROWSER: check.engine }, stdin: "ignore", stdout: "inherit", stderr: "inherit",
  });
  if (await child.exited !== 0) failed.push(label);
}
if (failed.length) {
  console.error(`Failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`PASS ${checks.length} browser checks`);
