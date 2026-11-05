import type { Company } from '../core/entities/company.js';
import type { QualificationResult } from '../core/entities/qualification.js';
import type { CompanyListItem } from '../core/ports/store.js';
import type { CompanyHistory } from '../core/use-cases/companies.js';
import type { ImportReport } from '../core/use-cases/imports.js';

const OUTCOME_MARK = { met: '[ok]', partial: '[~] ', not_met: '[x] ', unknown: '[?] ' } as const;

export const formatQualification = (result: QualificationResult): string[] => [
  `Pontuação ${result.score}/${result.maxScore} | cobertura ${Math.round(result.coverage * 100)}% | prioridade sugerida: ${result.suggestedPriority ?? 'indefinida (dados insuficientes)'}`,
  ...result.criteria.map((criterion) => `  ${OUTCOME_MARK[criterion.outcome]} ${criterion.label}: ${criterion.points}/${criterion.weight} — ${criterion.detail}`),
  ...(result.missingRequired.length ? [`  Falta fato verificado para qualificar: ${result.missingRequired.join(', ')}`] : []),
  `  (config v${result.configVersion}, avaliado em ${result.evaluatedAt})`,
];

const pad = (value: string, width: number): string => (value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width));

export const formatCompanyList = (items: CompanyListItem[]): string[] => {
  if (items.length === 0) return ['Nenhuma empresa encontrada.'];
  const header = `${pad('DOMÍNIO', 28)} ${pad('NOME', 24)} ${pad('PAÍS', 4)} ${pad('STATUS', 15)} ${pad('PRIOR.', 7)} ${pad('FUNC.', 6)} ${pad('CONT.', 5)} PRÓXIMA AÇÃO`;
  return [
    header,
    ...items.map(
      (item) =>
        `${pad(item.domain, 28)} ${pad(item.name, 24)} ${pad(item.country, 4)} ${pad(item.status, 15)} ${pad(item.priority ?? '-', 7)} ${pad(String(item.employeeCount ?? '-'), 6)} ${pad(String(item.contactCount), 5)} ${item.nextActionAt ? `${item.nextActionAt} ${item.nextActionNote ?? ''}` : '-'}`,
    ),
    `${items.length} empresa(s)`,
  ];
};

const field = (label: string, value: unknown): string | undefined =>
  value === undefined || value === '' || (Array.isArray(value) && value.length === 0) ? undefined : `  ${label}: ${Array.isArray(value) ? value.join(', ') : String(value)}`;

export const formatCompany = (company: Company): string[] =>
  [
    `${company.name} (${company.domain}) — ${company.status}`,
    field('ID', company.id),
    field('Site', company.website),
    field('País', [company.country, company.region].filter(Boolean).join(' / ')),
    field('Segmento', company.segment),
    field('Funcionários (aprox.)', company.employeeCount),
    field('Serviços', company.services),
    field('Tecnologias', company.technologies),
    field('Fonte', company.source),
    field('Última verificação', company.lastVerifiedAt),
    field('Prioridade', company.priority),
    field('Motivo da desqualificação', company.disqualificationReason),
    field('Próxima ação', company.nextActionAt ? `${company.nextActionAt} ${company.nextActionNote ?? ''}`.trim() : undefined),
    field('Observações', company.notes),
  ].filter((line): line is string => line !== undefined);

export const formatHistory = (history: CompanyHistory): string[] => [
  ...formatCompany(history.company),
  '',
  `Contatos (${history.contacts.length}):`,
  ...history.contacts.map(
    (contact) =>
      `  - ${contact.name}${contact.role ? `, ${contact.role}` : ''}${contact.email ? ` <${contact.email}>` : ''} [${contact.verificationStatus}${contact.doNotContact ? ', NÃO CONTATAR' : ''}]${contact.source ? ` fonte: ${contact.source}` : ''} id=${contact.id}`,
  ),
  '',
  `Evidências (${history.evidences.length}):`,
  ...history.evidences.map(
    (evidence) =>
      `  - [${evidence.certainty === 'verified' ? 'fato' : 'hipótese'}/${evidence.kind}/${evidence.stance}] ${evidence.claim}${evidence.source ? ` — ${evidence.source}` : ''} (${evidence.observedAt}) id=${evidence.id}`,
  ),
  ...(history.company.qualification ? ['', 'Última avaliação:', ...formatQualification(history.company.qualification)] : []),
  '',
  'Histórico:',
  ...history.interactions.map((interaction) => `  ${interaction.occurredAt.replace('T', ' ').slice(0, 19)}  ${interaction.type.padEnd(24)} ${interaction.summary}`),
];

export const formatImport = (report: ImportReport): string[] => [
  `Criados: ${report.created.length} | ignorados (já existiam): ${report.skipped.length} | com erro: ${report.failed.length}`,
  ...report.skipped.map((item) => `  linha ${item.line} ignorada (${item.label}): ${item.reason}`),
  ...report.failed.map((item) => `  linha ${item.line} ERRO (${item.label}): ${item.error}`),
];
