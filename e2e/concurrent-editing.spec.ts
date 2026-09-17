import { expect, test } from '@playwright/test';

const user = (id: string, displayName: string) => ({ id, displayName, roles: ['REVIEWER', 'CLINICIAN'] });
const configureUser = async (page: import('@playwright/test').Page, value: ReturnType<typeof user>) => {
  await page.addInitScript((currentUser) => sessionStorage.setItem('clinical-note-mock-current-user', JSON.stringify(currentUser)), value);
};

test('two reviewers preserve local edits and resolve a stale version conflict', async ({ browser, request }) => {
  await request.post('/api/dev/seed', { data: { count: 20 } });
  const contextA = await browser.newContext(); const contextB = await browser.newContext();
  const pageA = await contextA.newPage(); const pageB = await contextB.newPage();
  await configureUser(pageA, user('reviewer-1', 'Reviewer A')); await configureUser(pageB, user('reviewer-2', 'Reviewer B'));
  await pageA.goto('/notes/note-1'); await pageB.goto('/notes/note-1');
  await expect(pageA.getByLabel('Assessment')).toBeVisible(); await expect(pageB.getByLabel('Plan')).toBeVisible();
  await pageA.getByLabel('Assessment').fill('Assessment from reviewer A');
  await pageB.getByLabel('Plan').fill('Plan from reviewer B');
  await pageA.getByRole('button', { name: 'Save now' }).click();
  await expect(pageA.getByText('version-1-2')).toBeVisible();
  await expect(pageB.getByRole('heading', { name: 'Version conflict' })).toBeVisible();
  await expect(pageB.getByText('Your local edits')).toBeVisible();
  await expect(pageB.getByLabel('Plan')).toHaveValue('Plan from reviewer B');
  await pageB.getByRole('button', { name: 'Continue manual merge' }).click();
  await expect(pageB.getByRole('heading', { name: 'Version conflict' })).toBeHidden();
  await expect(pageB.getByText('version-1-3')).toBeVisible();
  await contextA.close(); await contextB.close();
});
