import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { Perfil } from '../types';
import { Carregando } from './Feedback';
import { SemPerfil } from '../pages/SemPerfil';

/** Exige login e, opcionalmente, um dos perfis informados e/ou ser administrador. */
export function ProtectedRoute({ perfis, admin: exigeAdmin }: { perfis?: Perfil[]; admin?: boolean }) {
  const { user, perfil, admin, carregando } = useAuth();
  const location = useLocation();

  if (carregando) return <Carregando texto="Verificando acesso..." tela />;
  if (!user) return <Navigate to="/login" replace state={{ de: location.pathname }} />;
  if (!perfil) return <SemPerfil />;
  if (exigeAdmin && !admin) return <Navigate to="/consulta" replace />;
  if (perfis && !perfis.includes(perfil)) return <Navigate to="/consulta" replace />;
  return <Outlet />;
}
