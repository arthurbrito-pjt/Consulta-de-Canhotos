import { useEffect, useState } from 'react';
import { formatarData, formatarDataHora } from '../lib/datas';
import { mensagemErroFirestore, obterImagem, obterVerso } from '../services/canhotosService';
import type { Canhoto, CanhotoImagem } from '../types';
import { Carregando, Erro } from './Feedback';

type EstadoImagem =
  | { tipo: 'carregando' }
  | { tipo: 'ok'; imagem: CanhotoImagem }
  | { tipo: 'ausente' }
  | { tipo: 'erro'; mensagem: string };

interface Props {
  canhoto: Canhoto;
  posicao: number;
  total: number;
  onFechar: () => void;
  onAnterior?: () => void;
  onProximo?: () => void;
}

export function CanhotoDetalhe({ canhoto, posicao, total, onFechar, onAnterior, onProximo }: Props) {
  const [estado, setEstado] = useState<EstadoImagem>({ tipo: 'carregando' });
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const [versoUrl, setVersoUrl] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    setEstado({ tipo: 'carregando' });
    setAmpliada(null);
    setVersoUrl(null);
    obterVerso(canhoto.id)
      .then((v) => {
        if (!cancelado && v) setVersoUrl(`data:${v.mimeType};base64,${v.imagemBase64}`);
      })
      .catch(() => {
        // verso é opcional: falha ao carregar não atrapalha o resto
      });
    obterImagem(canhoto.id)
      .then((imagem) => {
        if (!cancelado) setEstado(imagem ? { tipo: 'ok', imagem } : { tipo: 'ausente' });
      })
      .catch((err) => {
        if (!cancelado) setEstado({ tipo: 'erro', mensagem: mensagemErroFirestore(err) });
      });
    return () => {
      cancelado = true;
    };
  }, [canhoto.id]);

  // Esc fecha (primeiro o zoom); setas navegam entre os resultados.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const emCampo = (e.target as HTMLElement | null)?.closest('input, textarea, select');
      if (e.key === 'Escape') {
        if (ampliada) setAmpliada(null);
        else onFechar();
      } else if (!emCampo && e.key === 'ArrowLeft') onAnterior?.();
      else if (!emCampo && e.key === 'ArrowRight') onProximo?.();
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [ampliada, onFechar, onAnterior, onProximo]);

  const dataUrl =
    estado.tipo === 'ok' ? `data:${estado.imagem.mimeType};base64,${estado.imagem.imagemBase64}` : null;

  async function copiarNota() {
    try {
      await navigator.clipboard.writeText(canhoto.numeroNota);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // sem permissão de área de transferência: ignora
    }
  }

  return (
    <aside className="detalhe" aria-label={`Detalhes da NF ${canhoto.numeroNota}`}>
      <header className="detalhe-topo">
        <button type="button" className="icone-btn" onClick={onFechar} aria-label="Voltar para a lista">
          <span aria-hidden="true">←</span>
        </button>
        <div className="detalhe-titulo">
          <span className="rotulo">Nota Fiscal</span>
          <h2>{canhoto.numeroNota}</h2>
        </div>
        <button type="button" className="btn-pequeno" onClick={() => void copiarNota()}>
          {copiado ? 'Copiado ✓' : 'Copiar nº'}
        </button>
      </header>

      <div className="detalhe-corpo">
        <div className="detalhe-foto">
          {estado.tipo === 'carregando' && <Carregando texto="Carregando foto..." />}
          {estado.tipo === 'erro' && <Erro>{estado.mensagem}</Erro>}
          {estado.tipo === 'ausente' && <p className="muted">Foto não encontrada para este canhoto.</p>}
          {dataUrl && (
            <>
              <button type="button" className="foto-btn" onClick={() => setAmpliada(dataUrl)} aria-label="Ampliar foto">
                <img src={dataUrl} alt={`Canhoto da NF ${canhoto.numeroNota}`} />
                <span className="foto-dica">Toque para ampliar</span>
              </button>
              <a className="btn-pequeno" href={dataUrl} download={`canhoto-NF-${canhoto.numeroNota}.jpg`}>
                Baixar foto
              </a>
            </>
          )}
        </div>

        {versoUrl && (
          <div className="detalhe-foto">
            <span className="rotulo">Verso / observação</span>
            <button type="button" className="foto-btn" onClick={() => setAmpliada(versoUrl)} aria-label="Ampliar foto do verso">
              <img src={versoUrl} alt={`Verso do canhoto da NF ${canhoto.numeroNota}`} />
              <span className="foto-dica">Toque para ampliar</span>
            </button>
            <a className="btn-pequeno" href={versoUrl} download={`canhoto-NF-${canhoto.numeroNota}-verso.jpg`}>
              Baixar foto do verso
            </a>
          </div>
        )}

        <dl className="dados">
          <div>
            <dt>Cliente</dt>
            <dd className="destaque">{canhoto.cliente}</dd>
          </div>
          <div>
            <dt>Data de assinatura</dt>
            <dd>{formatarData(canhoto.dataAssinatura)}</dd>
          </div>
          <div>
            <dt>Assinado por</dt>
            <dd>{canhoto.assinadoPor ?? <span className="muted">Não informado</span>}</dd>
          </div>
          <div>
            <dt>Observação</dt>
            <dd>{canhoto.observacao ?? <span className="muted">Nenhuma</span>}</dd>
          </div>
          <div>
            <dt>Digitalizado em</dt>
            <dd>{formatarDataHora(canhoto.criadoEm)}</dd>
          </div>
        </dl>
      </div>

      {total > 1 && (
        <footer className="detalhe-nav">
          <button type="button" className="btn btn-secundario" onClick={onAnterior} disabled={!onAnterior}>
            ‹ Anterior
          </button>
          <span className="muted">
            {posicao} de {total}
          </span>
          <button type="button" className="btn btn-secundario" onClick={onProximo} disabled={!onProximo}>
            Próximo ›
          </button>
        </footer>
      )}

      {ampliada && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Foto ampliada" onClick={() => setAmpliada(null)}>
          <img src={ampliada} alt={`Canhoto da NF ${canhoto.numeroNota} ampliado`} />
          <button type="button" className="btn lightbox-fechar" onClick={() => setAmpliada(null)}>
            Fechar
          </button>
        </div>
      )}
    </aside>
  );
}
