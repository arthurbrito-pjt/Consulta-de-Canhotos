import { GoogleAIBackend, Schema, getAI, getGenerativeModel } from 'firebase/ai';
import { app } from '../lib/firebase';
import { dataDeISO, inicioDoDia, fimDoDia } from '../lib/datas';
import { normalizarNota } from '../lib/texto';
import type { CampoCanhoto, CampoObrigatorio, LeituraCanhotoResultado } from '../types';

/**
 * Leitura por IA via Firebase AI Logic (Gemini Developer API).
 * A chave do Gemini fica no Firebase (nunca no bundle) e o plano Spark basta.
 */
const MODELO = 'gemini-3.8-flash'; // o 2.5-flash foi aposentado para projetos novos

const CAMPOS: CampoCanhoto[] = ['numeroNota', 'cliente', 'dataAssinatura', 'assinadoPor', 'observacao'];
const OBRIGATORIOS: CampoObrigatorio[] = ['numeroNota', 'cliente', 'dataAssinatura'];

const PROMPT = `Você lê fotos de CANHOTOS de notas fiscais brasileiras (DANFE/NF-e) assinados na entrega.
Extraia SOMENTE o que estiver claramente legível. Se um campo estiver ilegível, ausente, cortado ou
você tiver dúvida, retorne null. NUNCA invente, deduza ou complete valores.

Campos:
- numeroNota: número da nota fiscal impresso no canhoto ("Nº", "NF-e Nº"). Não é a chave de acesso de 44 dígitos nem a série.
- cliente: nome/razão social do cliente destinatário da mercadoria, como impresso na nota.
- dataAssinatura: data manuscrita/carimbada de recebimento ("Data de recebimento"), no formato AAAA-MM-DD. Datas no Brasil vêm como DD/MM/AAAA. Não use a data de emissão da nota. Se faltar dia, mês ou ano, retorne null.
- assinadoPor: nome de quem recebeu/assinou, apenas se o nome estiver legível. Uma rubrica ilegível = null.
- observacao: anotações escritas no canhoto (ex.: "recebido com avaria"), apenas se existirem. Caso contrário null.`;

const modelo = getGenerativeModel(getAI(app, { backend: new GoogleAIBackend() }), {
  model: MODELO,
  generationConfig: {
    temperature: 0,
    responseMimeType: 'application/json',
    responseSchema: Schema.object({
      properties: {
        numeroNota: Schema.string({ nullable: true }),
        cliente: Schema.string({ nullable: true }),
        dataAssinatura: Schema.string({ nullable: true, description: 'AAAA-MM-DD' }),
        assinadoPor: Schema.string({ nullable: true }),
        observacao: Schema.string({ nullable: true }),
      },
    }),
  },
});

function textoOuNull(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length > 0 && t.toLowerCase() !== 'null' ? t.slice(0, max) : null;
}

/** Data real, >= 2000 e não futura; senão conta como "não lida". */
function dataValida(v: string | null): string | null {
  if (!v) return null;
  const d = dataDeISO(v);
  if (!d || d.getFullYear() < 2000 || inicioDoDia(d) > fimDoDia(new Date())) return null;
  return v;
}

/** Envia a imagem (já comprimida) ao Gemini e devolve os campos lidos e validados. */
export async function lerCanhoto(imagem: {
  base64: string;
  mimeType: string;
}): Promise<LeituraCanhotoResultado> {
  let bruto: Record<string, unknown>;
  try {
    const conteudo = [PROMPT, { inlineData: { data: imagem.base64, mimeType: imagem.mimeType } }];
    let resposta;
    for (let tentativa = 0; ; tentativa++) {
      try {
        resposta = await modelo.generateContent(conteudo);
        break;
      } catch (e) {
        // Picos de demanda (HTTP 500/503) são temporários: tenta de novo até 2 vezes.
        const sobrecarga = /(500|503)|high demand|overloaded/i.test(String((e as Error).message));
        if (!sobrecarga || tentativa >= 2) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (tentativa + 1)));
      }
    }
    bruto = JSON.parse(resposta.response.text()) as Record<string, unknown>;
  } catch (err) {
    console.error('Falha na leitura por IA', err);
    const msg = String((err as { message?: string }).message ?? '');
    if (/quota|429|RESOURCE_EXHAUSTED/i.test(msg)) {
      throw new Error('Limite de leituras atingido. Aguarde um instante e tente de novo.');
    }
    if (/403|PERMISSION_DENIED|API.*not.*enabled|has not been used/i.test(msg)) {
      throw new Error('A leitura por IA não está habilitada no projeto Firebase (AI Logic).');
    }
    if (/network|fetch|Failed to/i.test(msg)) {
      throw new Error('Sem conexão com o serviço de leitura. Verifique a internet.');
    }
    throw new Error('Não foi possível ler o canhoto agora. Tente novamente.');
  }

  const nota = normalizarNota(textoOuNull(bruto.numeroNota, 40) ?? '');
  const campos: Record<CampoCanhoto, string | null> = {
    numeroNota: nota || null,
    cliente: textoOuNull(bruto.cliente, 200),
    dataAssinatura: dataValida(textoOuNull(bruto.dataAssinatura, 10)),
    assinadoPor: textoOuNull(bruto.assinadoPor, 200),
    observacao: textoOuNull(bruto.observacao, 1000),
  };
  const lidos = Object.fromEntries(CAMPOS.map((c) => [c, campos[c] !== null])) as Record<CampoCanhoto, boolean>;
  const obrigatoriosFaltando = OBRIGATORIOS.filter((c) => !lidos[c]);
  return { campos, lidos, obrigatoriosFaltando };
}
