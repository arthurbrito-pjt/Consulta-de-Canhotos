import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import type { LeituraCanhotoResultado } from '../types';

interface Entrada {
  imagemBase64: string;
  mimeType: string;
}

const chamar = httpsCallable<Entrada, LeituraCanhotoResultado>(functions, 'lerCanhoto', {
  timeout: 70_000,
});

/** Envia a imagem (já comprimida) à Cloud Function de OCR e devolve os campos lidos. */
export async function lerCanhoto(imagem: {
  base64: string;
  mimeType: string;
}): Promise<LeituraCanhotoResultado> {
  try {
    const { data } = await chamar({ imagemBase64: imagem.base64, mimeType: imagem.mimeType });
    return data;
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code.endsWith('unauthenticated')) {
      throw new Error('Sua sessão expirou. Entre novamente.');
    }
    if (code.endsWith('permission-denied')) {
      throw new Error('Seu perfil não pode digitalizar canhotos.');
    }
    if (code.endsWith('resource-exhausted')) {
      throw new Error('Muitas leituras em pouco tempo. Aguarde um instante e tente de novo.');
    }
    if (code.endsWith('deadline-exceeded') || code.endsWith('unavailable')) {
      throw new Error('O serviço de leitura demorou a responder. Verifique a conexão e tente de novo.');
    }
    throw new Error('Não foi possível ler o canhoto agora. Tente novamente.');
  }
}
