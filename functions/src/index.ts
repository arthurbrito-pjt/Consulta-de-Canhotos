import Anthropic from '@anthropic-ai/sdk';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

initializeApp();

// A chave NUNCA vai para o front-end: fica no Secret Manager.
//   firebase functions:secrets:set ANTHROPIC_API_KEY
const anthropicKey = defineSecret('ANTHROPIC_API_KEY');
// Modelo configurável sem alterar código (functions/.env ou variável de ambiente).
const modeloOcr = defineString('OCR_MODEL', { default: 'claude-sonnet-5-5' });

type Campo = 'numeroNota' | 'cliente' | 'dataAssinatura' | 'assinadoPor' | 'observacao';
const CAMPOS: Campo[] = ['numeroNota', 'cliente', 'dataAssinatura', 'assinadoPor', 'observacao'];
const OBRIGATORIOS = ['numeroNota', 'cliente', 'dataAssinatura'] as const;
const TIPOS_ACEITOS = ['image/jpeg', 'image/png'] as const;
const LIMITE_BASE64 = 1_500_000; // ~1,1 MB de imagem; o cliente já envia < 700 mil

interface Entrada {
  imagemBase64?: unknown;
  mimeType?: unknown;
}

const PROMPT = `Você lê fotos de CANHOTOS de notas fiscais brasileiras (DANFE/NF-e) assinados na entrega.
Extraia SOMENTE o que estiver claramente legível. Se um campo estiver ilegível, ausente, cortado ou
você tiver dúvida, retorne null. NUNCA invente, deduza ou complete valores.

Campos:
- numeroNota: número da nota fiscal impresso no canhoto ("Nº", "NF-e Nº"). Não é a chave de acesso de 44 dígitos nem a série.
- cliente: nome/razão social do cliente destinatário da mercadoria, como impresso na nota.
- dataAssinatura: data manuscrita/carimbada de recebimento ("Data de recebimento"), no formato AAAA-MM-DD. Datas no Brasil vêm como DD/MM/AAAA. Não use a data de emissão da nota. Se faltar dia, mês ou ano, retorne null.
- assinadoPor: nome de quem recebeu/assinou, apenas se o nome estiver legível. Uma rubrica ilegível = null.
- observacao: anotações escritas no canhoto (ex.: "recebido com avaria"), apenas se existirem. Caso contrário null.

Responda chamando a ferramenta registrar_leitura.`;

const FERRAMENTA = {
  name: 'registrar_leitura',
  description: 'Registra os campos lidos no canhoto. Use null para o que não estiver legível.',
  input_schema: {
    type: 'object' as const,
    properties: {
      numeroNota: { type: ['string', 'null'] },
      cliente: { type: ['string', 'null'] },
      dataAssinatura: { type: ['string', 'null'], description: 'AAAA-MM-DD' },
      assinadoPor: { type: ['string', 'null'] },
      observacao: { type: ['string', 'null'] },
    },
    required: CAMPOS,
  },
};

function textoOuNull(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length > 0 && t.toLowerCase() !== 'null' ? t.slice(0, max) : null;
}

function dataIsoValida(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(a, mes - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== d) return null;
  const amanha = Date.now() + 24 * 3600 * 1000;
  if (a < 2000 || dt.getTime() > amanha) return null;
  return v;
}

export const lerCanhoto = onCall(
  {
    region: 'southamerica-east1',
    secrets: [anthropicKey],
    memory: '512MiB',
    timeoutSeconds: 60,
    maxInstances: 10,
  },
  async (request) => {
    // 1) Autenticação e autorização (somente perfil "rotas")
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
    const perfil = (await getFirestore().doc(`usuarios/${request.auth.uid}`).get()).data()?.perfil;
    if (perfil !== 'rotas') throw new HttpsError('permission-denied', 'Perfil sem permissão.');

    // 2) Validação da entrada
    const { imagemBase64, mimeType } = (request.data ?? {}) as Entrada;
    if (typeof imagemBase64 !== 'string' || imagemBase64.length === 0 || imagemBase64.length > LIMITE_BASE64) {
      throw new HttpsError('invalid-argument', 'Imagem ausente ou grande demais.');
    }
    if (!TIPOS_ACEITOS.includes(mimeType as (typeof TIPOS_ACEITOS)[number])) {
      throw new HttpsError('invalid-argument', 'Formato de imagem não suportado.');
    }

    // 3) Chamada ao modelo com visão (saída estruturada via tool use forçado)
    let bruto: Record<string, unknown>;
    try {
      const client = new Anthropic({ apiKey: anthropicKey.value() });
      const resposta = await client.messages.create({
        model: modeloOcr.value(),
        max_tokens: 600,
        temperature: 0,
        tools: [FERRAMENTA],
        tool_choice: { type: 'tool', name: FERRAMENTA.name },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType as 'image/jpeg' | 'image/png',
                  data: imagemBase64,
                },
              },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      });
      const bloco = resposta.content.find((b) => b.type === 'tool_use');
      bruto = bloco && bloco.type === 'tool_use' ? (bloco.input as Record<string, unknown>) : {};
    } catch (err) {
      console.error('Falha na chamada ao modelo de visão', err);
      throw new HttpsError('unavailable', 'Serviço de leitura indisponível.');
    }

    // 4) Sanitização: o que não passar na validação conta como "não lido"
    const nota = textoOuNull(bruto.numeroNota, 40)?.replace(/\D/g, '') || null;
    const campos: Record<Campo, string | null> = {
      numeroNota: nota ? nota.replace(/^0+(?=\d)/, '') : null,
      cliente: textoOuNull(bruto.cliente, 200),
      dataAssinatura: dataIsoValida(textoOuNull(bruto.dataAssinatura, 10)),
      assinadoPor: textoOuNull(bruto.assinadoPor, 200),
      observacao: textoOuNull(bruto.observacao, 1000),
    };
    const lidos = Object.fromEntries(CAMPOS.map((c) => [c, campos[c] !== null])) as Record<Campo, boolean>;
    const obrigatoriosFaltando = OBRIGATORIOS.filter((c) => !lidos[c]);

    return { campos, lidos, obrigatoriosFaltando };
  },
);
