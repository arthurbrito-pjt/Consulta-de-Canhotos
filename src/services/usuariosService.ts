import { getApps, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  inMemoryPersistence,
  initializeAuth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { app, auth, db } from '../lib/firebase';
import { ehPerfil, type Perfil, type Usuario } from '../types';

/**
 * Criar a conta no Firebase Auth pelo navegador loga o novo usuário. Para não derrubar a sessão do
 * administrador, a criação usa uma SEGUNDA instância do app, com persistência só em memória.
 */
let authSecundario: Auth | null = null;
function obterAuthSecundario(): Auth {
  if (authSecundario) return authSecundario;
  const existente = getApps().find((a) => a.name === 'criacao-usuarios');
  const appSec = existente ?? initializeApp(app.options, 'criacao-usuarios');
  authSecundario = initializeAuth(appSec, { persistence: inMemoryPersistence });
  if (import.meta.env.VITE_USE_EMULATORS === 'true') {
    connectAuthEmulator(authSecundario, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  return authSecundario;
}

export interface NovoUsuario {
  nome: string;
  email: string;
  senha: string;
  perfil: Perfil;
  admin: boolean;
}

const usuariosRef = collection(db, 'usuarios');

function paraUsuario(uid: string, d: Record<string, unknown>): Usuario {
  return {
    uid,
    nome: typeof d.nome === 'string' ? d.nome : '(sem nome)',
    email: typeof d.email === 'string' ? d.email : undefined,
    perfil: ehPerfil(d.perfil) ? d.perfil : 'rotas',
    admin: d.admin === true,
    ativo: d.ativo !== false,
  };
}

export async function listarUsuarios(): Promise<Usuario[]> {
  const snap = await getDocs(query(usuariosRef, orderBy('nome')));
  return snap.docs.map((s) => paraUsuario(s.id, s.data()));
}

/** Cria a conta (Auth) e grava o perfil (usuarios/{uid}). Devolve o uid. */
export async function criarUsuario(novo: NovoUsuario, adminUid: string): Promise<string> {
  const email = novo.email.trim().toLowerCase();
  const nome = novo.nome.trim();
  const secundario = obterAuthSecundario();

  let uid: string;
  try {
    uid = (await createUserWithEmailAndPassword(secundario, email, novo.senha)).user.uid;
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/email-already-in-use') throw err;
    // Conta existe no Auth. Se ela não tem perfil (ex.: uma tentativa anterior que falhou ao gravar o
    // perfil) e a senha informada confere, reaproveita; caso contrário é um e-mail já cadastrado.
    const cred = await signInWithEmailAndPassword(secundario, email, novo.senha).catch(() => null);
    if (!cred || (await getDoc(doc(db, 'usuarios', cred.user.uid))).exists()) {
      throw Object.assign(new Error('E-mail já cadastrado'), { code: 'app/email-ja-cadastrado' });
    }
    uid = cred.user.uid;
  }
  await signOut(secundario);

  await setDoc(doc(db, 'usuarios', uid), {
    nome,
    email,
    perfil: novo.perfil,
    admin: novo.admin,
    ativo: true,
    criadoEm: serverTimestamp(),
    criadoPor: adminUid,
  });
  return uid;
}

export async function atualizarUsuario(
  uid: string,
  alteracoes: Partial<Pick<Usuario, 'nome' | 'perfil' | 'admin' | 'ativo'>>,
): Promise<void> {
  await updateDoc(doc(db, 'usuarios', uid), alteracoes);
}

/** Envia o e-mail padrão do Firebase para o usuário definir uma nova senha. */
export async function enviarRedefinicaoSenha(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** Senha inicial aleatória, sem caracteres ambíguos (0/O, 1/l/I). */
export function gerarSenha(tamanho = 10): string {
  const bytes = crypto.getRandomValues(new Uint32Array(tamanho));
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
}

export function mensagemErroUsuario(err: unknown): string {
  const code = (err as { code?: string }).code ?? '';
  switch (code) {
    case 'app/email-ja-cadastrado':
    case 'auth/email-already-in-use':
      return 'Este e-mail já está cadastrado.';
    case 'auth/invalid-email':
      return 'E-mail inválido.';
    case 'auth/weak-password':
      return 'Senha fraca: use ao menos 6 caracteres.';
    case 'auth/operation-not-allowed':
      return 'Login por e-mail/senha não está habilitado no Firebase.';
    case 'auth/network-request-failed':
    case 'unavailable':
      return 'Sem conexão com o servidor. Verifique a internet.';
    case 'permission-denied':
      return 'Você não tem permissão de administrador para esta operação.';
    default:
      return 'Não foi possível concluir a operação. Tente novamente.';
  }
}
