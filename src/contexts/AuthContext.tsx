import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { ehPerfil, type Perfil } from '../types';

interface AuthState {
  user: User | null;
  nome: string | null;
  perfil: Perfil | null;
  /** true enquanto verifica sessão e carrega o perfil */
  carregando: boolean;
  /** preenchido quando o usuário autenticou mas não tem perfil válido */
  erroPerfil: string | null;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [nome, setNome] = useState<string | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroPerfil, setErroPerfil] = useState<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setCarregando(true);
      setErroPerfil(null);
      if (!u) {
        setUser(null);
        setNome(null);
        setPerfil(null);
        setCarregando(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'usuarios', u.uid));
        const dados = snap.data();
        if (snap.exists() && ehPerfil(dados?.perfil)) {
          setNome(typeof dados?.nome === 'string' ? dados.nome : (u.email ?? ''));
          setPerfil(dados.perfil);
        } else {
          setNome(u.email);
          setPerfil(null);
          setErroPerfil('Seu usuário ainda não tem um perfil de acesso. Fale com o administrador.');
        }
      } catch {
        setPerfil(null);
        setErroPerfil('Não foi possível carregar seu perfil. Verifique a conexão e tente novamente.');
      }
      setUser(u);
      setCarregando(false);
    });
  }, []);

  const valor = useMemo<AuthState>(
    () => ({
      user,
      nome,
      perfil,
      carregando,
      erroPerfil,
      entrar: async (email, senha) => {
        await signInWithEmailAndPassword(auth, email.trim(), senha);
      },
      sair: () => signOut(auth),
    }),
    [user, nome, perfil, carregando, erroPerfil],
  );

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>.');
  return ctx;
}

export function mensagemErroLogin(err: unknown): string {
  const code = (err as { code?: string }).code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'E-mail ou senha incorretos.';
    case 'auth/user-disabled':
      return 'Este usuário está desativado.';
    case 'auth/too-many-requests':
      return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
    case 'auth/network-request-failed':
      return 'Sem conexão. Verifique a internet.';
    default:
      return 'Não foi possível entrar. Tente novamente.';
  }
}
