import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Role } from './api';
import { isManager, useAuth } from './auth';
import { AdminLayout } from './components/AdminLayout';
import { EmployeeLayout } from './components/EmployeeLayout';
import { Spinner } from './components/ui';
import { Enroll } from './pages/Enroll';
import { Login } from './pages/Login';
import { AuditPage } from './pages/admin/Audit';
import { AttendancePage } from './pages/admin/Attendance';
import { Dashboard } from './pages/admin/Dashboard';
import { Employees } from './pages/admin/Employees';
import { Kiosk } from './pages/admin/Kiosk';
import { Reports } from './pages/admin/Reports';
import { Sites } from './pages/admin/Sites';
import { AdminTasks } from './pages/admin/Tasks';
import { Terminals } from './pages/admin/Terminals';
import { EmployeeHistory } from './pages/employee/History';
import { EmployeeHome } from './pages/employee/Home';
import { Notifications } from './pages/employee/Notifications';
import { Profile } from './pages/employee/Profile';
import { EmployeeTasks } from './pages/employee/Tasks';

function Guard({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/connexion" replace state={{ from: loc.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/moi" replace />;
  return <>{children}</>;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/connexion" replace />;
  return <Navigate to={isManager(user.role) ? '/admin' : '/moi'} replace />;
}

const MANAGERS: Role[] = ['SUPER_ADMIN', 'ADMIN_RH', 'AGENT', 'CHEF', 'DIRECTION'];

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/connexion" element={<Login />} />
      <Route path="/inscription" element={<Enroll />} />

      <Route path="/moi" element={<Guard><EmployeeLayout /></Guard>}>
        <Route index element={<EmployeeHome />} />
        <Route path="taches" element={<EmployeeTasks />} />
        <Route path="historique" element={<EmployeeHistory />} />
        <Route path="profil" element={<Profile />} />
        <Route path="notifications" element={<Notifications />} />
      </Route>

      <Route path="/kiosque" element={<Guard roles={['SUPER_ADMIN', 'ADMIN_RH', 'AGENT']}><Kiosk /></Guard>} />

      <Route path="/admin" element={<Guard roles={MANAGERS}><AdminLayout /></Guard>}>
        <Route index element={<Dashboard />} />
        <Route path="employes" element={<Employees />} />
        <Route path="pointages" element={<AttendancePage />} />
        <Route path="taches" element={<AdminTasks />} />
        <Route path="sites" element={<Sites />} />
        <Route path="rapports" element={<Guard roles={['SUPER_ADMIN', 'ADMIN_RH', 'AGENT', 'DIRECTION']}><Reports /></Guard>} />
        <Route path="terminaux" element={<Guard roles={['SUPER_ADMIN', 'ADMIN_RH']}><Terminals /></Guard>} />
        <Route path="audit" element={<Guard roles={['SUPER_ADMIN', 'ADMIN_RH']}><AuditPage /></Guard>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
