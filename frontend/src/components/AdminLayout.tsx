import {
  BarChart3, Bell, ClipboardList, Clock, Cpu, LayoutDashboard, LogOut, MapPin, Menu, MonitorSmartphone, ScrollText, Smartphone, Users, X,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import type { Role } from '../api';
import { useAuth } from '../auth';
import { ROLE_LABELS } from '../lib/format';
import { Logo, cx } from './ui';

const NAV: { to: string; label: string; icon: typeof Users; roles?: Role[] }[] = [
  { to: '/admin', label: 'Tableau de bord', icon: LayoutDashboard },
  { to: '/admin/employes', label: 'Employés', icon: Users },
  { to: '/admin/pointages', label: 'Pointages', icon: Clock },
  { to: '/admin/taches', label: 'Tâches', icon: ClipboardList },
  { to: '/admin/sites', label: 'Géolocalisation', icon: MapPin },
  { to: '/admin/rapports', label: 'Rapports', icon: BarChart3, roles: ['SUPER_ADMIN', 'ADMIN_RH', 'AGENT', 'DIRECTION'] },
  { to: '/kiosque', label: 'Poste de pointage', icon: MonitorSmartphone, roles: ['SUPER_ADMIN', 'ADMIN_RH', 'AGENT'] },
  { to: '/admin/terminaux', label: 'Terminaux', icon: Cpu, roles: ['SUPER_ADMIN', 'ADMIN_RH'] },
  { to: '/admin/audit', label: "Journal d'audit", icon: ScrollText, roles: ['SUPER_ADMIN', 'ADMIN_RH'] },
];

export function AdminLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => !n.roles || (user && n.roles.includes(user.role)));

  const sidebar = (
    <div className="flex h-full flex-col bg-navy-900 text-slate-300">
      <div className="flex items-center justify-between px-5 py-5">
        <Logo light />
        <button className="rounded-lg p-1 text-slate-400 hover:text-white lg:hidden" onClick={() => setOpen(false)} aria-label="Fermer le menu">
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {items.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/admin'}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition', isActive ? 'bg-brand-700 text-white shadow-lg shadow-black/20' : 'hover:bg-white/5 hover:text-white')
            }
          >
            <n.icon className="h-[18px] w-[18px]" /> {n.label}
          </NavLink>
        ))}
        <div className="my-3 border-t border-white/10" />
        <NavLink to="/moi" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-white/5 hover:text-white">
          <Smartphone className="h-[18px] w-[18px]" /> Mon espace employé
        </NavLink>
      </nav>
      <div className="border-t border-white/10 p-3">
        <button
          onClick={async () => { await logout(); nav('/connexion'); }}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-white/5 hover:text-white"
        >
          <LogOut className="h-[18px] w-[18px]" /> Déconnexion
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-[900] lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/50" />
          <aside className="absolute inset-y-0 left-0 w-72" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[500] flex items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Ouvrir le menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="lg:hidden"><Logo compact /></div>
          <div className="ml-auto flex items-center gap-3">
            <NavLink to="/moi/notifications" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Notifications">
              <Bell className="h-5 w-5" />
            </NavLink>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight text-slate-900">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-slate-500">{user && ROLE_LABELS[user.role]}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
              {user?.firstName[0]}{user?.lastName[0]}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

