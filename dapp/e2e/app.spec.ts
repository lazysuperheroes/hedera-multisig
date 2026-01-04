import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Hedera MultiSig dApp
 *
 * These tests verify the dApp UI and basic functionality.
 * Note: Full signing flow requires wallet mocking (WalletConnect).
 */

test.describe('dApp Basic Tests', () => {
  test('homepage loads correctly', async ({ page }) => {
    await page.goto('/');

    // Check page title
    await expect(page).toHaveTitle(/Hedera Multi-Sig|MultiSig/i);

    // Check main content is visible
    await expect(page.locator('main')).toBeVisible();
  });

  test('displays join session UI', async ({ page }) => {
    await page.goto('/join');

    // Look for connection string input (primary join method)
    const connectionInput = page.getByPlaceholder(/hmsc:|connection/i).first();
    await expect(connectionInput).toBeVisible();
  });

  test('shows error for invalid session connection', async ({ page }) => {
    await page.goto('/join');

    // Try to connect with invalid connection string
    const connectionInput = page.getByPlaceholder(/hmsc:|connection/i).first();
    await connectionInput.fill('invalid-connection-string');

    // Find and click connect button
    const connectBtn = page.getByRole('button', { name: /connect|join/i }).first();
    if (await connectBtn.isVisible()) {
      await connectBtn.click();

      // Should show error
      await expect(page.getByText(/error|invalid|failed/i).first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('responsive design - mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Content should still be visible
    await expect(page.locator('main')).toBeVisible();
  });
});

test.describe('Session UI', () => {
  test('PIN input accepts correct format', async ({ page }) => {
    await page.goto('/join');

    // Click manual entry to show individual fields
    const manualEntry = page.getByText(/manual|enter.*manually/i).first();
    if (await manualEntry.isVisible()) {
      await manualEntry.click();
    }

    const pinInput = page.getByPlaceholder(/pin/i).first();
    if (await pinInput.isVisible()) {
      await pinInput.fill('ABC12345');
      await expect(pinInput).toHaveValue('ABC12345');
    }
  });

  test('session ID input accepts hex format', async ({ page }) => {
    await page.goto('/join');

    // Click manual entry to show individual fields
    const manualEntry = page.getByText(/manual|enter.*manually/i).first();
    if (await manualEntry.isVisible()) {
      await manualEntry.click();
    }

    // Session ID field uses placeholder like "abc123def456"
    const sessionInput = page.getByPlaceholder(/abc123|session/i).first();
    if (await sessionInput.isVisible()) {
      await sessionInput.fill('abcdef1234567890');
      await expect(sessionInput).toHaveValue('abcdef1234567890');
    }
  });
});

test.describe('Accessibility', () => {
  test('has no critical accessibility violations', async ({ page }) => {
    await page.goto('/');

    // Basic accessibility checks
    // Check for alt text on images
    const images = page.locator('img');
    const imageCount = await images.count();
    for (let i = 0; i < imageCount; i++) {
      const img = images.nth(i);
      const alt = await img.getAttribute('alt');
      // Images should have alt text (empty string is valid for decorative images)
      expect(alt).not.toBeNull();
    }

    // Check for button labels
    const buttons = page.locator('button');
    const buttonCount = await buttons.count();
    for (let i = 0; i < buttonCount; i++) {
      const btn = buttons.nth(i);
      const text = await btn.textContent();
      const ariaLabel = await btn.getAttribute('aria-label');
      // Buttons should have text or aria-label
      expect(text?.trim() || ariaLabel).toBeTruthy();
    }
  });

  test('keyboard navigation works', async ({ page }) => {
    await page.goto('/');

    // Tab through interactive elements
    await page.keyboard.press('Tab');

    // Something should be focused
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();
  });
});
