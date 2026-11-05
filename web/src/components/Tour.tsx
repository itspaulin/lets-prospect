import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { navigate } from '../router';

export type TourStep = { target?: string; path?: string; title: string; body: React.ReactNode };

export const MAIN_TOUR: TourStep[] = [
  {
    title: 'Bem-vindo ao Prospecção',
    body: (
      <>
        Este tour passa por todas as áreas em cerca de 1 minuto. O fluxo é: cadastrar e qualificar empresas, montar uma campanha, revisar as mensagens, enviar e
        acompanhar as respostas. Nada é enviado sem a sua aprovação.
      </>
    ),
  },
  {
    target: '/',
    path: '/',
    title: 'Hoje',
    body: 'Sua fila do dia: envios para conciliar, rascunhos para revisar, mensagens prontas para enviar, follow-ups vencidos e próximas ações. Comece o dia por aqui.',
  },
  {
    target: '/empresas',
    path: '/empresas',
    title: 'Empresas',
    body: 'A base de prospecção, em lista ou kanban por status. Cada empresa tem evidências (fato ou hipótese, sempre com fonte), contatos, qualificação e histórico. Cadastre uma por vez ou importe um CSV.',
  },
  {
    target: '/descoberta',
    path: '/descoberta',
    title: 'Descoberta',
    body: 'Busca empresas por país, estado e cidade, a IA lê o site de cada uma e qualifica, e só as qualificadas gastam crédito para achar decisores. O que a IA não decide fica para você revisar.',
  },
  {
    target: '/campanhas',
    path: '/campanhas',
    title: 'Campanhas',
    body: 'Agrupam empresas qualificadas com um template aprovado. O passo a passo vai de criar até enviar: template, ativação, seleção de empresas e rascunhos, personalizados com um fato verificado ou marcados como genéricos.',
  },
  {
    target: '/revisao',
    path: '/revisao',
    title: 'Revisão',
    body: 'Uma mensagem por vez, exatamente como o destinatário vai ver. Atalhos: A aprova, E edita, S pula. Aprovar trava o conteúdo; qualquer edição exige nova aprovação.',
  },
  {
    target: '/followups',
    path: '/followups',
    title: 'Follow-ups',
    body: 'Quem já pode receber o follow-up e quem foi barrado (respondeu, recusou, foi suprimido). Gerar os rascunhos leva para a revisão; nada sai sozinho.',
  },
  {
    target: '/respostas',
    path: '/respostas',
    title: 'Respostas',
    body: 'Registre cada resposta com a categoria. A tela mostra o efeito antes de salvar: parar a sequência, mudar o status da empresa ou suprimir o endereço para sempre.',
  },
  {
    target: '/relatorio',
    path: '/relatorio',
    title: 'Relatório',
    body: 'Taxas de resposta, interesse, conversão e falha, sempre com numerador e denominador, e comparações por campanha, país e genérica x personalizada. Exporta CSV.',
  },
  {
    target: '/supressoes',
    path: '/supressoes',
    title: 'Supressões',
    body: 'E-mails e domínios que nunca mais recebem nada. São permanentes e consultadas antes de cada envio.',
  },
  {
    target: '/configuracoes',
    path: '/configuracoes',
    title: 'Configurações',
    body: 'Remetente e SMTP (lidos do .env), checagem de SPF, DKIM e DMARC do seu domínio, e-mail de teste, regras de envio, pesos da qualificação e o checklist da primeira campanha.',
  },
  {
    target: 'search',
    title: 'Busca e ações (Ctrl+K)',
    body: 'Encontre qualquer empresa ou campanha e dispare ações como “Nova empresa” ou “Registrar resposta” sem tirar a mão do teclado.',
  },
  {
    target: 'transport',
    title: 'Modo de envio',
    body: 'Em “Simulação (outbox)” nada sai da máquina: os e-mails viram arquivos locais. Com o SMTP do Zoho configurado no .env, o selo muda para “Envio real” e o envio pede para digitar ENVIAR.',
  },
  {
    path: '/',
    title: 'Pronto para começar',
    body: (
      <>
        Ordem sugerida: <b>Configurações</b> (conferir remetente) → <b>Empresas</b> (cadastrar e qualificar) → <b>Campanhas</b> → <b>Revisão</b> → envio → <b>Respostas</b>. Cada tela
        também tem o próprio tour, no botão <b>Tour desta tela</b> no topo. Para rever este, use “Ver tour” no rodapé da barra lateral.
      </>
    ),
  },
];

export const MAIN_TOUR_KEY = 'tour.done';

export const isTourDone = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

export const markTourDone = (key: string) => {
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* storage blocked: the tour shows again next time */
  }
};

type Rect = { top: number; left: number; width: number; height: number };

const POPOVER_WIDTH = 400;
const POPOVER_SPACE = 250;

const find = (target: string) => document.querySelector<HTMLElement>(`[data-tour="${target}"]`);

// Steps whose element is not on screen (empty list, closed tab) are dropped when the tour starts,
// so the tour never points at nothing.
type TourProps = {
  steps: TourStep[];
  storageKey: string;
  onClose: () => void;
  // Cancelling stops every tour, not only this one.
  onCancel: () => void;
  // Section tours end by moving to the next section instead of closing.
  next?: { label: string; go: () => void };
};

export const Tour = ({ steps: allSteps, storageKey, onClose, onCancel, next }: TourProps) => {
  const [steps, setSteps] = useState(allSteps);
  const [index, setIndex] = useState(0);
  // Filtered after the first commit, when every element rendered alongside the tour is in the DOM.
  useLayoutEffect(() => setSteps(allSteps.filter((step) => !step.target || step.path || find(step.target))), [allSteps]);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = steps[index]!;
  const last = index === steps.length - 1;

  const finish = useCallback(() => {
    markTourDone(storageKey);
    if (next) next.go();
    else onClose();
  }, [onClose, storageKey, next]);
  const cancel = useCallback(() => {
    markTourDone(storageKey);
    onCancel();
  }, [onCancel, storageKey]);

  useEffect(() => {
    if (step.path && window.location.pathname !== step.path) navigate(step.path);
  }, [step]);

  useLayoutEffect(() => {
    let scrolled = false;
    const measure = () => {
      const element = step.target ? find(step.target) : null;
      if (!element) return setRect(null);
      if (!scrolled) {
        scrolled = true;
        const box = element.getBoundingClientRect();
        if (box.top < 60 || box.bottom > window.innerHeight - 40) element.scrollIntoView({ block: box.height > window.innerHeight * 0.6 ? 'start' : 'center' });
      }
      const box = element.getBoundingClientRect();
      setRect({ top: box.top, left: box.left, width: box.width, height: box.height });
    };
    measure();
    const frame = requestAnimationFrame(measure);
    const late = window.setTimeout(measure, 250);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(late);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
      if (event.key === 'ArrowRight' || event.key === 'Enter') (event.preventDefault(), last ? finish() : setIndex((value) => value + 1));
      if (event.key === 'ArrowLeft') setIndex((value) => Math.max(0, value - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish, cancel, last]);

  if (!step) {
    if (steps.length === 0) queueMicrotask(finish);
    return null;
  }
  const pad = 6;
  const left = (x: number) => Math.max(16, Math.min(x, window.innerWidth - POPOVER_WIDTH - 16));
  let popover: React.CSSProperties;
  if (!rect) popover = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  else if (rect.left < 260 && rect.width < 260 && rect.top > 40)
    popover = { top: Math.max(16, Math.min(rect.top - 12, window.innerHeight - 280)), left: rect.left + rect.width + 18 };
  else if (window.innerHeight - (rect.top + rect.height) >= POPOVER_SPACE) popover = { top: rect.top + rect.height + 14, left: left(rect.left) };
  else if (rect.top >= POPOVER_SPACE) popover = { bottom: window.innerHeight - rect.top + 14, left: left(rect.left) };
  else popover = { bottom: 24, right: 24 };

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={`Tour: ${step.title}`}>
      {rect ? (
        <div className="tour-spot" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-pop md" style={{ ...popover, width: `min(${POPOVER_WIDTH}px, calc(100vw - 32px))` }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="mt mono">
            {index + 1} de {steps.length}
          </span>
          <span className="mt" style={{ whiteSpace: 'nowrap' }}>
            <kbd>←</kbd> <kbd>→</kbd> · <kbd>Esc</kbd> cancela
          </span>
          <span className="sp" />
          <button className="bt sm gh" onClick={cancel}>
            Cancelar tour
          </button>
        </div>
        <h2 className="h" style={{ fontSize: 17 }}>
          {step.title}
        </h2>
        <div style={{ lineHeight: 1.5 }}>{step.body}</div>
        {steps.length > 1 && (
          <div className="prog" style={{ maxWidth: 'none', flex: 'none' }}>
            {steps.map((_, position) => (
              <i key={position} className={position < index ? 'd' : position === index ? 'c' : ''} />
            ))}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="bt" disabled={index === 0} onClick={() => setIndex((value) => value - 1)}>
            Voltar
          </button>
          <button className="bt p" onClick={() => (last ? finish() : setIndex((value) => value + 1))} autoFocus>
            {!last ? 'Próximo' : next ? `Ir para a próxima seção: ${next.label} →` : 'Concluir'}
          </button>
        </div>
      </div>
    </div>
  );
};
