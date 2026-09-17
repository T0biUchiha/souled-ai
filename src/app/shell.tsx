import { Link, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import './styles.css';
import { ConnectivityStatus } from '../data/offline-sync';
import { telemetry } from '../telemetry/client';

export function AppShell() {
  const location = useLocation();
  useEffect(() => {
    void telemetry.onRouteChange().finally(() => telemetry.track('route_viewed', { path: location.pathname }));
  }, [location.pathname]);
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
