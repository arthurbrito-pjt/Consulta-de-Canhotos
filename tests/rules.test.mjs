// Roda com: npm run test:rules  (sobe o emulador do Firestore automaticamente)
import { readFileSync } from 'node:fs';
import test, { before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';

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
