import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { PageHeader } from './components/ui';
import { CampaignPage } from './pages/Campaign';
import { DashboardPage } from './pages/Dashboard';
import { PlayerPage } from './pages/Player';
import { ReviewPage } from './pages/Review';
import { StatsPage } from './pages/Stats';

/** Router-agnostic so tests can mount it inside a MemoryRouter. */
export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/campaign" element={<Navigate to="/campaign/js" replace />} />
        <Route path="/campaign/:trackId" element={<CampaignPage />} />
        <Route path="/play/:unitId" element={<PlayerPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  );
}

function NotFound() {
  return (
    <>
      <PageHeader eyebrow="404" title="Nothing here" />
      <p>
        <Link to="/">Back to the dashboard</Link>
      </p>
    </>
  );
}
