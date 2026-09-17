import { expect, test } from '@playwright/test';

test('review workflow smoke path', async ({ page }) => {
  await page.goto('/notes');
  await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
  await page.getByLabel('Search notes').fill('Avery');
  await expect(page.getByLabel('Notes results')).toBeVisible();
  await page.goto('/notes/note-3');
  await expect(page.getByRole('heading', { name: /Morgan/ })).toBeVisible();
  await page.getByRole('button', { name: 'Start review' }).click();
  await page.getByLabel('Assessment').fill('Updated assessment for smoke test.');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
  await page.getByLabel('Rejection reason').fill('Needs clarification.');
  await page.getByRole('button', { name: 'Reject' }).click();
});
