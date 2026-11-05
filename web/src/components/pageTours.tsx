import type { TourStep } from './Tour';

// One short tour per screen. Targets are data-tour attributes on the page; missing ones are skipped.
type PageTour = { pattern: string; key: string; title: string; steps: TourStep[] };

// Order of the section-to-section chain; detail screens hand over to the section that follows their group.
const NEXT: Record<string, string> = {
  '/': '/empresas',
  '/empresas': '/empresas/nova',
  '/empresas/nova': '/empresas/duplicadas',
  '/empresas/duplicadas': '/descoberta',
  '/descoberta': '/campanhas',
  '/empresas/:ref': '/campanhas',
  '/campanhas': '/revisao',
  '/campanhas/:name': '/revisao',
  '/campanhas/:name/personalizar/:domain': '/revisao',
  '/revisao': '/envio',
  '/envio': '/conciliacao',
  '/conciliacao': '/followups',
  '/followups': '/respostas',
  '/respostas': '/relatorio',
  '/relatorio': '/supressoes',
  '/supressoes': '/configuracoes',
};

export const PAGE_TOURS: PageTour[] = [
  {
    pattern: '/',
    key: 'tour.page.hoje',
    title: 'Hoje',
    steps: [
      { title: 'Hoje', body: 'Tudo que precisa de você hoje, em ordem de urgência. Quando não há nada pendente, a tela mostra como começar.' },
      {
        target: 'today-queue',
        title: 'Fila do dia',
        body: 'De cima para baixo: envios sem confirmação, falhas, rascunhos para revisar, mensagens aprovadas, follow-ups vencidos, próximas ações e empresas prontas. Cada item leva direto para onde se resolve.',
      },
      { target: 'today-limit', title: 'Limite diário', body: 'Quantos envios já saíram hoje e quantos restam. O contador zera à meia-noite UTC (21h em Brasília).' },
      { target: 'today-month', title: 'Resumo do mês', body: 'Abordados, respostas, interessados e oportunidades. Com menos de 30 abordados aparece o aviso de amostra pequena.' },
      { target: 'today-window', title: 'Janela de envio', body: 'O horário comercial do Reino Unido e dos EUA cai entre 11h e 15h em Brasília. A linha marca agora.' },
    ],
  },
  {
    pattern: '/empresas',
    key: 'tour.page.empresas',
    title: 'Empresas',
    steps: [
      { target: 'companies-actions', title: 'Cadastrar', body: 'Nova empresa, importação de CSV (com prévia, sem gravar nada antes) e a lista de possíveis duplicadas.' },
      { target: 'companies-views', title: 'Lista ou kanban', body: 'No kanban você arrasta a empresa entre status. Colunas que a regra não permite ficam esmaecidas, e mudanças que exigem motivo abrem um diálogo.' },
      { target: 'companies-saved', title: 'Filtros salvos', body: 'Atalhos prontos e os seus. “Salvar filtro atual” guarda a combinação de status e filtros neste navegador.' },
      { target: 'companies-status', title: 'Filtro por status', body: 'Clique em um ou mais status. O número mostra quantas empresas há em cada um com os demais filtros.' },
      { target: 'companies-filters', title: 'Outros filtros', body: 'País, tecnologia, prioridade, porte, contatos, próxima ação e atividade recente.' },
      { target: 'companies-list', title: 'A base', body: 'Pontuação e cobertura da qualificação, tecnologias da sua stack em destaque, próxima ação e campanha atual. Clique no nome para abrir a empresa.' },
    ],
  },
  {
    pattern: '/empresas/nova',
    key: 'tour.page.cadastros',
    title: 'Cadastros e importação',
    steps: [
      { target: 'register-tabs', title: 'Quatro formas de cadastrar', body: 'Empresa, contato, evidência ou um CSV inteiro. Contato e evidência pedem para escolher a empresa.' },
      {
        target: 'register-domain',
        title: 'Domínio é a chave',
        body: 'O domínio sai da URL automaticamente. Se ele já existir, o cadastro é bloqueado; se for subdomínio ou nome parecido, aparece um aviso.',
      },
      { target: 'register-submit', title: 'Depois de cadastrar', body: 'A empresa nasce como Identificada e você vai direto para as evidências dela. Sem um fato verificado de modelo de negócio, ela não pode ser qualificada.' },
    ],
  },
  {
    pattern: '/empresas/duplicadas',
    key: 'tour.page.duplicadas',
    title: 'Possíveis duplicadas',
    steps: [
      {
        title: 'Possíveis duplicadas',
        body: 'Grupos de empresas com nome parecido ou subdomínio, lado a lado. Nada é mesclado sozinho: mantenha a que tem mais histórico e desqualifique a outra com o motivo “duplicada de…”.',
      },
    ],
  },
  {
    pattern: '/descoberta',
    key: 'tour.page.descoberta',
    title: 'Descoberta',
    steps: [
      { target: 'prospect-status', title: 'Créditos, IA e pendentes', body: 'Saldo do Hunter, o modelo que qualifica e quantas empresas da base a IA ainda não julgou. “Qualificar pendentes” roda só a IA nelas, sem gastar crédito.' },
      { target: 'prospect-form', title: '1 · Onde procurar', body: 'País, estado e cidade, tamanho e, no avançado, palavras-chave. Nos EUA a cidade exige o estado.' },
      { target: 'prospect-credits', title: '2 · Decisores', body: 'Liga ou desliga a busca de decisores, o único passo que gasta crédito, e só para empresas que a IA qualificou. O teto para a execução antes de passar dele.' },
      { target: 'prospect-run', title: '3 · Conferir e rodar', body: 'O custo no pior caso e o saldo depois. A prévia é grátis e obrigatória: mostra quantas empresas são novas antes de rodar.' },
      { target: 'prospect-history', title: 'Últimas buscas', body: 'Cada execução com quantas foram lidas, qualificadas, para revisar, descartadas e os créditos gastos. A busca em andamento aparece no topo e atualiza sozinha.' },
      { target: 'prospect-review', title: 'Para revisar', body: 'O que a IA não decidiu, agrupado pelo motivo. Cada linha tem uma saída: abrir o site, tentar de novo (grátis), julgar na empresa ou descartar com motivo. Selecione várias para agir em lote.' },
    ],
  },
  {
    pattern: '/empresas/:ref',
    key: 'tour.page.empresa',
    title: 'Empresa',
    steps: [
      { target: 'company-status', title: 'Mudar status', body: 'Mostra só as transições que a regra permite. Algumas exigem motivo, e Qualificada exige um fato verificado de modelo de negócio.' },
      { target: 'company-next', title: 'Próxima ação', body: 'Data e nota do que fazer. Aparece em Hoje quando vence. Envios e respostas também agendam a próxima ação sozinhos.' },
      {
        target: 'company-tabs',
        title: 'Tudo sobre a empresa',
        body: 'Visão geral e notas, evidências (fato ou hipótese, com fonte), contatos, qualificação critério a critério, mensagens e respostas, e o histórico completo, que nunca é apagado.',
      },
    ],
  },
  {
    pattern: '/campanhas',
    key: 'tour.page.campanhas',
    title: 'Campanhas',
    steps: [
      { target: 'campaigns-new', title: 'Nova campanha', body: 'Nasce como rascunho. Só envia depois que você aprovar o template e ativar.' },
      { target: 'campaigns-list', title: 'Comparar campanhas', body: 'Empresas, rascunhos, aprovadas, enviadas, falhas e a taxa de resposta com numerador e denominador. Clique no nome para abrir o passo a passo.' },
    ],
  },
  {
    pattern: '/campanhas/:name',
    key: 'tour.page.campanha',
    title: 'Campanha',
    steps: [
      {
        target: 'campaign-steps',
        title: 'Passo a passo',
        body: 'Criar, templates, ativar, selecionar, rascunhos, revisão e envio. Cada etapa mostra se está concluída, pendente ou bloqueada, e o motivo. Clique para abrir.',
      },
      { target: 'campaign-actions', title: 'Pausar e encerrar', body: 'Pausar segura todos os envios até retomar. Encerrar é definitivo e libera as empresas para outra campanha.' },
      { target: 'campaign-metrics', title: 'Métricas', body: 'Taxas da campanha com numerador, denominador e definição. Passe o mouse para ver a definição completa.' },
    ],
  },
  {
    pattern: '/campanhas/:name/personalizar/:domain',
    key: 'tour.page.personalizar',
    title: 'Personalizar mensagem',
    steps: [
      { target: 'personalize-facts', title: 'Fatos verificados', body: 'Marque o fato que sustenta o motivo. Hipóteses e fatos contrários aparecem, mas não podem ser citados.' },
      { target: 'personalize-reason', title: 'Motivo e preview', body: 'Uma frase em inglês ligada ao fato. O preview mostra o e-mail exatamente como sai, rodapé incluído.' },
      { target: 'personalize-save', title: 'Salvar', body: 'Personalizada ou genérica, o rascunho vai para a fila de revisão. Nada é enviado daqui.' },
    ],
  },
  {
    pattern: '/revisao',
    key: 'tour.page.revisao',
    title: 'Revisão',
    steps: [
      { target: 'review-mail', title: 'Como o destinatário vê', body: 'Remetente, assunto, corpo e rodapé. Mensagens genéricas vêm com aviso para você decidir se fazem sentido.' },
      { target: 'review-actions', title: 'Decidir', body: 'A aprova e trava o conteúdo, E edita, S pula. Cancelar pede motivo, que fica no histórico.' },
      { target: 'review-context', title: 'Contexto', body: 'Status e pontuação da empresa, o contato e as evidências que a mensagem cita.' },
    ],
  },
  {
    pattern: '/envio',
    key: 'tour.page.envio',
    title: 'Envio',
    steps: [
      { target: 'send-campaign', title: 'Escolha a campanha', body: 'A simulação roda na hora e mostra o que sairia e o que está bloqueado, com o motivo.' },
      { target: 'send-mode', title: 'Simulação ou real', body: 'Em simulação os e-mails viram arquivos locais. Com SMTP real, a confirmação exige digitar ENVIAR.' },
      { target: 'send-steps', title: 'Três passos', body: 'Simular, confirmar e enviar. Durante o envio você acompanha cada mensagem e pode interromper com segurança. Rodar de novo nunca duplica.' },
    ],
  },
  {
    pattern: '/conciliacao',
    key: 'tour.page.conciliacao',
    title: 'Conciliação e falhas',
    steps: [
      { target: 'conc-unknown', title: 'Sem confirmação', body: 'O provedor pode ou não ter aceitado. Confira a pasta Enviados da caixa e registre se foi ou não enviada.' },
      { target: 'conc-failed', title: 'Falhas', body: 'O provedor recusou. Tente de novo (volta para aprovada) ou cancele com motivo. Nada é reenviado sozinho.' },
    ],
  },
  {
    pattern: '/followups',
    key: 'tour.page.followups',
    title: 'Follow-ups',
    steps: [
      { title: 'Follow-ups', body: 'No máximo um follow-up, alguns dias úteis depois do primeiro e-mail. Antes de cada um o sistema confere resposta, recusa, supressão e status.' },
      { target: 'followups-board', title: 'Quem pode e quem não pode', body: 'Vencidos, aguardando e barrados, com o motivo. Os vencidos ganham um botão para gerar rascunhos, que vão para a revisão.' },
    ],
  },
  {
    pattern: '/respostas',
    key: 'tour.page.respostas',
    title: 'Respostas',
    steps: [
      { target: 'replies-record', title: 'Registrar', body: 'Escolha o contato e a categoria. Antes de salvar, a tela explica o efeito: parar a sequência, mudar o status ou suprimir o endereço para sempre.' },
      { target: 'replies-filters', title: 'Filtrar', body: 'Por categoria e por campanha.' },
      { target: 'replies-list', title: 'Corrigir', body: 'A classificação pode ser corrigida; a correção fica no histórico. Respostas de interesse oferecem o atalho para mover a empresa para Interessada.' },
    ],
  },
  {
    pattern: '/relatorio',
    key: 'tour.page.relatorio',
    title: 'Relatório',
    steps: [
      { target: 'report-filters', title: 'Período e campanha', body: 'O período considera quem recebeu o primeiro e-mail nele. Respostas desse grupo contam mesmo se chegaram depois.' },
      { target: 'report-rates', title: 'Taxas', body: 'Resposta, interesse, conversão e falha de envio, sempre com numerador e denominador. Sem denominador aparece “—”, nunca 0%.' },
      { target: 'report-groups', title: 'Comparações', body: 'Por campanha, país e genérica x personalizada. Com amostras pequenas, trate como indício, não como conclusão.' },
    ],
  },
  {
    pattern: '/supressoes',
    key: 'tour.page.supressoes',
    title: 'Supressões',
    steps: [
      { target: 'supp-check', title: 'Verificar', body: 'Confira se um e-mail ou domínio está bloqueado antes de cadastrar um contato.' },
      { target: 'supp-add', title: 'Adicionar', body: 'Bloqueia um e-mail ou um domínio inteiro. É permanente: o banco não deixa remover.' },
      { target: 'supp-list', title: 'Lista', body: 'Só o hash do endereço é guardado. Quando o contato ainda existe, a lista mostra quem é.' },
    ],
  },
  {
    pattern: '/configuracoes',
    key: 'tour.page.configuracoes',
    title: 'Configurações',
    steps: [
      { target: 'settings-sender', title: 'Remetente e transporte', body: 'Vêm do .env e não são editados aqui, para a senha nunca passar pelo navegador. O botão envia um teste para você mesmo.' },
      { target: 'settings-dns', title: 'Entregabilidade', body: 'Consulta MX, SPF, DKIM e DMARC do seu domínio e lista os passos manuais (Cloudflare, Zoho, senha de app, aquecimento).' },
      { target: 'settings-rules', title: 'Regras de envio', body: 'Limite diário, intervalo, follow-ups e rodapé. Salvar grava config/sending.json e vale na hora.' },
      { target: 'settings-stack', title: 'Minha stack', body: 'A lista que dá a nota de stack: a parte da stack da empresa que está aqui. Adicione ou remova tecnologias e reavalie as empresas.' },
      { target: 'settings-scoring', title: 'Pesos da qualificação', body: 'Salvar cria uma nova versão; reavalie as empresas para aplicar.' },
      { target: 'settings-checklist', title: 'Antes da primeira campanha real', body: 'Marque cada item conforme cumprir. Fica salvo neste navegador.' },
    ],
  },
];

const segments = (path: string) => path.replace(/\/+$/, '').split('/');

export const pageTourFor = (path: string): PageTour | undefined => {
  const actual = path === '/' ? [''] : segments(path);
  return PAGE_TOURS.find((tour) => {
    const pattern = tour.pattern === '/' ? [''] : segments(tour.pattern);
    return pattern.length === actual.length && pattern.every((part, index) => part.startsWith(':') || part === actual[index]);
  });
};

export const nextSection = (tour: PageTour): { path: string; tour: PageTour } | undefined => {
  const path = NEXT[tour.pattern];
  const target = path ? PAGE_TOURS.find((item) => item.pattern === path) : undefined;
  return path && target ? { path, tour: target } : undefined;
};
