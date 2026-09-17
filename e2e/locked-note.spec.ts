import { expect, test } from '@playwright/test';

test('locked notes are read-only in the UI and reject direct server mutations', async ({ page, request }) => {
  await request.post('/api/dev/seed', { data: { count: 20 } });
  await page.goto('/notes/note-8');
  await expect(page.getByText('This note is locked. Its clinical content and audit record are read-only.')).toBeVisible();
  for (const label of ['Subjective', 'Objective', 'Assessment', 'Plan']) await expect(page.getByLabel(label)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save now' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Amend' })).toHaveCount(0);
  await page.getByLabel('Plan').focus();
  await page.keyboard.type('must not edit');
  await expect(page.getByLabel('Plan')).not.toHaveValue(/must not edit/);

  const response = await request.post('/api/notes/note-8/versions', { data: {
    baseVersionId: 'version-8-1', clientMutationId: 'locked-direct-mutation',
    actor: { id: 'clinician-1', displayName: 'Clinician', roles: ['CLINICIAN'] },
    content: { subjective: 's', objective: 'o', assessment: 'a', plan: 'p' },
  } });
  expect(response.status()).toBe(403);
  await expect(response.json()).resolves.toMatchObject({ error: 'forbidden' });
});
