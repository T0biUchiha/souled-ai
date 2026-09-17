import { Link } from 'react-router-dom';

export function HomePage() {
  return (
    <section aria-labelledby="page-title">
      <p>Foundation</p>
      <h1 id="page-title">Clinical note review</h1>
      <p>The application shell is ready. Review workflow screens will be added in a later phase.</p>
    </section>
  );
}

export function NotFoundPage() {
  return (
    <section aria-labelledby="not-found-title">
      <h1 id="not-found-title">Page not found</h1>
      <Link to="/">Return home</Link>
    </section>
  );
}
