import { Link, Outlet } from 'react-router-dom';
import './styles.css';

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" to="/">
          Clinical Note Review
        </Link>
        {' · '}<Link className="brand" to="/notes">Notes</Link>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
