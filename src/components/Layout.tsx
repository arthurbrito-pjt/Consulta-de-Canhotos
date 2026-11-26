import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { PERFIL_ROTULO } from '../types';

export function Layout() {
  const { nome, perfil, sair } = useAuth();

  return (
    <div className="app">
      <header className="topo">
        <div className="topo-linha">
          <strong className="marca">Canhotos</strong>
          <div className="usuario">
            <span className="usuario-nome">{nome}</span>
            {perfil && <span className="selo">{PERFIL_ROTULO[perfil]}</span>}
            <button type="button" className="btn btn-link" onClick={() => void sair()}>
              Sair
            </button>
          </div>
        </div>
        <nav className="abas" aria-label="Navegação principal">
          <NavLink to="/consulta" className={({ isActive }) => (isActive ? 'aba ativa' : 'aba')}>
            Consulta
          </NavLink>
          {perfil === 'rotas' && (
            <NavLink to="/digitalizar" className={({ isActive }) => (isActive ? 'aba ativa' : 'aba')}>
              Digitalizar
            </NavLink>
          )}
        </nav>
      </header>
      <main className="conteudo">
        <Outlet />
      </main>
    </div>
  );
}
