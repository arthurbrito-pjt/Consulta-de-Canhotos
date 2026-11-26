import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Carregando, Erro } from '../components/Feedback';
import { useAuth } from '../contexts/AuthContext';
import { dataAssinaturaValida } from '../lib/datas';
import { comprimirImagem, type ImagemComprimida } from '../lib/imagem';
import { normalizarNota } from '../lib/texto';
import { mensagemErroFirestore, salvarCanhoto } from '../services/canhotosService';
import { lerCanhoto } from '../services/leituraCanhotoService';
import { CAMPO_ROTULO, type CampoObrigatorio } from '../types';

type Etapa = 'inicio' | 'lendo' | 'falha' | 'conferencia' | 'salvando' | 'sucesso';

interface Formulario {
  numeroNota: string;
  cliente: string;
  dataAssinatura: string;
  assinadoPor: string;
  observacao: string;
}

const VAZIO: Formulario = { numeroNota: '', cliente: '', dataAssinatura: '', assinadoPor: '', observacao: '' };

export function DigitalizacaoPage() {
  const { user } = useAuth();
  const [etapa, setEtapa] = useState<Etapa>('inicio');
  const [imagem, setImagem] = useState<ImagemComprimida | null>(null);
  const [form, setForm] = useState<Formulario>(VAZIO);
  const [faltando, setFaltando] = useState<CampoObrigatorio[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);

  function reiniciar() {
    setEtapa('inicio');
    setImagem(null);
    setForm(VAZIO);
    setFaltando([]);
    setErro(null);
    setErroForm(null);
  }

  async function aoEscolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = ''; // permite escolher a mesma foto de novo
    if (!arquivo) return;

    setErro(null);
    setFaltando([]);
    setEtapa('lendo');
    try {
      const comprimida = await comprimirImagem(arquivo);
      setImagem(comprimida);
      const leitura = await lerCanhoto(comprimida);

      if (leitura.obrigatoriosFaltando.length > 0) {
        setFaltando(leitura.obrigatoriosFaltando);
        setEtapa('falha');
        return;
      }
      setForm({
        numeroNota: leitura.campos.numeroNota ?? '',
        cliente: leitura.campos.cliente ?? '',
        dataAssinatura: leitura.campos.dataAssinatura ?? '',
        assinadoPor: leitura.campos.assinadoPor ?? '',
        observacao: leitura.campos.observacao ?? '',
      });
      setErroForm(null);
      setEtapa('conferencia');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao processar a foto.');
      setEtapa('falha');
    }
  }

  function validar(): string | null {
    if (!normalizarNota(form.numeroNota)) return 'Informe o número da nota fiscal.';
    if (!form.cliente.trim()) return 'Informe o nome do cliente.';
    if (!dataAssinaturaValida(form.dataAssinatura)) return 'Informe uma data de assinatura válida (não futura).';
    return null;
  }

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    const problema = validar();
    if (problema) return setErroForm(problema);
    if (!imagem || !user) return;

    setErroForm(null);
    setEtapa('salvando');
    try {
      await salvarCanhoto(
        {
          numeroNota: form.numeroNota,
          cliente: form.cliente,
          dataAssinatura: form.dataAssinatura,
          assinadoPor: form.assinadoPor,
          observacao: form.observacao,
        },
        { imagemBase64: imagem.base64, mimeType: imagem.mimeType },
        user.uid,
      );
      setEtapa('sucesso');
    } catch (err) {
      setErroForm(mensagemErroFirestore(err));
      setEtapa('conferencia');
    }
  }

  const campo = (k: keyof Formulario) => ({
    value: form[k],
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value })),
  });

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
          Canhoto da NF {normalizarNota(form.numeroNota)} salvo com sucesso.
        </div>
        <button type="button" className="btn btn-primario" onClick={reiniciar}>
          Digitalizar outro canhoto
        </button>
      </div>
    );
  }

  if (etapa === 'lendo') {
    return <Carregando texto="Lendo o canhoto com IA... isso leva alguns segundos." tela />;
  }

  if (etapa === 'conferencia' || etapa === 'salvando') {
    const salvando = etapa === 'salvando';
    return (
      <form className="cartao" onSubmit={confirmar}>
        <h2>Confira os dados lidos</h2>
        <p className="muted">Corrija o que for preciso antes de confirmar.</p>
        {imagem && <img className="foto foto-previa" src={imagem.dataUrl} alt="Foto do canhoto" />}

        <label className="campo">
          <span>{CAMPO_ROTULO.numeroNota} *</span>
          <input inputMode="numeric" required {...campo('numeroNota')} />
        </label>
        <label className="campo">
          <span>{CAMPO_ROTULO.cliente} *</span>
          <input required {...campo('cliente')} />
        </label>
        <label className="campo">
          <span>{CAMPO_ROTULO.dataAssinatura} *</span>
          <input type="date" required max={new Date().toISOString().slice(0, 10)} {...campo('dataAssinatura')} />
        </label>
        <label className="campo">
          <span>{CAMPO_ROTULO.assinadoPor}</span>
          <input {...campo('assinadoPor')} />
        </label>
        <label className="campo">
          <span>{CAMPO_ROTULO.observacao}</span>
          <textarea rows={3} {...campo('observacao')} />
        </label>

        {erroForm && <Erro>{erroForm}</Erro>}

        <div className="acoes">
          <button type="submit" className="btn btn-primario" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Confirmar e salvar'}
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
      <h2>Digitalizar canhoto</h2>

      {etapa === 'falha' && (
        <Erro>
          {erro ? (
            erro
          ) : (
            <>
              Não foi possível ler: <strong>{faltando.map((f) => CAMPO_ROTULO[f]).join(', ')}</strong>. Nada foi
              salvo. Tire uma nova foto, bem enquadrada, com boa luz e sem reflexos.
            </>
          )}
        </Erro>
      )}

      {etapa === 'inicio' && (
        <p className="muted">Fotografe o canhoto inteiro, com o texto legível, boa iluminação e sem cortes.</p>
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
