import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Role, type User } from './api';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: User }>('/auth/me');
      setUser(r.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setUser(null);
  }, []);

  useEffect(() => {
    refresh();
    const onLogout = () => setUser(null);
    window.addEventListener('pp:logout', onLogout);
    return () => window.removeEventListener('pp:logout', onLogout);
  }, [refresh]);

  return <Ctx.Provider value={{ user, loading, refresh, setUser, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export const MANAGEMENT: Role[] = ['SUPER_ADMIN', 'ADMIN_RH', 'AGENT', 'CHEF', 'DIRECTION'];
export const isManager = (r?: Role) => !!r && MANAGEMENT.includes(r);
export const isAdmin = (r?: Role) => r === 'SUPER_ADMIN' || r === 'ADMIN_RH';
