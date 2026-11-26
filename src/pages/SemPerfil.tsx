import { useAuth } from '../contexts/AuthContext';
import { Erro } from '../components/Feedback';

export function SemPerfil() {
  const { erroPerfil, sair } = useAuth();
  return (
    <div className="login">
      <div className="cartao">
        <h1>Acesso pendente</h1>
        <Erro>{erroPerfil ?? 'Perfil de acesso não encontrado.'}</Erro>
        <button type="button" className="btn btn-secundario" onClick={() => void sair()}>
          Sair
        </button>
      </div>
    </div>
  );
}
