import { GoogleAIBackend, Schema, getAI, getGenerativeModel } from 'firebase/ai';
import { app } from '../lib/firebase';
import { dataDeISO, inicioDoDia, fimDoDia } from '../lib/datas';
import { normalizarNota } from '../lib/texto';
import type { Caixa, CanhotoLido, CampoCanhoto } from '../types';

/**
 * Leitura por IA via Firebase AI Logic (Gemini Developer API).
 * A chave do Gemini fica no Firebase (nunca no bundle) e o plano Spark basta.
 * Uma foto pode conter VÁRIOS canhotos (tiras grampeadas): a IA devolve uma lista.
 */
// A cota gratuita é por modelo (20/dia no Free Tier): se um estourar ou estiver sobrecarregado, tenta o próximo.
// O 2.5-flash foi aposentado para projetos novos.
const MODELOS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
const MAX_CANHOTOS = 20;

const PROMPT = `Você lê fotos de CANHOTOS de notas fiscais brasileiras (DANFE/NF-e) entregues e recebidos.
A foto pode conter UM ou VÁRIOS canhotos (tiras de papel empilhadas ou grampeadas, às vezes tortas,
rasgadas ou parcialmente cobertas por carimbos). Retorne UM item para CADA canhoto visível, na ordem
de cima para baixo. Ignore outros textos da página (CT-e, observações gerais, chaves de acesso soltas, propagandas).

Cada canhoto tem uma tira com: o texto "RECEBEMOS DE <EMITENTE> OS PRODUTOS/SERVIÇOS CONSTANTES DA NOTA FISCAL
INDICADA ABAIXO. EMISSÃO: dd/mm/aaaa VALOR TOTAL: ... DESTINATÁRIO: <CLIENTE> - <endereço>", os campos
"DATA DE RECEBIMENTO" e "IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR", e à direita o quadro "NF-e Nº000.123.456 SÉRIE 1".

Extraia SOMENTE o que estiver claramente legível. Se um campo estiver ilegível, ausente, cortado ou houver
dúvida, use null. NUNCA invente, deduza ou complete valores.

Campos de cada canhoto:
- numeroNota: o número do quadro "NF-e Nº...", só dígitos (ex.: "Nº000.237.336" → "000237336"). Não é a série, nem a chave de acesso de 44 dígitos, nem o número de outra nota citada no rodapé.
- cliente: o DESTINATÁRIO da nota, isto é, o nome logo após "DESTINATÁRIO:" (que pode continuar na linha de baixo, antes do endereço), ex.: "SUZANO SA", "VALE SA". NÃO é o emitente ("CEDISA CENTRAL DE ACO S/A", que vem depois de "RECEBEMOS DE"), nem a transportadora, nem quem recebeu. Retorne só o nome, sem o endereço.
- dataAssinatura: a data de recebimento, em AAAA-MM-DD. Vem manuscrita no campo "DATA DE RECEBIMENTO" (ex.: "20 05 2026" = 2026-05-20) ou carimbada (ex.: "13 MAIO 2026" = 2026-05-13). Datas no Brasil são DD/MM/AAAA. Cada canhoto tem seu próprio carimbo/data; carimbos podem ficar deslocados e invadir a tira vizinha, então associe pela ordem e pela posição. NÃO use a data de EMISSÃO. A data de recebimento nunca é anterior à emissão do mesmo canhoto: se o ano manuscrito estiver borrado, o ano coerente com a emissão (mesmo ano ou o seguinte) ajuda a decidir. Se faltar dia, mês ou ano, ou houver dúvida real, use null.
- dataEmissao: a data após "EMISSÃO:" no texto da tira, em AAAA-MM-DD, ou null se ilegível (usada só para conferir a data de recebimento).
- assinadoPor: o nome de quem recebeu, quando legível no campo de identificação do recebedor (nome impresso, carimbo com nome/matrícula ou assinatura por extenso). Rubrica ilegível = null.
- observacao: anotações escritas no canhoto (ex.: "recebido com avaria"), apenas se existirem; senão null.
- caixa: [ymin, xmin, ymax, xmax], coordenadas de 0 a 1000 relativas à imagem inteira, envolvendo TODA a tira desse canhoto (do texto "RECEBEMOS" até o quadro da NF-e, incluindo o campo de data e o de assinatura).`;

const ai = getAI(app, { backend: new GoogleAIBackend() });
const generationConfig = {
    temperature: 0,
    responseMimeType: 'application/json',
    responseSchema: Schema.object({
      properties: {
        canhotos: Schema.array({
          items: Schema.object({
            properties: {
              numeroNota: Schema.string({ nullable: true }),
              cliente: Schema.string({ nullable: true }),
              dataAssinatura: Schema.string({ nullable: true, description: 'AAAA-MM-DD' }),
              dataEmissao: Schema.string({ nullable: true, description: 'AAAA-MM-DD' }),
              assinadoPor: Schema.string({ nullable: true }),
              observacao: Schema.string({ nullable: true }),
              caixa: Schema.array({ items: Schema.number(), description: '[ymin, xmin, ymax, xmax] de 0 a 1000' }),
            },
          }),
        }),
      },
    }),
};
const modelos = MODELOS.map((model) => getGenerativeModel(ai, { model, generationConfig }));

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

function caixaValida(v: unknown): Caixa | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null;
  }
  const [ymin, xmin, ymax, xmax] = (v as number[]).map((n) => Math.min(1000, Math.max(0, n)));
  return ymax > ymin && xmax > xmin ? [ymin, xmin, ymax, xmax] : null;
}

/** Envia a imagem (já comprimida) ao Gemini e devolve os canhotos lidos e validados. */
export async function lerCanhotos(imagem: { base64: string; mimeType: string }): Promise<CanhotoLido[]> {
  let bruto: { canhotos?: unknown };
  try {
    const conteudo = [PROMPT, { inlineData: { data: imagem.base64, mimeType: imagem.mimeType } }];
    let resposta;
    let ultimoErro: unknown;
    for (const modelo of modelos) {
      try {
        // Picos de demanda (500/503) são temporários: 1 nova tentativa no mesmo modelo.
        for (let tentativa = 0; ; tentativa++) {
          try {
            resposta = await modelo.generateContent(conteudo);
            break;
          } catch (e) {
            const sobrecarga = /(500|503)|high demand|overloaded/i.test(String((e as Error).message));
            if (!sobrecarga || tentativa >= 1) throw e;
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
        break;
      } catch (e) {
        ultimoErro = e;
        // Cota estourada, sobrecarga ou modelo indisponível: passa para o próximo modelo.
        if (!/(429|500|503|404)|quota|RESOURCE_EXHAUSTED|high demand|overloaded|not found/i.test(String((e as Error).message))) throw e;
      }
    }
    if (!resposta) throw ultimoErro;
    bruto = JSON.parse(resposta.response.text()) as { canhotos?: unknown };
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

  const lista = Array.isArray(bruto.canhotos) ? (bruto.canhotos as Record<string, unknown>[]) : [];
  return lista.slice(0, MAX_CANHOTOS).map((item) => {
    const nota = normalizarNota(textoOuNull(item.numeroNota, 40) ?? '');
    const emissao = dataValida(textoOuNull(item.dataEmissao, 10));
    let assinatura = dataValida(textoOuNull(item.dataAssinatura, 10));
    // Recebimento antes da emissão é leitura errada (ex.: ano manuscrito confundido): deixa para o usuário.
    if (assinatura && emissao && assinatura < emissao) assinatura = null;
    const campos: Record<CampoCanhoto, string | null> = {
      numeroNota: nota || null,
      cliente: textoOuNull(item.cliente, 200),
      dataAssinatura: assinatura,
      assinadoPor: textoOuNull(item.assinadoPor, 200),
      observacao: textoOuNull(item.observacao, 1000),
    };
    return { campos, caixa: caixaValida(item.caixa) };
  });
}
