import { useRef, useState, type FormEvent } from 'react';
import { CanhotoDetalhe } from '../components/CanhotoDetalhe';
import { Carregando, Erro, Vazio } from '../components/Feedback';
import { formatarData } from '../lib/datas';
import { normalizarNota } from '../lib/texto';
import {
  buscarPorCliente,
  buscarPorData,
  buscarPorNota,
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
  | { tipo: 'inicial' }
  | { tipo: 'carregando' }
  | { tipo: 'ok'; lista: Canhoto[] }
  | { tipo: 'erro'; mensagem: string };

export function ConsultaPage() {
  const [modo, setModo] = useState<Modo>('nota');
  const [termo, setTermo] = useState('');
  const [data, setData] = useState('');
  const [estado, setEstado] = useState<Estado>({ tipo: 'inicial' });
  const [selecionado, setSelecionado] = useState<Canhoto | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const requisicao = useRef(0);

  function trocarModo(novo: Modo) {
    setModo(novo);
    setAviso(null);
  }

  async function buscar(e: FormEvent) {
    e.preventDefault();
    setAviso(null);

    if (modo === 'nota' && !normalizarNota(termo)) return setAviso('Informe o número da nota fiscal.');
    if (modo === 'cliente' && termo.trim().length < 2) return setAviso('Digite ao menos 2 letras do nome do cliente.');
    if (modo === 'data' && !data) return setAviso('Escolha uma data.');

    const id = ++requisicao.current; // descarta respostas de buscas antigas
    setSelecionado(null);
    setEstado({ tipo: 'carregando' });
    try {
      const lista =
        modo === 'nota'
          ? await buscarPorNota(termo)
          : modo === 'cliente'
            ? await buscarPorCliente(termo)
            : await buscarPorData(data);
      if (id === requisicao.current) setEstado({ tipo: 'ok', lista });
    } catch (err) {
      if (id === requisicao.current) setEstado({ tipo: 'erro', mensagem: mensagemErroFirestore(err) });
    }
  }

  return (
    <div className="consulta">
      <form className="cartao" onSubmit={buscar}>
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
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setData(e.target.value)}
            />
          ) : (
            <input
              type="search"
              aria-label={modo === 'nota' ? 'Número da nota fiscal' : 'Nome do cliente'}
              placeholder={modo === 'nota' ? 'Nº da nota fiscal' : 'Início do nome do cliente'}
              inputMode={modo === 'nota' ? 'numeric' : 'text'}
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
            />
          )}
          <button type="submit" className="btn btn-primario" disabled={estado.tipo === 'carregando'}>
            Buscar
          </button>
        </div>
        {modo === 'cliente' && <p className="muted pequeno">A busca encontra nomes que começam com o texto digitado.</p>}
        {aviso && <Erro>{aviso}</Erro>}
      </form>

      {estado.tipo === 'carregando' && <Carregando texto="Buscando canhotos..." />}
      {estado.tipo === 'erro' && <Erro>{estado.mensagem}</Erro>}
      {estado.tipo === 'ok' && estado.lista.length === 0 && <Vazio>Nenhum canhoto encontrado.</Vazio>}

      {estado.tipo === 'ok' && estado.lista.length > 0 && (
        <ul className="lista" aria-label="Resultados">
          {estado.lista.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={selecionado?.id === c.id ? 'item ativo' : 'item'}
                onClick={() => setSelecionado(c)}
              >
                <span className="item-nf">NF {c.numeroNota}</span>
                <span className="item-cliente">{c.cliente}</span>
                <span className="item-meta">
                  {formatarData(c.dataAssinatura)}
                  {c.assinadoPor ? ` · ${c.assinadoPor}` : ''}
                </span>
                {c.observacao && <span className="item-obs">{c.observacao}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selecionado && <CanhotoDetalhe canhoto={selecionado} onFechar={() => setSelecionado(null)} />}
    </div>
  );
}
