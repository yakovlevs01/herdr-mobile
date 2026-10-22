/** User actions shared by browser checks of the fork's explicit keyboard policy. */
import type { Locator, Page } from "playwright-core";
import { openSettingsPage } from "./settings-page.ts";

export async function focusTerminalInput(page: Page, field: Locator): Promise<void> {
  const show = page.getByRole("button", { name: "Show keyboard", exact: true });
  if (await show.count()) await show.tap();
  await field.focus();
}

export async function setTerminalInputMode(page: Page, mode: "line" | "direct"): Promise<void> {
  const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent));
  await page.keyboard.press(`${mac ? "Meta" : "Control"}+Shift+Comma`);
  await openSettingsPage(page, "Terminal");
  await page.getByRole("combobox", { name: "Terminal input mode", exact: true }).selectOption(mode);
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
}
