import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api.ts';
import { Leadership } from './pages/Leadership.tsx';
import { Customers } from './pages/Customers.tsx';
import { CustomerDetail } from './pages/CustomerDetail.tsx';
import { NewCustomer } from './pages/NewCustomer.tsx';
import './styles.css';

function App() {
  const [who, setWho] = useState('');

  useEffect(() => {
    api.me().then((m) => setWho(`${m.email} · ${m.role}`)).catch(() => setWho(''));
  }, []);

  return (
    <BrowserRouter>
      <header className="top">
        <div className="inner">
          <span className="brand">Customer Success</span>
          <nav>
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
              Portfolio
            </NavLink>
            <NavLink to="/customers" className={({ isActive }) => (isActive ? 'active' : '')}>
              Customers
            </NavLink>
          </nav>
          <span className="who">{who}</span>
        </div>
      </header>
      <main className="shell">
        <Routes>
          <Route path="/" element={<Leadership />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/new" element={<NewCustomer />} />
          <Route path="/customers/:slug" element={<CustomerDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
