export const demoReviewers = Array.from({ length: 12 }, (_, index) => ({
  id: `reviewer-${index + 1}`,
  displayName: `Reviewer ${index + 1}`,
}));

export const isDemoReviewer = (reviewerId: string): boolean => demoReviewers.some((reviewer) => reviewer.id === reviewerId);
