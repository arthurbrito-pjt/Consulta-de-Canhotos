import {
  Timestamp,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { dataDeISO, fimDoDia, inicioDoDia } from '../lib/datas';
import { normalizarBusca, normalizarNota } from '../lib/texto';
import type { Canhoto, CanhotoImagem, NovoCanhoto } from '../types';

export const LIMITE_RESULTADOS = 50;
const canhotosRef = collection(db, 'canhotos');

function paraCanhoto(snap: QueryDocumentSnapshot<DocumentData>): Canhoto {
  const d = snap.data();
  return {
    id: snap.id,
    numeroNota: d.numeroNota,
    cliente: d.cliente,
    clienteBusca: d.clienteBusca,
    dataAssinatura: (d.dataAssinatura as Timestamp).toDate(),
    assinadoPor: d.assinadoPor ?? undefined,
    observacao: d.observacao ?? undefined,
    criadoPor: d.criadoPor,
    criadoEm: (d.criadoEm as Timestamp).toDate(),
  };
}

/** Igualdade exata em numeroNota. Índice composto: numeroNota ASC + dataAssinatura DESC. */
export async function buscarPorNota(termo: string): Promise<Canhoto[]> {
  const nota = normalizarNota(termo);
  if (!nota) return [];
  const q = query(
    canhotosRef,
    where('numeroNota', '==', nota),
    orderBy('dataAssinatura', 'desc'),
    limit(LIMITE_RESULTADOS),
  );
  return (await getDocs(q)).docs.map(paraCanhoto);
}

/** Prefixo em clienteBusca (>= termo, <= termo + ). Índice de campo único (automático). */
export async function buscarPorCliente(termo: string): Promise<Canhoto[]> {
  const prefixo = normalizarBusca(termo);
  if (!prefixo) return [];
  const q = query(
    canhotosRef,
    where('clienteBusca', '>=', prefixo),
    where('clienteBusca', '<=', prefixo + ''),
    orderBy('clienteBusca'),
    limit(LIMITE_RESULTADOS),
  );
  const lista = (await getDocs(q)).docs.map(paraCanhoto);
  // O Firestore exige ordenar pelo campo do range; reordena por data (mais recente primeiro).
  return lista.sort((a, b) => b.dataAssinatura.getTime() - a.dataAssinatura.getTime());
}

/** Do início ao fim do dia em dataAssinatura. Índice de campo único (automático). */
export async function buscarPorData(iso: string): Promise<Canhoto[]> {
  const dia = dataDeISO(iso);
  if (!dia) return [];
  const q = query(
    canhotosRef,
    where('dataAssinatura', '>=', Timestamp.fromDate(inicioDoDia(dia))),
    where('dataAssinatura', '<=', Timestamp.fromDate(fimDoDia(dia))),
    orderBy('dataAssinatura', 'desc'),
    limit(LIMITE_RESULTADOS),
  );
  return (await getDocs(q)).docs.map(paraCanhoto);
}

/** Últimos canhotos digitalizados (tela inicial da consulta). Índice de campo único (automático). */
export async function buscarRecentes(): Promise<Canhoto[]> {
  const q = query(canhotosRef, orderBy('criadoEm', 'desc'), limit(20));
  return (await getDocs(q)).docs.map(paraCanhoto);
}

/** Foto do verso (opcional) do canhoto. */
export async function obterVerso(id: string): Promise<CanhotoImagem | null> {
  const snap = await getDoc(doc(db, 'canhotos_versos', id));
  if (!snap.exists()) return null;
  const d = snap.data();
  return { imagemBase64: d.imagemBase64, mimeType: d.mimeType };
}

/** Carrega a foto só quando o usuário abre os detalhes. */
export async function obterImagem(id: string): Promise<CanhotoImagem | null> {
  const snap = await getDoc(doc(db, 'canhotos_imagens', id));
  if (!snap.exists()) return null;
  const d = snap.data();
  return { imagemBase64: d.imagemBase64, mimeType: d.mimeType };
}

/**
 * Procura, para cada par (NF, cliente), um canhoto já salvo com a mesma NF e o mesmo cliente
 * (duplicidade). Devolve, na mesma ordem, o canhoto mais recente encontrado ou null.
 */
export async function encontrarDuplicados(
  chaves: { numeroNota: string; cliente: string }[],
): Promise<(Canhoto | null)[]> {
  return Promise.all(
    chaves.map(async ({ numeroNota, cliente }) => {
      const alvo = normalizarBusca(cliente);
      const achados = await buscarPorNota(numeroNota);
      return achados.find((c) => c.clienteBusca === alvo) ?? null;
    }),
  );
}

/**
 * Grava um ou vários canhotos (cada um com sua imagem) de forma atômica: ou salva todos, ou nenhum.
 * Limite de 20 por lote (cada imagem pode ter até ~700 KB e o commit aceita 10 MiB).
 */
export async function salvarCanhotos(
  itens: { dados: NovoCanhoto; imagem: CanhotoImagem; /** foto do verso (opcional) */ verso?: CanhotoImagem; /** id de um canhoto existente a substituir */ substituirId?: string }[],
  uid: string,
): Promise<string[]> {
  if (itens.length === 0) throw new Error('Nenhum canhoto para salvar.');
  if (itens.length > 20) throw new Error('Máximo de 20 canhotos por vez.');

  const batch = writeBatch(db);
  const ids: string[] = [];
  for (const { dados, imagem, verso, substituirId } of itens) {
    const data = dataDeISO(dados.dataAssinatura);
    if (!data) throw new Error('Data de assinatura inválida.');
    const nota = normalizarNota(dados.numeroNota);
    const cliente = dados.cliente.trim();
    if (!nota || !cliente) throw new Error('Preencha os campos obrigatórios.');

    if (substituirId) {
      // Substituição: mantém NF, cliente e autoria; troca data, assinatura, observação e foto.
      batch.update(doc(canhotosRef, substituirId), {
        dataAssinatura: Timestamp.fromDate(data),
        assinadoPor: dados.assinadoPor?.trim() || deleteField(),
        observacao: dados.observacao?.trim() || deleteField(),
        atualizadoPor: uid,
        atualizadoEm: serverTimestamp(),
      });
      batch.update(doc(db, 'canhotos_imagens', substituirId), {
        imagemBase64: imagem.imagemBase64,
        mimeType: imagem.mimeType,
      });
      if (verso) batch.set(doc(db, 'canhotos_versos', substituirId), { imagemBase64: verso.imagemBase64, mimeType: verso.mimeType });
      ids.push(substituirId);
      continue;
    }

    const ref = doc(canhotosRef);
    const registro: Record<string, unknown> = {
      numeroNota: nota,
      cliente,
      clienteBusca: normalizarBusca(cliente),
      dataAssinatura: Timestamp.fromDate(data),
      criadoPor: uid,
      criadoEm: serverTimestamp(),
    };
    const assinadoPor = dados.assinadoPor?.trim();
    const observacao = dados.observacao?.trim();
    if (assinadoPor) registro.assinadoPor = assinadoPor;
    if (observacao) registro.observacao = observacao;

    batch.set(ref, registro);
    batch.set(doc(db, 'canhotos_imagens', ref.id), {
      imagemBase64: imagem.imagemBase64,
      mimeType: imagem.mimeType,
    });
    if (verso) batch.set(doc(db, 'canhotos_versos', ref.id), { imagemBase64: verso.imagemBase64, mimeType: verso.mimeType });
    ids.push(ref.id);
  }
  await batch.commit();
  return ids;
}

export function mensagemErroFirestore(err: unknown): string {
  const code = (err as { code?: string }).code ?? '';
  if (code === 'permission-denied') return 'Você não tem permissão para esta operação.';
  if (code === 'failed-precondition') {
    return 'Índice do Firestore ausente. Rode "firebase deploy --only firestore:indexes" e aguarde a criação.';
  }
  if (code === 'unavailable') return 'Sem conexão com o servidor. Verifique a internet.';
  return 'Ocorreu um erro inesperado. Tente novamente.';
}
