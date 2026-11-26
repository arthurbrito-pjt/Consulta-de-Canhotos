import { useEffect, useState } from 'react';
import { formatarData, formatarDataHora } from '../lib/datas';
import { mensagemErroFirestore, obterImagem } from '../services/canhotosService';
import type { Canhoto, CanhotoImagem } from '../types';
import { Carregando, Erro } from './Feedback';

type EstadoImagem =
  | { tipo: 'carregando' }
  | { tipo: 'ok'; imagem: CanhotoImagem }
  | { tipo: 'ausente' }
  | { tipo: 'erro'; mensagem: string };

export function CanhotoDetalhe({ canhoto, onFechar }: { canhoto: Canhoto; onFechar: () => void }) {
  const [estado, setEstado] = useState<EstadoImagem>({ tipo: 'carregando' });
  const [ampliada, setAmpliada] = useState(false);

  useEffect(() => {
    let cancelado = false;
    setEstado({ tipo: 'carregando' });
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

  return (
    <section className="cartao detalhe" aria-label={`Detalhes da NF ${canhoto.numeroNota}`}>
      <div className="detalhe-topo">
        <h2>NF {canhoto.numeroNota}</h2>
        <button type="button" className="btn btn-link" onClick={onFechar}>
          Fechar
        </button>
      </div>

      <dl className="dados">
        <dt>Cliente</dt>
        <dd>{canhoto.cliente}</dd>
        <dt>Data de assinatura</dt>
        <dd>{formatarData(canhoto.dataAssinatura)}</dd>
        <dt>Assinado por</dt>
        <dd>{canhoto.assinadoPor ?? <span className="muted">Não informado</span>}</dd>
        <dt>Observação</dt>
        <dd>{canhoto.observacao ?? <span className="muted">Nenhuma</span>}</dd>
        <dt>Digitalizado em</dt>
        <dd>{formatarDataHora(canhoto.criadoEm)}</dd>
      </dl>

      <h3>Foto do canhoto</h3>
      {estado.tipo === 'carregando' && <Carregando texto="Carregando foto..." />}
      {estado.tipo === 'erro' && <Erro>{estado.mensagem}</Erro>}
      {estado.tipo === 'ausente' && <p className="muted">Foto não encontrada para este canhoto.</p>}
      {estado.tipo === 'ok' && (
        <>
          <img
            className="foto"
            src={`data:${estado.imagem.mimeType};base64,${estado.imagem.imagemBase64}`}
            alt={`Canhoto da NF ${canhoto.numeroNota}`}
            onClick={() => setAmpliada(true)}
          />
          <p className="muted pequeno">Toque na foto para ampliar.</p>
          {ampliada && (
            <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setAmpliada(false)}>
              <img
                src={`data:${estado.imagem.mimeType};base64,${estado.imagem.imagemBase64}`}
                alt={`Canhoto da NF ${canhoto.numeroNota} ampliado`}
              />
              <button type="button" className="btn btn-secundario lightbox-fechar">
                Fechar
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
