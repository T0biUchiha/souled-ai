import { expect, test } from '@playwright/test';

const reviewerB = { id: 'reviewer-2', displayName: 'Reviewer B', roles: ['REVIEWER'] };

test('an unassigned reviewer receives accessible UI guards and server authorization rejection', async ({ page, request }) => {
  await request.post('/api/dev/seed', { data: { count: 20 } });
  await page.addInitScript((user) => sessionStorage.setItem('clinical-note-mock-current-user', JSON.stringify(user)), reviewerB);
  await page.goto('/notes/note-4');
  const returnButton = page.getByRole('button', { name: 'Return to queue' });
  await expect(returnButton).toBeDisabled();
  await expect(returnButton).toHaveAttribute('aria-describedby', 'return-reason');
  await expect(page.locator('#return-reason')).toContainText('assigned reviewer');
  await expect(page.getByLabel('Plan')).toBeDisabled();

  const actor = reviewerB;
  const save = await request.post('/api/notes/note-4/versions', { data: {
    baseVersionId: 'version-4-1', clientMutationId: 'reviewer-b-save', actor,
    content: { subjective: 's', objective: 'o', assessment: 'a', plan: 'p' },
  } });
  expect(save.status()).toBe(403);
  const transition = await request.post('/api/notes/note-4/transitions', { data: { action: { type: 'return' }, actor, mfaReauthenticated: true } });
  expect(transition.status()).toBe(403);
});

test('the assigned reviewer can edit and perform a valid protected transition', async ({ page, request }) => {
  await request.post('/api/dev/seed', { data: { count: 20 } });
  const reviewerA = { id: 'reviewer-4', displayName: 'Reviewer A', roles: ['REVIEWER', 'CLINICIAN'] };
  await page.addInitScript((user) => sessionStorage.setItem('clinical-note-mock-current-user', JSON.stringify(user)), reviewerA);
  await page.goto('/notes/note-4');
  await expect(page.getByLabel('Assessment')).toBeEditable();
  await expect(page.getByRole('button', { name: 'Return to queue' })).toBeEnabled();
  const transition = await request.post('/api/notes/note-4/transitions', { data: { action: { type: 'return' }, actor: reviewerA, mfaReauthenticated: true } });
  expect(transition.status()).toBe(200);
});
