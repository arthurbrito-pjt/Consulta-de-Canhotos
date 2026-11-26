// Cria usuários no Firebase Auth e grava o perfil em usuarios/{uid}.
//
// Uso (produção):
//   1. Baixe uma chave de serviço (Console > Configurações > Contas de serviço) e salve fora do repositório.
//   2. $env:GOOGLE_APPLICATION_CREDENTIALS="C:\caminho\serviceAccountKey.json"
//   3. Copie scripts/usuarios.seed.example.json para scripts/usuarios.seed.json e edite.
//   4. npm run seed
//
// Uso (emuladores): npm run seed:emulador  (com `npm run emulators` rodando)

import { readFile } from 'node:fs/promises';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PERFIS = ['rotas', 'fiscal', 'comercial', 'gestao_rotas'];
const emulador = process.argv.includes('--emulador');

if (emulador) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
}

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
initializeApp(emulador ? { projectId: projectId || 'demo-canhotos' } : { credential: applicationDefault(), projectId });

const arquivo = new URL('./usuarios.seed.json', import.meta.url);
const usuarios = JSON.parse(await readFile(arquivo, 'utf8'));
const auth = getAuth();
const db = getFirestore();

for (const u of usuarios) {
  if (!u.email || !u.senha || !u.nome || !PERFIS.includes(u.perfil)) {
    console.error(`Entrada inválida (precisa de email, senha, nome e perfil em ${PERFIS.join('|')}):`, u.email);
    process.exitCode = 1;
    continue;
  }
  let registro;
  try {
    registro = await auth.getUserByEmail(u.email);
    await auth.updateUser(registro.uid, { displayName: u.nome });
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    registro = await auth.createUser({ email: u.email, password: u.senha, displayName: u.nome });
  }
  await db.doc(`usuarios/${registro.uid}`).set({
    nome: u.nome,
    email: u.email,
    perfil: u.perfil,
    ...(u.admin ? { admin: true } : {}),
  }, { merge: true });
  console.log(`OK  ${u.email}  ->  ${u.perfil}  (${registro.uid})`);
}
