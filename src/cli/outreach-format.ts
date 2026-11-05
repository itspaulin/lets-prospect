import type { Message } from '../core/entities/outreach.js';
import type { Report } from '../core/use-cases/report.js';
import type { SendReport } from '../core/use-cases/send.js';

const LABEL: Record<string, string> = { sent: 'enviada', failed: 'FALHOU', unknown: 'SEM CONFIRMAÇÃO', cancelled: 'cancelada', skipped: 'adiada', would_send: 'seria enviada' };

export const formatMessage = (message: Message, company?: string): string[] => [
  `Mensagem ${message.id}  [${message.status}] etapa ${message.step} — ${message.personalization === 'generic' ? 'GENÉRICA (sem personalização verificada)' : 'personalizada com evidência'}`,
  `Para: ${message.toEmail}${company ? ` (${company})` : ''}`,
  `Assunto: ${message.subject}`,
  '',
  message.body,
  ...(message.error ? ['', `Erro: ${message.error}`] : []),
  ...(message.cancelReason ? ['', `Cancelada: ${message.cancelReason}`] : []),
];

export const formatMessageRow = (message: Message, company?: string): string =>
  `${message.id}  ${message.status.padEnd(9)} etapa ${message.step}  ${(company ?? '').padEnd(24)} ${message.toEmail.padEnd(30)} ${message.personalization === 'generic' ? 'genérica' : 'personalizada'}`;

export const formatSendReport = (report: SendReport, companyOf: (message: Message) => string): string[] => [
  `Transporte: ${report.transport}${report.delivers ? '' : ' — nada foi enviado de verdade'}`,
  ...report.outcomes.map((item) => `  ${LABEL[item.outcome]!.padEnd(16)} ${companyOf(item.message).padEnd(24)} ${item.message.toEmail}${item.detail ? ` — ${item.detail}` : ''}`),
  `Total: ${report.outcomes.length} | restam ${report.remainingToday} envios no limite de hoje`,
  ...(report.outcomes.some((item) => item.outcome === 'unknown')
    ? ['ATENÇÃO: confira na pasta Enviados as mensagens sem confirmação e use "message resolve <id> --sent|--not-sent".']
    : []),
];

const pct = (value: number | null) => (value === null ? 'n/d' : `${value}%`);

export const formatReport = (report: Report): string[] => [
  `Relatório${report.period.campaign ? ` da campanha ${report.period.campaign}` : ''} — período: ${report.period.from ?? 'início'} a ${report.period.to ?? 'hoje'}`,
  '',
  'Operação',
  ...Object.entries(report.operational).map(([label, value]) => `  ${label.padEnd(56)} ${value}`),
  '',
  'Empresas por status',
  `  ${Object.entries(report.companiesByStatus).filter(([, count]) => count > 0).map(([status, count]) => `${status}: ${count}`).join(' | ') || 'nenhuma'}`,
  '',
  'Indicadores',
  ...report.rates.map((rate) => `  ${rate.name.padEnd(24)} ${pct(rate.value).padStart(6)}  (${rate.numerator}/${rate.denominator}) ${rate.definition}`),
  ...(['byCampaign', 'byCountry', 'byPersonalization'] as const).flatMap((key) => {
    const title = { byCampaign: 'Por campanha', byCountry: 'Por país', byPersonalization: 'Por tipo de mensagem' }[key];
    const rows = report[key];
    if (rows.length === 0) return [];
    return [
      '',
      `${title} (abordados | resposta | interesse | conversão)`,
      ...rows.map((cohort) => `  ${cohort.label.padEnd(24)} ${String(cohort.reached).padStart(4)} | ${cohort.rates.map((rate) => `${pct(rate.value)} (${rate.numerator}/${rate.denominator})`).join(' | ')}`),
    ];
  }),
  ...(report.warnings.length ? ['', ...report.warnings.map((warning) => `Aviso: ${warning}`)] : []),
  '',
  'Envio não é entrega: o SMTP não informa entrega nem abertura, então esses números não são estimados.',
];
