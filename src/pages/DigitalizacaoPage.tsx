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
import { encontrarDuplicados, mensagemErroFirestore, salvarCanhotos } from '../services/canhotosService';
import { lerCanhotos, localizarQuadros } from '../services/leituraCanhotoService';
import { CAMPO_ROTULO, type Canhoto } from '../types';

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
  /** Foto opcional do verso do canhoto (só imagem, sem leitura por IA). */
  verso?: ImagemComprimida;
}

interface Duplicado {
  chave: number;
  existente: Canhoto;
  substituir: boolean;
}

const fmtData = (d: Date) => d.toLocaleDateString('pt-BR');

export function DigitalizacaoPage() {
  const { user } = useAuth();
  const [etapa, setEtapa] = useState<Etapa>('inicio');
  const [itens, setItens] = useState<Item[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [mostrarErros, setMostrarErros] = useState(false);
  const [salvos, setSalvos] = useState(0);
  const [duplicados, setDuplicados] = useState<Duplicado[] | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const cameraVerso = useRef<HTMLInputElement>(null);
  const versoDe = useRef<number | null>(null);
  const [erroVerso, setErroVerso] = useState<string | null>(null);

  function pedirVerso(chave: number) {
    versoDe.current = chave;
    setErroVerso(null);
    cameraVerso.current?.click();
  }

  async function aoEscolherVerso(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    const chave = versoDe.current;
    if (!arquivo || chave === null) return;
    try {
      const fonte = await abrirImagem(arquivo);
      try {
        // 3 MB no total para versos, divididos entre os canhotos do lote (o commit aceita 10 MiB)
        const verso = imagemParaArmazenar(fonte, null, Math.floor(3_000_000 / Math.max(1, itens.length)));
        setItens((lista) => lista.map((i) => (i.chave === chave ? { ...i, verso } : i)));
      } finally {
        liberarImagem(fonte);
      }
    } catch (err) {
      setErroVerso(err instanceof Error ? err.message : 'Não foi possível usar a foto do verso.');
    }
  }

  function removerVerso(chave: number) {
    setItens((lista) => lista.map((i) => (i.chave === chave ? { ...i, verso: undefined } : i)));
  }

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
        const limite = Math.floor(6_000_000 / lidos.length);
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
      // Mesma NF + mesmo cliente já salvos? Pede confirmação antes de substituir.
      const existentes = await encontrarDuplicados(
        itens.map((i) => ({ numeroNota: i.form.numeroNota, cliente: i.form.cliente })),
      );
      const achados: Duplicado[] = itens.flatMap((i, k) => {
        const existente = existentes[k];
        return existente ? [{ chave: i.chave, existente, substituir: false }] : [];
      });
      if (achados.length > 0) {
        setDuplicados(achados);
        setEtapa('conferencia');
        return;
      }
      await gravar([]);
    } catch (err) {
      setErroForm(err instanceof Error && !('code' in err) ? err.message : mensagemErroFirestore(err));
      setEtapa('conferencia');
    }
  }

  /** Salva os itens; duplicados marcados para substituir atualizam o canhoto existente, os demais são pulados. */
  async function gravar(escolhas: Duplicado[]) {
    if (!user) return;
    setDuplicados(null);
    setEtapa('salvando');
    try {
      const itensGravar = itens.flatMap((i) => {
        const dup = escolhas.find((d) => d.chave === i.chave);
        if (dup && !dup.substituir) return [];
        return [
          {
            dados: i.form,
            imagem: { imagemBase64: i.imagem.base64, mimeType: i.imagem.mimeType },
            verso: i.verso ? { imagemBase64: i.verso.base64, mimeType: i.verso.mimeType } : undefined,
            substituirId: dup?.existente.id,
          },
        ];
      });
      if (itensGravar.length > 0) await salvarCanhotos(itensGravar, user.uid);
      setSalvos(itensGravar.length);
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
          {salvos === 0
            ? 'Nada foi alterado: os canhotos já existiam e foram mantidos.'
            : salvos === 1
              ? '1 canhoto salvo com sucesso.'
              : `${salvos} canhotos salvos com sucesso.`}
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
        <input ref={cameraVerso} type="file" accept="image/*" capture="environment" hidden onChange={aoEscolherVerso} />
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
              <div className="verso">
                {item.verso ? (
                  <>
                    <img className="foto foto-previa" src={item.verso.dataUrl} alt={`Verso do canhoto ${idx + 1}`} />
                    <div className="botoes-linha">
                      <button type="button" className="btn-pequeno" disabled={salvando} onClick={() => pedirVerso(item.chave)}>
                        Tirar outra foto do verso
                      </button>
                      <button type="button" className="btn-pequeno perigo" disabled={salvando} onClick={() => removerVerso(item.chave)}>
                        Remover foto do verso
                      </button>
                    </div>
                  </>
                ) : (
                  <button type="button" className="btn btn-secundario" disabled={salvando} onClick={() => pedirVerso(item.chave)}>
                    📷 Tirar foto do verso / observação
                  </button>
                )}
              </div>

              {msg && <Erro>{msg}</Erro>}
              <button type="button" className="btn btn-secundario" disabled={salvando} onClick={() => remover(item.chave)}>
                Não salvar este canhoto
              </button>
            </fieldset>
          );
        })}

        {erroVerso && <Erro>{erroVerso}</Erro>}
        {erroForm && <Erro>{erroForm}</Erro>}

        <div className="acoes">
          <button type="submit" className="btn btn-primario" disabled={salvando}>
            {salvando ? 'Salvando...' : itens.length === 1 ? 'Confirmar e salvar' : `Confirmar e salvar ${itens.length} canhotos`}
          </button>
          <button type="button" className="btn btn-secundario" disabled={salvando} onClick={reiniciar}>
            Descartar e tirar nova foto
          </button>
        </div>
        {duplicados && (
          <div className="modal-fundo" role="dialog" aria-modal="true" aria-labelledby="titulo-dup">
            <div className="modal">
              <h2 id="titulo-dup">{duplicados.length === 1 ? 'Canhoto já cadastrado' : 'Canhotos já cadastrados'}</h2>
              <p className="muted">
                {duplicados.length === 1
                  ? 'Já existe um canhoto com esta nota e este cliente. Deseja substituir a foto e os dados pelos novos?'
                  : 'Já existem canhotos com estas notas e clientes. Escolha o que fazer com cada um.'}
              </p>
              {duplicados.map((d) => {
                const novo = itens.find((i) => i.chave === d.chave);
                const escolher = (substituir: boolean) =>
                  setDuplicados((l) => l && l.map((x) => (x.chave === d.chave ? { ...x, substituir } : x)));
                return (
                  <div key={d.chave} className="dup-item">
                    <strong>
                      NF {d.existente.numeroNota} · {d.existente.cliente}
                    </strong>
                    <div className="pequeno muted">
                      Já salvo: assinado em {fmtData(d.existente.dataAssinatura)}
                      {d.existente.assinadoPor ? ` por ${d.existente.assinadoPor}` : ''}
                    </div>
                    {novo && (
                      <div className="pequeno muted">
                        Novo: assinado em {novo.form.dataAssinatura.split('-').reverse().join('/')}
                        {novo.form.assinadoPor ? ` por ${novo.form.assinadoPor}` : ''}
                      </div>
                    )}
                    <div className="botoes-linha">
                      <button type="button" className={d.substituir ? 'btn-pequeno' : 'btn-pequeno ativo'} onClick={() => escolher(false)}>
                        Manter o existente
                      </button>
                      <button type="button" className={d.substituir ? 'btn-pequeno ativo' : 'btn-pequeno'} onClick={() => escolher(true)}>
                        Substituir pelo novo
                      </button>
                    </div>
                  </div>
                );
              })}
              <div className="acoes">
                <button type="button" className="btn btn-primario" onClick={() => void gravar(duplicados)}>
                  Confirmar
                </button>
                <button type="button" className="btn btn-secundario" onClick={() => setDuplicados(null)}>
                  Voltar
                </button>
              </div>
            </div>
          </div>
        )}
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
