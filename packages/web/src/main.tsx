import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, type Me } from './api.ts';
import { Pipeline } from './pages/Pipeline.tsx';
import { Attention } from './pages/Attention.tsx';
import { Account } from './pages/Account.tsx';
import { NewOpportunity } from './pages/NewOpportunity.tsx';
import { Admin } from './pages/Admin.tsx';
import { HowItWorks } from './pages/HowItWorks.tsx';
import './styles.css';

function App() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

  const link = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');

  return (
    <BrowserRouter>
      <header className="top">
        <div className="inner">
          <span className="brand">Customer Success</span>
          <nav>
            <NavLink to="/" end className={link}>
              Pipeline
            </NavLink>
            <NavLink to="/attention" className={link}>
              Attention
            </NavLink>
            <NavLink to="/people" className={link}>
              People
            </NavLink>
            <NavLink to="/how-it-works" className={link}>
              How it works
            </NavLink>
          </nav>
          {me ? (
            <span className="who">
              {me.email.replace('@bah.com', '')} <span className="role-tag">{me.role}</span>
            </span>
          ) : null}
        </div>
      </header>
      <main className="shell">
        <Routes>
          <Route path="/" element={<Pipeline />} />
          <Route path="/attention" element={<Attention />} />
          <Route path="/new" element={<NewOpportunity />} />
          <Route path="/a/:slug" element={<Account />} />
          <Route path="/people" element={<Admin />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          {/* Old paths from the first version. */}
          <Route path="/customers/:slug" element={<LegacyAccount />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

/** Redirects the previous /customers/:slug URLs to the shorter /a/:slug. */
function LegacyAccount() {
  const slug = window.location.pathname.split('/').pop() ?? '';
  return <Navigate to={`/a/${slug}`} replace />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
