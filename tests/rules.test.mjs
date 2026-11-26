// Roda com: npm run test:rules  (sobe o emulador do Firestore automaticamente)
import { readFileSync } from 'node:fs';
import test, { before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-canhotos',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'usuarios/rotas1'), { nome: 'R', perfil: 'rotas' });
    await setDoc(doc(db, 'usuarios/fiscal1'), { nome: 'F', perfil: 'fiscal' });
    await setDoc(doc(db, 'usuarios/invalido1'), { nome: 'X', perfil: 'admin' });
    await setDoc(doc(db, 'usuarios/admin1'), { nome: 'A', email: 'a@x.com', perfil: 'rotas', admin: true });
    await setDoc(doc(db, 'usuarios/inativo1'), { nome: 'I', email: 'i@x.com', perfil: 'rotas', ativo: false });
    await setDoc(doc(db, 'canhotos/c1'), { numeroNota: '1' });
    await setDoc(doc(db, 'canhotos_imagens/c1'), { imagemBase64: 'AAAA', mimeType: 'image/jpeg' });
  });
});

const canhoto = (uid, extra = {}) => ({
  numeroNota: '123',
  cliente: 'Padaria Pão Quente',
  clienteBusca: 'padaria pao quente',
  dataAssinatura: Timestamp.fromDate(new Date()),
  criadoPor: uid,
  criadoEm: serverTimestamp(),
  ...extra,
});
const imagem = (extra = {}) => ({ imagemBase64: 'AAAA', mimeType: 'image/jpeg', ...extra });
const gravar = (db, c, i = imagem(), id = 'novo') => {
  const b = writeBatch(db);
  b.set(doc(db, 'canhotos', id), c);
  b.set(doc(db, 'canhotos_imagens', id), i);
  return b.commit();
};

test('anônimo não lê nada', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'canhotos/c1')));
  await assertFails(getDoc(doc(db, 'canhotos_imagens/c1')));
});

test('usuário sem perfil ou com perfil inválido não lê', async () => {
  await assertFails(getDoc(doc(env.authenticatedContext('semperfil').firestore(), 'canhotos/c1')));
  await assertFails(getDoc(doc(env.authenticatedContext('invalido1').firestore(), 'canhotos/c1')));
});

test('perfis de consulta leem canhoto e imagem', async () => {
  const db = env.authenticatedContext('fiscal1').firestore();
  await assertSucceeds(getDoc(doc(db, 'canhotos/c1')));
  await assertSucceeds(getDoc(doc(db, 'canhotos_imagens/c1')));
});

test('usuário lê só o próprio perfil; não escreve perfil', async () => {
  const db = env.authenticatedContext('rotas1').firestore();
  await assertSucceeds(getDoc(doc(db, 'usuarios/rotas1')));
  await assertFails(getDoc(doc(db, 'usuarios/fiscal1')));
  await assertFails(setDoc(doc(db, 'usuarios/rotas1'), { nome: 'R', perfil: 'rotas' }));
  await assertFails(setDoc(doc(db, 'usuarios/fiscal1'), { nome: 'F', perfil: 'rotas' }));
});

test('rotas cria canhoto + imagem (com e sem opcionais)', async () => {
  const db = env.authenticatedContext('rotas1').firestore();
  await assertSucceeds(gravar(db, canhoto('rotas1')));
  await assertSucceeds(gravar(db, canhoto('rotas1', { assinadoPor: 'João', observacao: 'ok' }), imagem(), 'n2'));
});

test('fiscal não cria', async () => {
  const db = env.authenticatedContext('fiscal1').firestore();
  await assertFails(gravar(db, canhoto('fiscal1')));
});

test('rotas não cria em nome de outro uid nem com criadoEm forjado', async () => {
  const db = env.authenticatedContext('rotas1').firestore();
  await assertFails(gravar(db, canhoto('outro')));
  await assertFails(gravar(db, canhoto('rotas1', { criadoEm: Timestamp.fromDate(new Date(2020, 0, 1)) })));
});

test('campos inválidos ou extras são rejeitados', async () => {
  const db = env.authenticatedContext('rotas1').firestore();
  await assertFails(gravar(db, canhoto('rotas1', { extra: 1 })));
  await assertFails(gravar(db, canhoto('rotas1', { numeroNota: '' })));
  await assertFails(gravar(db, canhoto('rotas1', { dataAssinatura: '2026-01-01' })));
  const semBusca = canhoto('rotas1');
  delete semBusca.clienteBusca;
  await assertFails(gravar(db, semBusca));
});

test('imagem: grande demais, tipo errado ou avulsa são rejeitadas', async () => {
  const db = env.authenticatedContext('rotas1').firestore();
  await assertFails(gravar(db, canhoto('rotas1'), imagem({ imagemBase64: 'A'.repeat(900001) })));
  await assertFails(gravar(db, canhoto('rotas1'), imagem({ mimeType: 'application/pdf' })));
  await assertSucceeds(gravar(db, canhoto('rotas1'), imagem({ imagemBase64: 'A'.repeat(900000) }), 'limite'));
  await assertFails(setDoc(doc(db, 'canhotos_imagens/orfa'), imagem()));
});

test('canhotos são imutáveis', async () => {
  const db = env.authenticatedContext('rotas1').firestore();
  await assertFails(updateDoc(doc(db, 'canhotos/c1'), { cliente: 'x' }));
  await assertFails(deleteDoc(doc(db, 'canhotos/c1')));
  await assertFails(deleteDoc(doc(db, 'canhotos_imagens/c1')));
});

// ---------- Módulo de usuários (admin) ----------
const novoUsuario = (uid, extra = {}) => ({
  nome: 'Novo', email: 'novo@x.com', perfil: 'fiscal', admin: false, ativo: true,
  criadoEm: serverTimestamp(), criadoPor: uid, ...extra,
});

test('admin cria, lê e lista usuários', async () => {
  const db = env.authenticatedContext('admin1').firestore();
  await assertSucceeds(setDoc(doc(db, 'usuarios/u2'), novoUsuario('admin1')));
  await assertSucceeds(setDoc(doc(db, 'usuarios/u3'), novoUsuario('admin1', { admin: true, perfil: 'comercial' })));
  await assertSucceeds(getDoc(doc(db, 'usuarios/fiscal1')));
  await assertSucceeds(getDocs(collection(db, 'usuarios')));
});

test('não-admin não cria, edita nem lista usuários', async () => {
  for (const uid of ['rotas1', 'fiscal1']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(setDoc(doc(db, 'usuarios/u2'), novoUsuario(uid)));
    await assertFails(updateDoc(doc(db, 'usuarios/fiscal1'), { perfil: 'rotas' }));
    await assertFails(getDocs(collection(db, 'usuarios')));
  }
});

test('ninguém se promove: não-admin não grava admin:true no próprio doc', async () => {
  const db = env.authenticatedContext('rotas1').firestore();
  await assertFails(updateDoc(doc(db, 'usuarios/rotas1'), { admin: true }));
  await assertFails(setDoc(doc(db, 'usuarios/rotas1'), { nome: 'R', email: 'r@x.com', perfil: 'rotas', admin: true }));
});

test('usuário desativado perde acesso aos dados, mas lê o próprio perfil', async () => {
  const db = env.authenticatedContext('inativo1').firestore();
  await assertFails(getDoc(doc(db, 'canhotos/c1')));
  await assertFails(gravar(db, canhoto('inativo1')));
  await assertSucceeds(getDoc(doc(db, 'usuarios/inativo1')));
});

test('admin edita outros (perfil, desativar) mas não a si mesmo', async () => {
  const db = env.authenticatedContext('admin1').firestore();
  await assertSucceeds(updateDoc(doc(db, 'usuarios/fiscal1'), { perfil: 'comercial' }));
  await assertSucceeds(updateDoc(doc(db, 'usuarios/rotas1'), { ativo: false }));
  await assertFails(updateDoc(doc(db, 'usuarios/admin1'), { admin: false }));
  await assertFails(updateDoc(doc(db, 'usuarios/admin1'), { ativo: false }));
  await assertSucceeds(updateDoc(doc(db, 'usuarios/admin1'), { nome: 'Admin Renomeado' }));
});

test('usuário de admin: dados inválidos e exclusão são rejeitados', async () => {
  const db = env.authenticatedContext('admin1').firestore();
  await assertFails(setDoc(doc(db, 'usuarios/u2'), novoUsuario('admin1', { perfil: 'admin' })));
  await assertFails(setDoc(doc(db, 'usuarios/u2'), novoUsuario('admin1', { extra: 1 })));
  await assertFails(setDoc(doc(db, 'usuarios/u2'), novoUsuario('admin1', { nome: '' })));
  await assertFails(setDoc(doc(db, 'usuarios/u2'), novoUsuario('outro')));
  await assertFails(deleteDoc(doc(db, 'usuarios/fiscal1')));
});

test('admin mantém acesso normal aos canhotos (é rotas)', async () => {
  const db = env.authenticatedContext('admin1').firestore();
  await assertSucceeds(gravar(db, canhoto('admin1'), imagem(), 'adm'));
});

// ---------- Substituição de canhoto duplicado ----------
const substituir = (db, id, campos = {}, img = imagem({ imagemBase64: 'BBBB' }), uid = 'rotas1') => {
  const b = writeBatch(db);
  b.update(doc(db, 'canhotos', id), {
    dataAssinatura: Timestamp.fromDate(new Date(2025, 0, 2)), assinadoPor: 'Novo',
    atualizadoPor: uid, atualizadoEm: serverTimestamp(), ...campos,
  });
  b.update(doc(db, 'canhotos_imagens', id), img);
  return b.commit();
};

test('rotas substitui canhoto existente (dados + foto), mesmo criado por outro', async () => {
  const db = env.authenticatedContext('rotas1').firestore();
  await assertSucceeds(gravar(db, canhoto('rotas1'), imagem(), 'dup'));
  const outro = env.authenticatedContext('admin1').firestore(); // admin também é rotas
  await assertSucceeds(substituir(outro, 'dup', {}, imagem({ imagemBase64: 'CCCC' }), 'admin1'));
});

test('substituição: não troca NF/cliente/autor, nem sem carimbo, nem por não-rotas', async () => {
  const db = env.authenticatedContext('rotas1').firestore();
  await assertSucceeds(gravar(db, canhoto('rotas1'), imagem(), 'dup'));
  await assertFails(substituir(db, 'dup', { numeroNota: '999' }));
  await assertFails(substituir(db, 'dup', { cliente: 'Outro', clienteBusca: 'outro' }));
  await assertFails(substituir(db, 'dup', { criadoPor: 'outro' }));
  await assertFails(substituir(db, 'dup', { atualizadoPor: 'outro' }));
  await assertFails(updateDoc(doc(db, 'canhotos/dup'), { assinadoPor: 'x' }));
  await assertFails(updateDoc(doc(db, 'canhotos_imagens/dup'), { imagemBase64: 'ZZZZ' }));
  const f = env.authenticatedContext('fiscal1').firestore();
  await assertFails(substituir(f, 'dup', {}, imagem(), 'fiscal1'));
});
