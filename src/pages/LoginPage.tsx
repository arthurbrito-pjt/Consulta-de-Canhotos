import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { mensagemErroLogin, useAuth } from '../contexts/AuthContext';
import { Carregando, Erro } from '../components/Feedback';

export function LoginPage() {
  const { user, carregando, entrar } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (carregando) return <Carregando tela />;
  if (user) {
    const destino = (location.state as { de?: string } | null)?.de ?? '/consulta';
    return <Navigate to={destino} replace />;
  }

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email, senha);
    } catch (err) {
      setErro(mensagemErroLogin(err));
      setEnviando(false);
    }
  }

  return (
    <div className="login">
      <form className="cartao" onSubmit={aoEnviar}>
        <h1>Consulta de Canhotos</h1>
        <p className="muted">Entre com seu e-mail e senha.</p>

        <label className="campo">
          <span>E-mail</span>
          <input
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="campo">
          <span>Senha</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </label>

        {erro && <Erro>{erro}</Erro>}

        <button type="submit" className="btn btn-primario" disabled={enviando}>
          {enviando ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
