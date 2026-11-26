export type Perfil = 'rotas' | 'fiscal' | 'comercial' | 'gestao_rotas';

export const PERFIS: readonly Perfil[] = ['rotas', 'fiscal', 'comercial', 'gestao_rotas'];

export const PERFIL_ROTULO: Record<Perfil, string> = {
  rotas: 'Rotas',
  fiscal: 'Fiscal',
  comercial: 'Comercial',
  gestao_rotas: 'Gestão de Rotas',
};

export function ehPerfil(valor: unknown): valor is Perfil {
  return typeof valor === 'string' && (PERFIS as readonly string[]).includes(valor);
}

/** Usuário do sistema (documento usuarios/{uid}). */
export interface Usuario {
  uid: string;
  nome: string;
  email?: string;
  perfil: Perfil;
  admin: boolean;
  ativo: boolean;
}

export interface Canhoto {
  id: string;
  numeroNota: string;
  cliente: string;
  clienteBusca: string;
  dataAssinatura: Date;
  assinadoPor?: string;
  observacao?: string;
  criadoPor: string;
  criadoEm: Date;
}

export interface CanhotoImagem {
  imagemBase64: string;
  mimeType: string;
}

/** Dados que o usuário confirma na tela de digitalização. */
export interface NovoCanhoto {
  numeroNota: string;
  cliente: string;
  /** Data no formato AAAA-MM-DD */
  dataAssinatura: string;
  assinadoPor?: string;
  observacao?: string;
}

export type CampoCanhoto =
  | 'numeroNota'
  | 'cliente'
  | 'dataAssinatura'
  | 'assinadoPor'
  | 'observacao';

export type CampoObrigatorio = 'numeroNota' | 'cliente' | 'dataAssinatura';

export const CAMPO_ROTULO: Record<CampoCanhoto, string> = {
  numeroNota: 'Nº da Nota Fiscal',
  cliente: 'Nome do cliente',
  dataAssinatura: 'Data de assinatura',
  assinadoPor: 'Quem assinou',
  observacao: 'Observação',
};

/** [ymin, xmin, ymax, xmax] normalizados de 0 a 1000 (formato do Gemini). */
export type Caixa = [number, number, number, number];

/** Um canhoto lido pela IA dentro de uma foto (que pode conter vários). */
export interface CanhotoLido {
  campos: Record<CampoCanhoto, string | null>;
}
