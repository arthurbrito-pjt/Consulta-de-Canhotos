import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CanhotoDetalhe } from '../components/CanhotoDetalhe';
import { Carregando, Erro, Vazio } from '../components/Feedback';
import { dataDeISO, formatarData, paraISO } from '../lib/datas';
import { normalizarNota } from '../lib/texto';
import {
  LIMITE_RESULTADOS,
  buscarPorCliente,
  buscarPorData,
  buscarPorNota,
  buscarRecentes,
  mensagemErroFirestore,
} from '../services/canhotosService';
import type { Canhoto } from '../types';

type Modo = 'nota' | 'cliente' | 'data';

const MODOS: { id: Modo; rotulo: string }[] = [
  { id: 'nota', rotulo: 'Nota Fiscal' },
  { id: 'cliente', rotulo: 'Cliente' },
  { id: 'data', rotulo: 'Data' },
];

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'ok'; lista: Canhoto[]; titulo: string; recentes: boolean }
  | { tipo: 'erro'; mensagem: string };

const TITULO_RECENTES = 'Últimos canhotos digitalizados';

function diasAtras(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return paraISO(d);
}

export function ConsultaPage() {
  const [modo, setModo] = useState<Modo>('nota');
  const [termo, setTermo] = useState('');
  const [data, setData] = useState('');
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });
  const [indice, setIndice] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const requisicao = useRef(0);

  /** Executa uma busca descartando respostas de buscas antigas. */
  const executar = useCallback(async (buscar: () => Promise<Canhoto[]>, titulo: string, recentes = false) => {
    const id = ++requisicao.current;
    setIndice(null);
    setEstado({ tipo: 'carregando' });
    try {
      const lista = await buscar();
      if (id === requisicao.current) setEstado({ tipo: 'ok', lista, titulo, recentes });
    } catch (err) {
      if (id === requisicao.current) setEstado({ tipo: 'erro', mensagem: mensagemErroFirestore(err) });
    }
  }, []);

  useEffect(() => {
    void executar(buscarRecentes, TITULO_RECENTES, true);
  }, [executar]);

  function trocarModo(novo: Modo) {
    setModo(novo);
    setAviso(null);
  }

  function limpar() {
    setTermo('');
    setData('');
    setAviso(null);
    void executar(buscarRecentes, TITULO_RECENTES, true);
  }

  function buscarDia(iso: string) {
    const dia = dataDeISO(iso);
    if (!dia) return setAviso('Data inválida.');
    setData(iso);
    setAviso(null);
    void executar(() => buscarPorData(iso), `Assinados em ${formatarData(dia)}`);
  }

  function aoBuscar(e: FormEvent) {
    e.preventDefault();
    setAviso(null);
    if (modo === 'nota') {
      if (!normalizarNota(termo)) return setAviso('Informe o número da nota fiscal.');
      void executar(() => buscarPorNota(termo), `Nota fiscal ${normalizarNota(termo)}`);
    } else if (modo === 'cliente') {
      if (termo.trim().length < 2) return setAviso('Digite ao menos 2 letras do nome do cliente.');
      void executar(() => buscarPorCliente(termo), `Clientes que começam com “${termo.trim()}”`);
    } else {
      if (!data) return setAviso('Escolha uma data.');
      buscarDia(data);
    }
  }

  const lista = estado.tipo === 'ok' ? estado.lista : [];
  const selecionado = indice !== null ? lista[indice] : undefined;
  const fechar = useCallback(() => setIndice(null), []);
  const anterior = indice !== null && indice > 0 ? () => setIndice(indice - 1) : undefined;
  const proximo = indice !== null && indice < lista.length - 1 ? () => setIndice(indice + 1) : undefined;
  const hoje = paraISO(new Date());

  return (
    <div className={selecionado ? 'consulta com-detalhe' : 'consulta'}>
      <section className="consulta-lista">
        <form className="busca-cartao" onSubmit={aoBuscar}>
          <div className="segmentos" role="tablist" aria-label="Tipo de busca">
            {MODOS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={modo === m.id}
                className={modo === m.id ? 'segmento ativo' : 'segmento'}
                onClick={() => trocarModo(m.id)}
              >
                {m.rotulo}
              </button>
            ))}
          </div>

          <div className="busca">
            {modo === 'data' ? (
              <input
                type="date"
                aria-label="Data de assinatura"
                value={data}
                max={hoje}
                onChange={(e) => setData(e.target.value)}
              />
            ) : (
              <input
                type="search"
                aria-label={modo === 'nota' ? 'Número da nota fiscal' : 'Nome do cliente'}
                placeholder={modo === 'nota' ? 'Digite o nº da nota fiscal' : 'Digite o início do nome do cliente'}
                inputMode={modo === 'nota' ? 'numeric' : 'text'}
                autoComplete="off"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
              />
            )}
            <button type="submit" className="btn btn-primario" disabled={estado.tipo === 'carregando'}>
              Buscar
            </button>
          </div>

          {modo === 'data' && (
            <div className="atalhos">
              <button type="button" className="chip" onClick={() => buscarDia(diasAtras(0))}>
                Hoje
              </button>
              <button type="button" className="chip" onClick={() => buscarDia(diasAtras(1))}>
                Ontem
              </button>
              <button type="button" className="chip" onClick={() => buscarDia(diasAtras(2))}>
                Anteontem
              </button>
            </div>
          )}
          {modo === 'cliente' && <p className="muted pequeno">Encontra nomes que começam com o texto digitado.</p>}
          {aviso && <Erro>{aviso}</Erro>}
        </form>

        {estado.tipo === 'carregando' && <Carregando texto="Buscando canhotos..." />}
        {estado.tipo === 'erro' && <Erro>{estado.mensagem}</Erro>}

        {estado.tipo === 'ok' && (
          <>
            <div className="resultado-cabecalho">
              <div>
                <strong>{estado.titulo}</strong>
                <span className="muted">
                  {' '}
                  · {lista.length} {lista.length === 1 ? 'canhoto' : 'canhotos'}
                </span>
              </div>
              {!estado.recentes && (
                <button type="button" className="btn-pequeno" onClick={limpar}>
                  Limpar busca
                </button>
              )}
            </div>
            {!estado.recentes && lista.length >= LIMITE_RESULTADOS && (
              <p className="muted pequeno">Mostrando os {LIMITE_RESULTADOS} primeiros. Refine a busca para ver os demais.</p>
            )}

            {lista.length === 0 ? (
              <Vazio>
                <strong>Nenhum canhoto encontrado.</strong>
                <span>Confira o número ou o nome digitado e tente de novo.</span>
              </Vazio>
            ) : (
              <ul className="lista" aria-label="Resultados">
                {lista.map((c, i) => (
                  <li key={c.id}>
                    <button type="button" className={indice === i ? 'item ativo' : 'item'} onClick={() => setIndice(i)}>
                      <span className="item-data" aria-label={formatarData(c.dataAssinatura)}>
                        <b>{String(c.dataAssinatura.getDate()).padStart(2, '0')}</b>
                        <small>{c.dataAssinatura.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</small>
                        <small>{c.dataAssinatura.getFullYear()}</small>
                      </span>
                      <span className="item-corpo">
                        <span className="item-nf">NF {c.numeroNota}</span>
                        <span className="item-cliente">{c.cliente}</span>
                        <span className="item-meta">
                          {c.assinadoPor ? `Assinado por ${c.assinadoPor}` : 'Sem nome do recebedor'}
                          {c.observacao && <span className="etiqueta">Obs.</span>}
                        </span>
                      </span>
                      <span className="item-seta" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <div className="consulta-painel">
        {selecionado ? (
          <CanhotoDetalhe
            canhoto={selecionado}
            posicao={(indice ?? 0) + 1}
            total={lista.length}
            onFechar={fechar}
            onAnterior={anterior}
            onProximo={proximo}
          />
        ) : (
          <div className="painel-vazio">
            <strong>Selecione um canhoto</strong>
            <span>Os dados e a foto aparecem aqui.</span>
          </div>
        )}
      </div>
    </div>
  );
}
