import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Carregando, Erro } from '../components/Feedback';
import { useAuth } from '../contexts/AuthContext';
import { dataAssinaturaValida } from '../lib/datas';
import {
  abrirImagem,
  imagemParaArmazenar,
  imagemParaLeitura,
  liberarImagem,
  type ImagemComprimida,
} from '../lib/imagem';
import { calcularFaixas } from '../lib/faixas';
import { normalizarNota } from '../lib/texto';
import { mensagemErroFirestore, salvarCanhotos } from '../services/canhotosService';
import { lerCanhotos, localizarQuadros } from '../services/leituraCanhotoService';
import { CAMPO_ROTULO } from '../types';

type Etapa = 'inicio' | 'lendo' | 'falha' | 'conferencia' | 'salvando' | 'sucesso';

interface Formulario {
  numeroNota: string;
  cliente: string;
  dataAssinatura: string;
  assinadoPor: string;
  observacao: string;
}

interface Item {
  chave: number;
  form: Formulario;
  imagem: ImagemComprimida;
  /** true = recorte da tira do canhoto; false = foto inteira. */
  recortada: boolean;
}

export function DigitalizacaoPage() {
  const { user } = useAuth();
  const [etapa, setEtapa] = useState<Etapa>('inicio');
  const [itens, setItens] = useState<Item[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [mostrarErros, setMostrarErros] = useState(false);
  const [salvos, setSalvos] = useState(0);
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);

  function reiniciar() {
    setEtapa('inicio');
    setItens([]);
    setErro(null);
    setErroForm(null);
    setMostrarErros(false);
  }

  async function aoEscolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = ''; // permite escolher a mesma foto de novo
    if (!arquivo) return;

    setErro(null);
    setErroForm(null);
    setMostrarErros(false);
    setEtapa('lendo');
    try {
      const fonte = await abrirImagem(arquivo);
      try {
        const leituraImg = imagemParaLeitura(fonte);
        const lidos = await lerCanhotos(leituraImg);
        if (lidos.length === 0) {
          setErro('Nenhum canhoto foi encontrado na foto. Tire uma nova foto, bem enquadrada e com boa luz.');
          setEtapa('falha');
          return;
        }
        // Recorta a faixa de cada canhoto; sem faixa segura, guarda a foto inteira (o lote de
        // 10 MiB limita o tamanho de cada cópia).
        // Com 2+ canhotos, uma segunda chamada (só de posição) permite recortar cada tira.
        const quadros =
          lidos.length > 1
            ? await localizarQuadros(leituraImg, lidos.map((l) => l.campos.numeroNota))
            : lidos.map(() => null);
        const faixas = calcularFaixas(quadros);
        const limite = Math.floor(8_000_000 / lidos.length);
        let inteira: ImagemComprimida | null = null;
        const novos: Item[] = lidos.map((l, i) => ({
          chave: i,
          recortada: faixas[i] !== null,
          imagem: faixas[i] ? imagemParaArmazenar(fonte, faixas[i], limite) : (inteira ??= imagemParaArmazenar(fonte, null, limite)),
          form: {
            numeroNota: l.campos.numeroNota ?? '',
            cliente: l.campos.cliente ?? '',
            dataAssinatura: l.campos.dataAssinatura ?? '',
            assinadoPor: l.campos.assinadoPor ?? '',
            observacao: l.campos.observacao ?? '',
          },
        }));
        setItens(novos);
        setEtapa('conferencia');
      } finally {
        liberarImagem(fonte);
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao processar a foto.');
      setEtapa('falha');
    }
  }

  /** Mensagem de problema do item, ou null se estiver pronto para salvar. */
  function problema(item: Item): string | null {
    const f = item.form;
    const nota = normalizarNota(f.numeroNota);
    if (!nota) return 'Informe o número da nota fiscal.';
    if (itens.filter((o) => normalizarNota(o.form.numeroNota) === nota).length > 1) {
      return 'Esta NF aparece mais de uma vez nesta foto.';
    }
    if (!f.cliente.trim()) return 'Informe o nome do cliente.';
    if (!dataAssinaturaValida(f.dataAssinatura)) return 'Informe uma data de assinatura válida (não futura).';
    return null;
  }

  function alterar(chave: number, k: keyof Formulario, valor: string) {
    setItens((lista) => lista.map((i) => (i.chave === chave ? { ...i, form: { ...i.form, [k]: valor } } : i)));
  }

  function remover(chave: number) {
    const restantes = itens.filter((i) => i.chave !== chave);
    setItens(restantes);
    if (restantes.length === 0) reiniciar();
  }

  function dataParaTodos(valor: string) {
    // Só preenche quem ficou sem data: o que a IA leu com segurança é mantido.
    setItens((lista) =>
      lista.map((i) => (i.form.dataAssinatura ? i : { ...i, form: { ...i.form, dataAssinatura: valor } })),
    );
  }

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (itens.some((i) => problema(i))) {
      setMostrarErros(true);
      setErroForm('Corrija os canhotos destacados antes de salvar (ou remova os que não quer guardar).');
      return;
    }

    setErroForm(null);
    setEtapa('salvando');
    try {
      await salvarCanhotos(
        itens.map((i) => ({
          dados: i.form,
          imagem: { imagemBase64: i.imagem.base64, mimeType: i.imagem.mimeType },
        })),
        user.uid,
      );
      setSalvos(itens.length);
      setEtapa('sucesso');
    } catch (err) {
      setErroForm(err instanceof Error && !('code' in err) ? err.message : mensagemErroFirestore(err));
      setEtapa('conferencia');
    }
  }

  const entradas = (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={aoEscolherArquivo} />
      <input ref={galeria} type="file" accept="image/jpeg,image/png" hidden onChange={aoEscolherArquivo} />
    </>
  );

  if (etapa === 'sucesso') {
    return (
      <div className="cartao">
        <div className="alerta alerta-ok" role="status">
          {salvos === 1 ? '1 canhoto salvo com sucesso.' : `${salvos} canhotos salvos com sucesso.`}
        </div>
        <button type="button" className="btn btn-primario" onClick={reiniciar}>
          Digitalizar outra foto
        </button>
      </div>
    );
  }

  if (etapa === 'lendo') {
    return <Carregando texto="Lendo os canhotos com IA... isso leva alguns segundos." tela />;
  }

  if (etapa === 'conferencia' || etapa === 'salvando') {
    const salvando = etapa === 'salvando';
    const hoje = new Date().toISOString().slice(0, 10);
    return (
      <form className="cartao" onSubmit={confirmar}>
        <h2>{itens.length === 1 ? 'Confira o canhoto lido' : `Confira os ${itens.length} canhotos lidos`}</h2>
        <p className="muted">Corrija o que for preciso. Nada é salvo até você confirmar.</p>

        {itens.some((i) => !i.form.dataAssinatura) && itens.length > 1 && (
          <label className="campo">
            <span>Data de assinatura para os canhotos que ficaram sem data</span>
            <input type="date" max={hoje} defaultValue="" onChange={(e) => dataParaTodos(e.target.value)} />
          </label>
        )}

        {itens.map((item, idx) => {
          const msg = mostrarErros ? problema(item) : null;
          const campo = (k: keyof Formulario) => ({
            value: item.form[k],
            onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => alterar(item.chave, k, e.target.value),
          });
          return (
            <fieldset key={item.chave} className={`item-canhoto${msg ? ' item-erro' : ''}`}>
              <legend>
                Canhoto {idx + 1}
                {item.form.numeroNota ? ` · NF ${normalizarNota(item.form.numeroNota)}` : ''}
              </legend>
              <img
                className="foto foto-previa"
                src={item.imagem.dataUrl}
                alt={item.recortada ? `Recorte do canhoto ${idx + 1}` : 'Foto inteira (não foi possível recortar este canhoto)'}
              />
              {!item.recortada && itens.length > 1 && (
                <p className="muted">Não foi possível recortar este canhoto: será salva a foto inteira.</p>
              )}

              <label className="campo">
                <span>{CAMPO_ROTULO.numeroNota} *</span>
                <input inputMode="numeric" {...campo('numeroNota')} />
              </label>
              <label className="campo">
                <span>{CAMPO_ROTULO.cliente} *</span>
                <input {...campo('cliente')} />
              </label>
              <label className="campo">
                <span>{CAMPO_ROTULO.dataAssinatura} *</span>
                <input type="date" max={hoje} {...campo('dataAssinatura')} />
              </label>
              <label className="campo">
                <span>{CAMPO_ROTULO.assinadoPor}</span>
                <input {...campo('assinadoPor')} />
              </label>
              <label className="campo">
                <span>{CAMPO_ROTULO.observacao}</span>
                <textarea rows={2} {...campo('observacao')} />
              </label>

              {msg && <Erro>{msg}</Erro>}
              <button type="button" className="btn btn-secundario" disabled={salvando} onClick={() => remover(item.chave)}>
                Não salvar este canhoto
              </button>
            </fieldset>
          );
        })}

        {erroForm && <Erro>{erroForm}</Erro>}

        <div className="acoes">
          <button type="submit" className="btn btn-primario" disabled={salvando}>
            {salvando ? 'Salvando...' : itens.length === 1 ? 'Confirmar e salvar' : `Confirmar e salvar ${itens.length} canhotos`}
          </button>
          <button type="button" className="btn btn-secundario" disabled={salvando} onClick={reiniciar}>
            Descartar e tirar nova foto
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="cartao">
      {entradas}
      <h2>Digitalizar canhotos</h2>

      {etapa === 'falha' && <Erro>{erro ?? 'Não foi possível ler a foto. Nada foi salvo.'}</Erro>}

      {etapa === 'inicio' && (
        <p className="muted">
          Fotografe um canhoto ou vários de uma vez (tiras empilhadas). Deixe o texto legível, com boa iluminação,
          sem reflexos e sem cortes.
        </p>
      )}

      <div className="acoes">
        <button type="button" className="btn btn-primario" onClick={() => camera.current?.click()}>
          {etapa === 'falha' ? 'Tirar nova foto' : 'Tirar foto'}
        </button>
        <button type="button" className="btn btn-secundario" onClick={() => galeria.current?.click()}>
          Escolher da galeria
        </button>
      </div>
    </div>
  );
}
