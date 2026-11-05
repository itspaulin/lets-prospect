import { syncOptOuts } from '../core/use-cases/optouts.js';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { readCsv } from '../adapters/import/csv.js';
import { COMPANY_STATUSES, type CompanyStatus, type Priority } from '../core/entities/company.js';
import { DomainError } from '../core/errors.js';
import type { Deps } from '../core/ports/runtime.js';
import {
  addCompany,
  addCompanyNote,
  changeCompanyStatus,
  findDuplicateCandidates,
  getCompanyHistory,
  listCompanies,
  setNextAction,
  updateCompany,
} from '../core/use-cases/companies.js';
import { addContact, listContacts, updateContact } from '../core/use-cases/contacts.js';
import { addEvidence } from '../core/use-cases/evidences.js';
import { importCompanies, importContacts } from '../core/use-cases/imports.js';
import { evaluateCompany } from '../core/use-cases/qualification.js';
import { leadCommand } from './lead-commands.js';
import { whatsappCommand } from './whatsapp-commands.js';
import { prospectCommand } from './prospecting-commands.js';
import { formatCompany, formatCompanyList, formatHistory, formatImport, formatQualification } from './format.js';
import {
  campaignCommand,
  companyReady,
  contactForget,
  followupCommand,
  type Io,
  messageCommand,
  replyCommand,
  reportCommand,
  sendCommand,
  suppressCommand,
} from './outreach-commands.js';

const HELP = `Uso: npm run cli -- <comando>

Empresas
  company add --name N --website URL --country US [--region R] [--segment S] [--employees 20]
              [--services TXT] [--tech "React;Node.js"] [--source URL] [--verified-at AAAA-MM-DD] [--priority high|medium|low] [--notes TXT]
  company update <domínio|id> [mesmas opções; valor "" apaga o campo]
  company show <domínio|id>                     dados, contatos, evidências, avaliação e histórico
  company list [--status qualified,contacted] [--country US,GB] [--tech React] [--priority high]
               [--min-employees 5] [--max-employees 50] [--has-contacts yes|no] [--due-by AAAA-MM-DD]
               [--inactive-since AAAA-MM-DD] [--active-since AAAA-MM-DD] [--disqualified-reason TXT]
  company status <domínio|id> <status> [--reason TXT] [--override]
  company evaluate <domínio|id>                 calcula a pontuação com config/scoring.json
  company next <domínio|id> --at AAAA-MM-DD [--note TXT] | --clear
  company note <domínio|id> "texto"
  company duplicates                            possíveis duplicadas (nome parecido ou subdomínio)

Evidências
  evidence add <domínio|id> --kind business_model|size|technology|recurring_work|demand_signal|other
               --claim TXT --certainty verified|hypothesis [--source URL] [--contradicts] [--observed-at AAAA-MM-DD]

Contatos
  contact add <domínio|id> --name N [--role CTO] [--email E --source URL] [--profile URL] [--notes TXT] [--allow-domain-mismatch]
  contact update <e-mail|id> [--name] [--role] [--email] [--source] [--profile] [--notes]
               [--verification unverified|verified|invalid] [--do-not-contact | --allow-contact --reason TXT]
  contact list <domínio|id>

  contact forget <e-mail|id> --reason TXT       apaga dados pessoais a pedido; o endereço segue bloqueado

Campanhas
  company ready                                 empresas qualified com contato apto e fora de campanha
  campaign create <nome> [--market GB] [--segment TXT] [--criteria TXT]
  campaign template <nome> --step 0 --subject TXT --file corpo.txt     nova versão (precisa aprovar)
  campaign approve-template <nome> [--step 0]
  campaign activate|pause|close <nome>          activate = aprovação humana da campanha
  campaign add <nome> <domínio> [--contact e-mail]
  campaign select <nome> [--country GB,US] [--priority high] [--limit 10]
  campaign show <nome> | campaign list

Mensagens
  message draft <campanha> <domínio> [--reason "frase verificada" --evidence <id>] [--step N]
  message draft-all <campanha>                  rascunhos genéricos para quem ainda não tem
  message review <campanha>                     revisar rascunhos um a um: aprovar, editar, pular
  message list [campanha] [--status draft,approved]
  message show|edit|approve|retry <id>
  message cancel <id> --reason TXT
  message resolve <id> --sent|--not-sent [--note TXT]     conciliar envio sem confirmação

Envio
  send <campanha> [--dry-run] [--limit N] [--yes]

Acompanhamento
  followup due [campanha]
  followup draft <campanha>
  reply add <e-mail|id> --category CAT [--summary TXT] [--date AAAA-MM-DD]
  reply correct <id> --category CAT
  reply list [domínio]
  suppress email <e-mail> --reason TXT | suppress domain <domínio> --reason TXT
  optout sync                                   traz quem clicou no link de descadastro (o envio já faz isso sozinho)

Relatório
  report [--campaign nome] [--from AAAA-MM-DD] [--to AAAA-MM-DD]

Prospecção automática (hunter.io; precisa de HUNTER_API_KEY)
  prospect discover --country US [--state NY] [--city "New York"] [--headcount 11-50,51-200]
                    [--keywords "a,b"] [--limit 20] [--dry-run]
                                                grátis: acha empresas e cadastra como identified
  prospect qualify <domínio...> | --pending [--limit N]
                                                IA lê o site e qualifica ou desqualifica (precisa de AWS_BEARER_TOKEN_BEDROCK)
  prospect run --country US [--state NY] [--city "New York"] [--headcount ..] [--keywords ..] [--limit 20]
               [--max-credits 5] [--per-company 2]
                                                fluxo todo: discover, IA qualifica, só as qualificadas gastam crédito
  prospect contacts <domínio...> [--max-credits 5] [--per-company 2]
                                                gasta crédito: busca CEO/CTO/sócios e cadastra com a fonte
  prospect credits                              saldo de créditos do Hunter

Leads por telefone (Google Places; precisa de GOOGLE_PLACES_API_KEY)
  lead discover --city "Belo Horizonte" [--state MG] [--area Savassi] [--segment imobiliária] [--limit 20] [--dry-run]
                                                acha negócios locais com telefone e cadastra como identified
  lead qualify [--limit 50]                     IA lê o site e diz se é um bom perfil; só os bons são contatados
  lead auto                                     busca sozinho lugares novos (config/leads.json) quando faltam candidatos
  lead enrich [--limit 50] [--retry]            lê o site de cada lead e acha o WhatsApp que a empresa publica
  lead list [--status identified,replied] [--city "Belo Horizonte"]

Fila de WhatsApp (primeiro contato por lead; nada sai sem aprovação, em horário comercial e dentro do limite diário)
  wa run [--dry-run] [--limit N]                tudo de uma vez, para agendar: lê sites, prepara e envia
  wa draft [--limit 50]                         rascunhos para leads com WhatsApp, a partir de config/whatsapp.json
  wa list [--status draft,approved,sent]        wa show <id>        wa edit <id>
  wa approve <id...> | --all                    wa cancel <id> --reason TXT        wa retry <id>
  wa send [--dry-run] [--limit N]               envia os aprovados com espera aleatória entre eles
  wa resolve <id> --sent | --not-sent           concilia uma mensagem unknown
  wa suppress <telefone> --reason TXT           recusa de um lead: nunca mais contatar

Importação (CSV com cabeçalho; listas separadas por ";")
  import companies <arquivo.csv>   colunas: name,website,country,region,segment,employees,services,technologies,source,last_verified_at,notes
  import contacts <arquivo.csv>    colunas: company,name,role,email,source,profile_url,notes

Status: ${COMPANY_STATUSES.join(', ')}
Categorias de resposta: interested_to_talk, future_collaboration, more_info, cv_or_portfolio, no_need_now, declined,
  referral, auto_reply, invalid_address, unsubscribe, inconclusive`;

type Values = Record<string, string | boolean | undefined>;

const s = { type: 'string' } as const;
const b = { type: 'boolean' } as const;
const COMPANY_FIELDS = {
  name: s, website: s, country: s, region: s, segment: s, employees: s, services: s, tech: s, source: s, 'verified-at': s, priority: s, notes: s,
} satisfies ParseArgsConfig['options'];

const parse = (args: string[], options: ParseArgsConfig['options']) => {
  const { values, positionals } = parseArgs({ args, options, allowPositionals: true, strict: true });
  return { values: values as Values, positionals };
};

const str = (values: Values, key: string): string | undefined => {
  const value = values[key];
  return typeof value === 'string' ? value : undefined;
};

const clearable = (values: Values, key: string): string | null | undefined => {
  const value = str(values, key);
  return value === undefined ? undefined : value.trim() === '' ? null : value;
};

const integer = (raw: string | null | undefined, flag: string): number | null | undefined => {
  if (raw === undefined || raw === null) return raw;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new DomainError('validation', `--${flag} deve ser inteiro`);
  return parsed;
};

const csvList = (raw: string | undefined): string[] | undefined => (raw === undefined ? undefined : raw.split(/[;,]/).map((item) => item.trim()).filter(Boolean));

const required = (positionals: string[], index: number, label: string): string => {
  const value = positionals[index];
  if (!value) throw new DomainError('validation', `Informe ${label}`);
  return value;
};

const companyFields = (values: Values) => ({
  name: str(values, 'name'),
  website: str(values, 'website'),
  country: str(values, 'country'),
  region: clearable(values, 'region'),
  segment: clearable(values, 'segment'),
  employeeCount: integer(clearable(values, 'employees'), 'employees'),
  services: clearable(values, 'services'),
  technologies: csvList(str(values, 'tech')),
  source: clearable(values, 'source'),
  lastVerifiedAt: clearable(values, 'verified-at'),
  priority: clearable(values, 'priority') as Priority | null | undefined,
  notes: clearable(values, 'notes'),
});

const withoutNulls = <T extends object>(input: T): { [K in keyof T]: Exclude<T[K], null> } =>
  Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value === null ? undefined : value])) as never;

const companyCommand = (deps: Deps, sub: string | undefined, args: string[], io: Io): void => {
  switch (sub) {
    case 'add': {
      const { values } = parse(args, COMPANY_FIELDS);
      const { company, similar } = addCompany(deps, withoutNulls(companyFields(values)) as never);
      io.out(`Cadastrada: ${company.name} (${company.domain}) id=${company.id}`);
      if (!company.source) io.out('Aviso: sem --source. Registre de onde vieram os dados.');
      for (const other of similar) io.out(`Aviso: parecida com ${other.name} (${other.domain}). Confira duplicidade.`);
      return;
    }
    case 'update': {
      const { values, positionals } = parse(args, COMPANY_FIELDS);
      const company = updateCompany(deps, required(positionals, 0, 'a empresa'), companyFields(values) as never);
      formatCompany(company).forEach(io.out);
      return;
    }
    case 'show': {
      const { positionals } = parse(args, {});
      formatHistory(getCompanyHistory(deps, required(positionals, 0, 'a empresa'))).forEach(io.out);
      return;
    }
    case 'list': {
      const { values } = parse(args, {
        status: s, country: s, tech: s, priority: s, 'min-employees': s, 'max-employees': s, 'has-contacts': s,
        'due-by': s, 'inactive-since': s, 'active-since': s, 'disqualified-reason': s,
      });
      const statuses = csvList(str(values, 'status'));
      const invalid = statuses?.filter((status) => !COMPANY_STATUSES.includes(status as CompanyStatus));
      if (invalid?.length) throw new DomainError('validation', `Status inválido: ${invalid.join(', ')}`);
      const hasContacts = str(values, 'has-contacts');
      const items = listCompanies(deps, {
        statuses: statuses as CompanyStatus[] | undefined,
        countries: csvList(str(values, 'country')),
        technology: str(values, 'tech'),
        priority: str(values, 'priority') as Priority | undefined,
        minEmployees: integer(str(values, 'min-employees'), 'min-employees') ?? undefined,
        maxEmployees: integer(str(values, 'max-employees'), 'max-employees') ?? undefined,
        hasContacts: hasContacts === undefined ? undefined : ['yes', 'sim', 'true'].includes(hasContacts),
        nextActionDueBy: str(values, 'due-by'),
        lastInteractionBefore: str(values, 'inactive-since'),
        lastInteractionAfter: str(values, 'active-since'),
        disqualificationReason: str(values, 'disqualified-reason'),
      });
      formatCompanyList(items).forEach(io.out);
      return;
    }
    case 'status': {
      const { values, positionals } = parse(args, { reason: s, override: b });
      const to = required(positionals, 1, 'o novo status') as CompanyStatus;
      if (!COMPANY_STATUSES.includes(to)) throw new DomainError('validation', `Status inválido: ${to}`);
      const company = changeCompanyStatus(deps, required(positionals, 0, 'a empresa'), to, { reason: str(values, 'reason'), override: values.override === true });
      io.out(`${company.domain}: ${company.status}`);
      return;
    }
    case 'evaluate': {
      const { positionals } = parse(args, {});
      const { company, result } = evaluateCompany(deps, required(positionals, 0, 'a empresa'));
      io.out(`${company.name} (${company.domain})`);
      formatQualification(result).forEach(io.out);
      return;
    }
    case 'next': {
      const { values, positionals } = parse(args, { at: s, note: s, clear: b });
      const at = values.clear === true ? null : str(values, 'at');
      if (at === undefined) throw new DomainError('validation', 'Informe --at AAAA-MM-DD ou --clear');
      const company = setNextAction(deps, required(positionals, 0, 'a empresa'), { at, note: str(values, 'note') });
      io.out(`${company.domain}: próxima ação ${company.nextActionAt ?? 'removida'}`);
      return;
    }
    case 'note': {
      const { positionals } = parse(args, {});
      addCompanyNote(deps, required(positionals, 0, 'a empresa'), positionals.slice(1).join(' '));
      io.out('Nota registrada.');
      return;
    }
    case 'ready':
      companyReady(deps, io);
      return;
    case 'duplicates': {
      const groups = findDuplicateCandidates(deps);
      if (groups.length === 0) io.out('Nenhuma possível duplicidade.');
      groups.forEach((group, index) => io.out(`${index + 1}. ${group.map((company) => `${company.name} (${company.domain}, ${company.status})`).join('  |  ')}`));
      return;
    }
    default:
      throw new DomainError('validation', `Subcomando desconhecido: company ${sub ?? ''}`);
  }
};

const contactCommand = (deps: Deps, sub: string | undefined, args: string[], io: Io): void => {
  const fields = { name: s, role: s, email: s, source: s, profile: s, notes: s, 'allow-domain-mismatch': b };
  switch (sub) {
    case 'add': {
      const { values, positionals } = parse(args, fields);
      const contact = addContact(
        deps,
        required(positionals, 0, 'a empresa'),
        { name: str(values, 'name') ?? '', role: str(values, 'role'), email: str(values, 'email'), source: str(values, 'source'), profileUrl: str(values, 'profile'), notes: str(values, 'notes') },
        { allowDomainMismatch: values['allow-domain-mismatch'] === true },
      );
      io.out(`Contato cadastrado: ${contact.name} id=${contact.id}`);
      return;
    }
    case 'update': {
      const { values, positionals } = parse(args, { ...fields, verification: s, 'do-not-contact': b, 'allow-contact': b, reason: s });
      if (values['do-not-contact'] && values['allow-contact']) throw new DomainError('validation', 'Use --do-not-contact ou --allow-contact, não os dois');
      const contact = updateContact(
        deps,
        required(positionals, 0, 'o contato'),
        {
          name: str(values, 'name'),
          role: clearable(values, 'role'),
          email: clearable(values, 'email'),
          source: clearable(values, 'source'),
          profileUrl: clearable(values, 'profile'),
          notes: clearable(values, 'notes'),
          verificationStatus: str(values, 'verification') as never,
          doNotContact: values['do-not-contact'] ? true : values['allow-contact'] ? false : undefined,
        },
        { allowDomainMismatch: values['allow-domain-mismatch'] === true, reason: str(values, 'reason') },
      );
      io.out(`Contato atualizado: ${contact.name}${contact.doNotContact ? ' (NÃO CONTATAR)' : ''}`);
      return;
    }
    case 'list': {
      const { positionals } = parse(args, {});
      const contacts = listContacts(deps, required(positionals, 0, 'a empresa'));
      if (contacts.length === 0) io.out('Nenhum contato.');
      contacts.forEach((contact) =>
        io.out(`${contact.id}  ${contact.name}${contact.role ? `, ${contact.role}` : ''}${contact.email ? ` <${contact.email}>` : ''} [${contact.verificationStatus}${contact.doNotContact ? ', NÃO CONTATAR' : ''}]`),
      );
      return;
    }
    case 'forget':
      contactForget(deps, args, io);
      return;
    default:
      throw new DomainError('validation', `Subcomando desconhecido: contact ${sub ?? ''}`);
  }
};

const evidenceCommand = (deps: Deps, sub: string | undefined, args: string[], io: Io): void => {
  if (sub !== 'add') throw new DomainError('validation', `Subcomando desconhecido: evidence ${sub ?? ''}`);
  const { values, positionals } = parse(args, { kind: s, claim: s, certainty: s, source: s, contradicts: b, 'observed-at': s });
  const evidence = addEvidence(deps, required(positionals, 0, 'a empresa'), {
    kind: str(values, 'kind') as never,
    claim: str(values, 'claim') ?? '',
    certainty: str(values, 'certainty') as never,
    stance: values.contradicts ? 'contradicts' : 'supports',
    source: str(values, 'source'),
    observedAt: str(values, 'observed-at'),
  });
  io.out(`Evidência registrada (${evidence.certainty}): ${evidence.claim} id=${evidence.id}`);
};

const importCommand = (deps: Deps, sub: string | undefined, args: string[], io: Io): void => {
  const { positionals } = parse(args, {});
  const file = required(positionals, 0, 'o arquivo CSV');
  if (!existsSync(file)) throw new DomainError('not_found', `Arquivo não encontrado: ${file}`);
  if (sub === 'companies') formatImport(importCompanies(deps, readCsv(file))).forEach(io.out);
  else if (sub === 'contacts') formatImport(importContacts(deps, readCsv(file))).forEach(io.out);
  else throw new DomainError('validation', `Subcomando desconhecido: import ${sub ?? ''}`);
};

type Command = (deps: Deps, sub: string | undefined, args: string[], io: Io) => void | Promise<void>;

const optoutCommand: Command = async (deps, sub, _args, io) => {
  if (sub !== 'sync') throw new DomainError('validation', `Subcomando desconhecido: optout ${sub ?? ''}`);
  if (!deps.unsubscribe) throw new DomainError('requirement_missing', 'Descadastro por link não configurado (UNSUBSCRIBE_* no .env)');
  const result = await syncOptOuts(deps);
  io.out(`${result.checked} descadastro(s) no serviço; ${result.applied} novo(s) aplicado(s).`);
};

const COMMANDS: Record<string, Command> = {
  optout: optoutCommand,
  company: companyCommand,
  contact: contactCommand,
  evidence: evidenceCommand,
  import: importCommand,
  campaign: campaignCommand,
  message: messageCommand,
  send: sendCommand,
  followup: followupCommand,
  reply: replyCommand,
  suppress: suppressCommand,
  prospect: prospectCommand,
  lead: leadCommand,
  wa: whatsappCommand,
  report: (deps, sub, args, io) => reportCommand(deps, sub ? [sub, ...args] : args, io),
};

const terminalIo = (): Io => ({
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  prompt: async (question) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  },
  edit: async (text) => {
    const dir = mkdtempSync(join(tmpdir(), 'prospeccao-'));
    const file = join(dir, 'mensagem.txt');
    try {
      writeFileSync(file, text);
      const result = spawnSync(process.env.VISUAL || process.env.EDITOR || 'nano', [file], { stdio: 'inherit' });
      if (result.status !== 0) throw new DomainError('validation', 'Editor terminou com erro; nada foi alterado');
      return readFileSync(file, 'utf8');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
});

export const runCli = async (
  argv: string[],
  io: Io = terminalIo(),
  createDeps?: () => Deps & { close?: () => void },
): Promise<number> => {
  const [command, sub, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || !(command in COMMANDS)) {
    io.out(HELP);
    return command && !['help', '--help'].includes(command) ? 1 : 0;
  }
  const factory = createDeps ?? (await import('../infra/container.js')).createContainer;
  const deps = factory();
  try {
    await COMMANDS[command]!(deps, sub, rest, io);
    return 0;
  } catch (error) {
    if (error instanceof DomainError) {
      io.err(`Erro: ${error.message}`);
      return 1;
    }
    if (error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS')) {
      io.err(`Erro: ${error.message}`);
      return 1;
    }
    throw error;
  } finally {
    deps.close?.();
  }
};
