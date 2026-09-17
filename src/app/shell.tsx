import { Link, Outlet } from 'react-router-dom';
import './styles.css';
import { ConnectivityStatus } from '../data/offline-sync';

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" to="/">
          Clinical Note Review
        </Link>
        {' · '}<Link className="brand" to="/notes">Notes</Link>
        <ConnectivityStatus />
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
