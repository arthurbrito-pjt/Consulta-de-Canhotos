import type { ReactNode } from 'react';

export function Carregando({ texto = 'Carregando...', tela = false }: { texto?: string; tela?: boolean }) {
  return (
    <div className={tela ? 'estado estado-tela' : 'estado'} role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{texto}</span>
    </div>
  );
}

export function Erro({ children }: { children: ReactNode }) {
  return (
    <div className="alerta alerta-erro" role="alert">
      {children}
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="estado estado-vazio">{children}</div>;
}
