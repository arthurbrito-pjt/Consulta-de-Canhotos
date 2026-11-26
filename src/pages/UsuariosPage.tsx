import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Carregando, Erro, Vazio } from '../components/Feedback';
import { useAuth } from '../contexts/AuthContext';
import {
  atualizarUsuario,
  criarUsuario,
  enviarRedefinicaoSenha,
  gerarSenha,
  listarUsuarios,
  mensagemErroUsuario,
} from '../services/usuariosService';
import { PERFIS, PERFIL_ROTULO, type Perfil, type Usuario } from '../types';

interface Formulario {
  nome: string;
  email: string;
  senha: string;
  perfil: Perfil;
  admin: boolean;
}

const VAZIO: Formulario = { nome: '', email: '', senha: '', perfil: 'rotas', admin: false };

export function UsuariosPage() {
  const { user } = useAuth();
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState<Formulario>(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [criado, setCriado] = useState<{ nome: string; email: string; senha: string } | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const carregar = useCallback(async () => {
    setErroLista(null);
    try {
      setUsuarios(await listarUsuarios());
    } catch (err) {
      setErroLista(mensagemErroUsuario(err));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function abrirFormulario() {
    setForm({ ...VAZIO, senha: gerarSenha() });
    setErroForm(null);
    setCriado(null);
    setCriando(true);
  }

  async function aoCriar(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (form.nome.trim().length < 2) return setErroForm('Informe o nome do usuário.');
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return setErroForm('Informe um e-mail válido.');
    if (form.senha.length < 6) return setErroForm('A senha precisa ter ao menos 6 caracteres.');

    setSalvando(true);
    setErroForm(null);
    try {
      await criarUsuario(form, user.uid);
      setCriado({ nome: form.nome.trim(), email: form.email.trim().toLowerCase(), senha: form.senha });
      setCriando(false);
      await carregar();
    } catch (err) {
      setErroForm(mensagemErroUsuario(err));
    } finally {
      setSalvando(false);
    }
  }

  async function alterar(u: Usuario, alteracoes: Partial<Pick<Usuario, 'perfil' | 'admin' | 'ativo'>>, texto: string) {
    setOcupado(u.uid);
    setAviso(null);
    try {
      await atualizarUsuario(u.uid, alteracoes);
      setUsuarios((lista) => lista?.map((x) => (x.uid === u.uid ? { ...x, ...alteracoes } : x)) ?? null);
      setAviso({ tipo: 'ok', texto });
    } catch (err) {
      setAviso({ tipo: 'erro', texto: mensagemErroUsuario(err) });
    } finally {
      setOcupado(null);
    }
  }

  async function redefinir(u: Usuario) {
    if (!u.email) return;
    setOcupado(u.uid);
    setAviso(null);
    try {
      await enviarRedefinicaoSenha(u.email);
      setAviso({ tipo: 'ok', texto: `E-mail de redefinição de senha enviado para ${u.email}.` });
    } catch (err) {
      setAviso({ tipo: 'erro', texto: mensagemErroUsuario(err) });
    } finally {
      setOcupado(null);
    }
  }

  async function copiarAcesso() {
    if (!criado) return;
    try {
      await navigator.clipboard.writeText(`Acesso ao sistema de Canhotos\nE-mail: ${criado.email}\nSenha: ${criado.senha}`);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // sem permissão de área de transferência: o admin copia manualmente
    }
  }

  return (
    <div className="usuarios">
      <div className="usuarios-topo">
        <div>
          <h1>Usuários</h1>
          <p className="muted pequeno">Crie acessos e defina o perfil de cada pessoa.</p>
        </div>
        {!criando && (
          <button type="button" className="btn btn-primario" onClick={abrirFormulario}>
            Novo usuário
          </button>
        )}
      </div>

      {criado && (
        <div className="alerta alerta-ok credencial" role="status">
          <strong>Usuário {criado.nome} criado.</strong>
          <span>
            E-mail: <b>{criado.email}</b>
          </span>
          <span>
            Senha inicial: <b className="senha">{criado.senha}</b>
          </span>
          <span className="pequeno">Esta senha não aparece de novo: copie e envie para a pessoa agora.</span>
          <div className="acoes-linha">
            <button type="button" className="btn-pequeno" onClick={() => void copiarAcesso()}>
              {copiado ? 'Copiado ✓' : 'Copiar acesso'}
            </button>
            <button type="button" className="btn-pequeno" onClick={() => setCriado(null)}>
              Entendi
            </button>
          </div>
        </div>
      )}

      {criando && (
        <form className="cartao" onSubmit={aoCriar}>
          <h2>Novo usuário</h2>
          <label className="campo">
            <span>Nome *</span>
            <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoComplete="off" />
          </label>
          <label className="campo">
            <span>E-mail *</span>
            <input
              type="email"
              inputMode="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              autoComplete="off"
            />
          </label>
          <label className="campo">
            <span>Perfil *</span>
            <select value={form.perfil} onChange={(e) => setForm({ ...form, perfil: e.target.value as Perfil })}>
              {PERFIS.map((p) => (
                <option key={p} value={p}>
                  {PERFIL_ROTULO[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Senha inicial *</span>
            <div className="busca">
              <input value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} autoComplete="off" />
              <button type="button" className="btn btn-secundario" onClick={() => setForm({ ...form, senha: gerarSenha() })}>
                Gerar outra
              </button>
            </div>
          </label>
          <label className="marcar">
            <input type="checkbox" checked={form.admin} onChange={(e) => setForm({ ...form, admin: e.target.checked })} />
            <span>
              <b>Administrador</b>
              <small className="muted"> — pode criar e gerenciar usuários</small>
            </span>
          </label>

          {erroForm && <Erro>{erroForm}</Erro>}

          <div className="acoes">
            <button type="submit" className="btn btn-primario" disabled={salvando}>
              {salvando ? 'Criando...' : 'Criar usuário'}
            </button>
            <button type="button" className="btn btn-secundario" disabled={salvando} onClick={() => setCriando(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {aviso && (
        <div className={aviso.tipo === 'ok' ? 'alerta alerta-ok' : 'alerta alerta-erro'} role={aviso.tipo === 'ok' ? 'status' : 'alert'}>
          {aviso.texto}
        </div>
      )}

      {usuarios === null && !erroLista && <Carregando texto="Carregando usuários..." />}
      {erroLista && <Erro>{erroLista}</Erro>}
      {usuarios && usuarios.length === 0 && <Vazio>Nenhum usuário cadastrado.</Vazio>}

      {usuarios && usuarios.length > 0 && (
        <ul className="lista" aria-label="Usuários">
          {usuarios.map((u) => {
            const eu = u.uid === user?.uid;
            const trabalhando = ocupado === u.uid;
            return (
              <li key={u.uid} className={u.ativo ? 'usuario-card' : 'usuario-card inativo'}>
                <div className="usuario-id">
                  <strong>{u.nome}</strong>
                  {eu && <span className="etiqueta etiqueta-azul">Você</span>}
                  {u.admin && <span className="etiqueta etiqueta-azul">Admin</span>}
                  {!u.ativo && <span className="etiqueta etiqueta-cinza">Desativado</span>}
                  <span className="muted pequeno">{u.email ?? 'e-mail não registrado'}</span>
                </div>
                <div className="usuario-acoes">
                  <label className="campo-inline">
                    <span className="rotulo">Perfil</span>
                    <select
                      value={u.perfil}
                      disabled={trabalhando}
                      onChange={(e) =>
                        void alterar(u, { perfil: e.target.value as Perfil }, `Perfil de ${u.nome} alterado para ${PERFIL_ROTULO[e.target.value as Perfil]}.`)
                      }
                    >
                      {PERFIS.map((p) => (
                        <option key={p} value={p}>
                          {PERFIL_ROTULO[p]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="botoes-linha">
                    {!eu && (
                      <button
                        type="button"
                        className="btn-pequeno"
                        disabled={trabalhando}
                        onClick={() =>
                          void alterar(u, { admin: !u.admin }, u.admin ? `${u.nome} deixou de ser administrador.` : `${u.nome} agora é administrador.`)
                        }
                      >
                        {u.admin ? 'Remover admin' : 'Tornar admin'}
                      </button>
                    )}
                    {u.email && (
                      <button type="button" className="btn-pequeno" disabled={trabalhando} onClick={() => void redefinir(u)}>
                        Redefinir senha
                      </button>
                    )}
                    {!eu && (
                      <button
                        type="button"
                        className={u.ativo ? 'btn-pequeno perigo' : 'btn-pequeno'}
                        disabled={trabalhando}
                        onClick={() => {
                          if (u.ativo && !window.confirm(`Desativar ${u.nome}? A pessoa perde o acesso ao sistema.`)) return;
                          void alterar(u, { ativo: !u.ativo }, u.ativo ? `${u.nome} foi desativado.` : `${u.nome} foi reativado.`);
                        }}
                      >
                        {u.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
