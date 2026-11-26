import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { ConsultaPage } from './pages/ConsultaPage';
import { DigitalizacaoPage } from './pages/DigitalizacaoPage';
import { UsuariosPage } from './pages/UsuariosPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Qualquer perfil autenticado */}
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/consulta" element={<ConsultaPage />} />

          {/* Somente Rotas */}
          <Route element={<ProtectedRoute perfis={['rotas']} />}>
            <Route path="/digitalizar" element={<DigitalizacaoPage />} />
          </Route>

          {/* Somente administradores */}
          <Route element={<ProtectedRoute admin />}>
            <Route path="/usuarios" element={<UsuariosPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/consulta" replace />} />
    </Routes>
  );
}
