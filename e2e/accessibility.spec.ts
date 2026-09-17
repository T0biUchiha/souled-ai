import { expect, test } from '@playwright/test';

test('notes list has named filters, sortable columns, and keyboard-reachable note links', async ({ page, request }) => {
  await request.post('/api/dev/seed', { data: { count: 20 } });
  await page.goto('/notes');
  await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
  await expect(page.getByLabel('Search notes')).toBeVisible();
  await expect(page.getByLabel('Reviewer filter')).toBeVisible();
  const patientSort = page.getByRole('columnheader', { name: /Sort by Patient/ });
  await patientSort.focus(); await page.keyboard.press('Enter');
  await expect(patientSort).toHaveAttribute('aria-sort', 'descending');
  const firstNote = page.getByRole('grid').getByRole('link').first();
  await firstNote.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('reject dialog manages keyboard focus and SOAP saves preserve editor focus', async ({ page, request }) => {
  await request.post('/api/dev/seed', { data: { count: 20 } });
  await page.goto('/notes/note-3');
  await page.getByRole('button', { name: 'Start review' }).click();
  const plan = page.getByLabel('Plan');
  await plan.focus(); await page.keyboard.type(' keyboard edit');
  await expect(plan).toBeFocused();
  await expect(page.getByTestId('save-status')).toHaveText('Saving…');
  await expect(page.getByText('version-3-2')).toBeVisible();
  await expect(plan).toBeFocused();
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
  const reject = page.getByRole('button', { name: 'Reject' });
  await reject.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Reject note' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Rejection reason' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('textbox', { name: 'Rejection reason' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(reject).toBeFocused();
});

test('version history comparison and conflict resolution expose named keyboard regions', async ({ browser, request }) => {
  await request.post('/api/dev/seed', { data: { count: 20 } });
  const a = await browser.newContext(); const b = await browser.newContext();
  const pageA = await a.newPage(); const pageB = await b.newPage();
  await pageA.goto('/notes/note-1'); await pageB.goto('/notes/note-1');
  await pageA.getByLabel('Assessment').fill('A conflict change');
  await pageB.getByLabel('Plan').fill('B conflict change');
  await pageA.getByRole('button', { name: 'Save now' }).click();
  const conflict = pageB.getByRole('dialog', { name: 'Version conflict' });
  await expect(conflict).toBeVisible();
  await expect(conflict.getByRole('button', { name: 'Accept local' })).toBeFocused();
  await pageB.keyboard.press('Tab');
  await expect(conflict.getByRole('button', { name: 'Accept server' })).toBeFocused();
  await pageB.getByRole('button', { name: 'Continue manual merge' }).click();
  await expect(conflict).toBeHidden();
  await expect(pageB.getByLabel('Compare version-1-1')).toBeVisible();
  await a.close(); await b.close();
});
