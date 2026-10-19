import { Bell, ClipboardList, History, Home, LayoutDashboard, LogOut, User } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { isManager, useAuth } from '../auth';
import { Logo, cx } from './ui';

const TABS = [
  { to: '/moi', label: 'Accueil', icon: Home, end: true },
  { to: '/moi/taches', label: 'Tâches', icon: ClipboardList },
  { to: '/moi/historique', label: 'Historique', icon: History },
  { to: '/moi/profil', label: 'Profil', icon: User },
];

export function EmployeeLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-[500] bg-brand-700 text-white shadow-md shadow-brand-900/20">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Logo light />
          <div className="flex items-center gap-1">
            {isManager(user?.role) && (
              <NavLink to="/admin" className="rounded-lg p-2 hover:bg-white/10" aria-label="Administration" title="Administration">
                <LayoutDashboard className="h-5 w-5" />
              </NavLink>
            )}
            <NavLink to="/moi/notifications" className="rounded-lg p-2 hover:bg-white/10" aria-label="Notifications">
              <Bell className="h-5 w-5" />
            </NavLink>
            <button onClick={async () => { await logout(); nav('/connexion'); }} className="rounded-lg p-2 hover:bg-white/10" aria-label="Déconnexion" title="Déconnexion">
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-28 pt-5">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-[500] border-t border-slate-200 bg-white/95 backdrop-blur" aria-label="Navigation principale">
        <div className="mx-auto flex max-w-2xl">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => cx('flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium', isActive ? 'text-brand-700' : 'text-slate-500')}
            >
              <t.icon className="h-5 w-5" />
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
