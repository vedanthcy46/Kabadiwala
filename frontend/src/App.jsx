import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { I18nProvider } from './i18n/I18nProvider';
import { Navbar } from './components/Navbar';
import { OfflineIndicator } from './components/OfflineIndicator';
import { initSyncManager } from './services/offline/syncManager';
import { getSession } from './services/auth';

// Collector pages
import CollectorDashboard from './collector/Dashboard';
import CreateLot from './collector/CreateLot';
import MatchedRecyclers from './collector/MatchedRecyclers';
import PriceDiscovery from './collector/PriceDiscovery';
import CollectorLotDetail from './collector/LotDetail';
import CollectorTraceability from './collector/Traceability';
import EarningsLedger from './collector/Earnings';

// Recycler pages
import RecyclerPortal from './recycler/Portal';
import LotDetail from './recycler/LotDetail';
import RecyclerScan from './recycler/Scan';

// Shared pages
import SafetyGuidance from './pages/Safety';
import CollectorLogin from './pages/CollectorLogin';
import RecyclerLogin from './pages/RecyclerLogin';
import AdminLogin from './pages/AdminLogin';
import Register from './pages/Register';
import Admin from './pages/Admin';
import Landing from './pages/Landing';

function ProtectedRoute({ role, children }) {
  const user = getSession();
  const location = useLocation();
  if (!user?.userId) return <Navigate to="/" replace state={{ from: location }} />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children;
}

function AppInner() {
  const location = useLocation();
  const user = getSession();

  useEffect(() => {
    initSyncManager();
  }, []);

  const isLandingPage = location.pathname === '/';
  const isAuthPage = [
    '/login',
    '/login/collector',
    '/login/recycler',
    '/login/admin',
    '/collector/register',
  ].includes(location.pathname);
  const showNavbar = !isLandingPage && !isAuthPage && !(location.pathname === '/admin' && user?.role !== 'admin');

  // Root: redirect logged-in users to their dashboard
  if (location.pathname === '/') {
    if (user?.role === 'collector') return <Navigate to="/collector" replace />;
    if (user?.role === 'recycler') return <Navigate to="/recycler" replace />;
    if (user?.role === 'admin') return <Navigate to="/admin" replace />;
  }

  return (
    <div className="page-shell">
      {showNavbar && <Navbar />}
      <main className="page-content" id="main-content">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Navigate to="/login/collector" replace />} />
          <Route path="/login/collector" element={<CollectorLogin />} />
          <Route path="/login/recycler" element={<RecyclerLogin />} />
          <Route path="/login/admin" element={<AdminLogin />} />
          <Route path="/collector/register" element={<Register />} />

          {/* Admin - handles its own auth */}
          <Route path="/admin" element={<Admin />} />

          {/* Collector routes */}
          <Route path="/collector" element={
            <ProtectedRoute role="collector"><CollectorDashboard /></ProtectedRoute>
          } />
          <Route path="/collector/create-lot" element={
            <ProtectedRoute role="collector"><CreateLot /></ProtectedRoute>
          } />
          <Route path="/collector/matched-recyclers" element={
            <ProtectedRoute role="collector"><MatchedRecyclers /></ProtectedRoute>
          } />
          <Route path="/collector/prices" element={
            <ProtectedRoute role="collector"><PriceDiscovery /></ProtectedRoute>
          } />
          <Route path="/collector/earnings" element={
            <ProtectedRoute role="collector"><EarningsLedger /></ProtectedRoute>
          } />
          <Route path="/collector/lots/:lotId" element={
            <ProtectedRoute role="collector"><CollectorLotDetail /></ProtectedRoute>
          } />
          <Route path="/collector/lots/:lotId/trace" element={
            <ProtectedRoute role="collector"><CollectorTraceability /></ProtectedRoute>
          } />

          {/* Recycler routes */}
          <Route path="/recycler" element={
            <ProtectedRoute role="recycler"><RecyclerPortal /></ProtectedRoute>
          } />
          <Route path="/recycler/scan" element={
            <ProtectedRoute role="recycler"><RecyclerScan /></ProtectedRoute>
          } />
          <Route path="/recycler/lots" element={
            <ProtectedRoute role="recycler"><Navigate to="/recycler" replace /></ProtectedRoute>
          } />
          <Route path="/recycler/profile" element={
            <ProtectedRoute role="recycler"><Navigate to="/recycler" replace /></ProtectedRoute>
          } />
          <Route path="/recycler/lots/:lotId" element={
            <ProtectedRoute role="recycler"><LotDetail /></ProtectedRoute>
          } />

          {/* Safety is public */}
          <Route path="/safety" element={<SafetyGuidance />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {!isLandingPage && <OfflineIndicator />}
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <AppInner />
      </BrowserRouter>
    </I18nProvider>
  );
}
