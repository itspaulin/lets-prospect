# Etapa A — Auditoria e proposta de arquitetura

Data: 2026-10-26. Referência: [SPEC.md](SPEC.md).

## 1. Diagnóstico da situação atual

`prospeccao/` é um diretório novo e vazio. Não há código, banco, integração nem deploy próprios. A auditoria olhou os projetos vizinhos em `~/Desktop/projetos` para reaproveitar padrões e evitar reinventar decisões já tomadas.

| Projeto | Stack | Relevância |
|---|---|---|
| `crawler-leads` | Node 24, TypeScript (ESM, NodeNext, strict), `better-sqlite3`, `zod`, `pino`, `cheerio`, `node:test` via `tsx`, CLI própria, arquitetura core/ports/adapters | **Alta.** Mesmo domínio (leads), mesma escala (uso pessoal, local). Padrão a seguir. |
| `hermes-v2` | TypeScript, AWS Lambda (SAM), Telegram, Obsidian Vault via GitHub, Bedrock, `vitest` | Baixa no MVP. Integração futura opcional (seção 16 da spec). |
| `CRM-Workspace`, `ibr-v2*`, `desmonte`, `prestacontas`, `broadcast` | Projetos de trabalho ou testes técnicos | Nenhuma. Não acoplar. |

Pontos observados em `crawler-leads`:

- `core/` com entidades, serviços puros e casos de uso; `ports/` como interfaces; `adapters/` para SQLite, busca, crawler e exportação; `infra/container.ts` compõe dependências; `cli/run.ts` apenas roteia comandos.
- Configuração validada com `zod` sobre `process.env` (`.env` via `dotenv`), `.env.example` sem segredos.
- Score atual é soma de pesos fixos no código e sem motivos registrados — exatamente o que a spec pede para evitar (3.3).
- ICP diferente (e-commerce brasileiro). Não há código de contatos, campanhas, mensagens, envio ou follow-up.
- `crawler-leads` não é um repositório git (não há `.git`); `hermes-v2` é.

## 2. O que pode ser reaproveitado

Reaproveitar **padrões e trechos**, não o projeto:

- Estrutura core/ports/adapters/infra/cli.
- Toolchain: TypeScript ESM, `tsx`, `node:test`, `zod`, `pino`, `better-sqlite3`, `dotenv`.
- `normalize-domain` (normalização de domínio para deduplicar empresas) — copiar com seus testes.
- Padrão de repositório SQLite com `ON CONFLICT` por chave natural.
- Padrão de modo `demo` com adapters falsos, útil para a campanha de teste.

Não reaproveitar agora: Brave Search e crawler Cheerio. A spec exige cadastro manual funcionando sem coleta automática (7.2). Ficam como evolução, eventualmente importando dados do `crawler-leads` por CSV/JSON.

Por que não estender `crawler-leads`: ICP e propósito diferentes, e a spec pede independência. Misturar os dois tornaria ambos mais difíceis de manter.

## 3. Lacunas em relação à spec

Tudo da seção 10 (MVP) precisa ser construído: empresas, contatos, evidências com fonte e grau (fato x hipótese), qualificação configurável com motivos, campanhas, modelos e rascunhos de mensagem, aprovação com trava de conteúdo, envio idempotente, lista de supressão, follow-ups, respostas classificadas, histórico, métricas e documentação operacional.

## 4. Arquitetura proposta para o MVP

### 4.1. Forma de operação: CLI local

Sem interface existente, a opção mais simples e sustentável é uma CLI local (`npm run cli -- <comando>`), igual ao `crawler-leads`. Edição de textos longos (rascunhos de mensagem, notas) abre o `$EDITOR`. Importação em lote por CSV para cadastrar empresas e contatos. Sem servidor, sem aplicação web.

Alternativa descartada por agora: interface web local. Pode vir depois, sobre os mesmos casos de uso, se a CLI virar gargalo.

### 4.2. Componentes

```
src/
  core/
    entities/      Company, Contact, Evidence, Campaign, Template, Message, Interaction, Suppression
    rules/         transições de estado, qualificação, elegibilidade de envio e de follow-up (funções puras)
    ports/         Repositórios, EmailSender, Clock, IdGenerator
    use-cases/     cadastrar, qualificar, montar campanha, gerar rascunho, aprovar, enviar, registrar resposta, follow-up, relatório
  adapters/
    persistence/   SQLite (better-sqlite3) + migrações versionadas
    email/         SmtpEmailSender (nodemailer), FakeEmailSender (testes/demo)
    import/        CSV
  infra/           env (zod), container, logger (pino com redação de e-mails)
  cli/             parsing e saída
config/
  scoring.json     critérios e pesos da qualificação
  sending.json     limites diários, janela de horário, regras de follow-up
data/              prospeccao.db (fora do git)
```

As regras em `core/rules` não conhecem SQLite, SMTP nem CLI (spec 6.3).

### 4.3. Modelo de dados (esboço)

- `companies`: dados da 3.1, `domain` normalizado `UNIQUE`, `status`, `priority`, `next_action_at`, `next_action_note`, `disqualification_reason`.
- `evidences`: `company_id`, `kind` (`icp_fit` | `opportunity_signal` | `tech`), `claim`, `certainty` (`verified` | `hypothesis`), `source_url`, `verified_at`. Separa fato de hipótese (2.3).
- `contacts`: `company_id`, nome, cargo, `email` normalizado `UNIQUE`, `source_url` (onde o e-mail está publicado), `verification_status`, `do_not_contact`.
- `suppressions`: `email` ou `domain`, motivo, data. Consultada antes de qualquer envio, independentemente do status da empresa.
- `campaigns`: nome, critérios, mercado, `status` (`draft` | `approved` | `active` | `paused` | `closed`), `approved_at`.
- `templates`: corpo e assunto versionados; uma versão aprovada fica imutável.
- `messages`: `campaign_id`, `contact_id`, `step` (0 = primeiro contato, 1..n = follow-ups), `subject`, `body`, `personalization` (`evidence_based` | `generic`), `content_hash`, `status`, `provider_message_id`, `error`, timestamps. `UNIQUE(campaign_id, contact_id, step)`.
- `interactions`: log somente de inclusão (cadastro, mudança de status, envio, falha, resposta, nota, próxima ação). Base do histórico (3.10) e das métricas.
- `schema_migrations`.

### 4.4. Estados da empresa (redução proposta)

De 15 para 11 estados persistidos:

`identified` → `qualified` | `disqualified` → `contacted` → `replied` → `interested` → `opportunity` → `converted`, mais `not_interested`, `do_not_contact` e `inactive`.

Removidos como estado, mantidos como informação derivada:

- `researching`: fica em `identified`; o progresso aparece pelas evidências registradas.
- `ready_for_contact`: derivado (qualificada + contato verificado + não suprimida). Persistir criaria duas fontes de verdade.
- `follow_up_due`: derivado de `next_action_at` vencido. Como estado, competiria com `contacted`.
- `meeting_scheduled`: vira interação dentro de `interested`/`opportunity`.

Transições validadas por uma tabela explícita em `core/rules`. `do_not_contact` é terminal para envio: nenhuma transição automática sai dele; só um comando manual com motivo registrado.

### 4.5. Qualificação

`config/scoring.json` lista critérios (modelo de negócio, tamanho, país, stack, recorrência, sinais de demanda, contato relevante, confiabilidade), cada um com peso e regra de avaliação sobre campos e evidências. O resultado guarda pontuação, critérios atendidos, não atendidos e **desconhecidos** (dado ausente não conta como negativo nem positivo). Evidência `hypothesis` vale menos que `verified`. Os pesos iniciais são um ponto de partida documentado, para recalibrar com dados de novembro. A decisão final de qualificar continua humana; a pontuação só ordena e explica.

### 4.6. Mensagens e aprovação

1. Template por campanha com placeholders (`{{company.name}}`, `{{evidence.reason}}`...).
2. Rascunho gerado por contato. Se não houver evidência verificada para o motivo do contato, o rascunho é marcado `generic` e não recebe frase que simule pesquisa.
3. Revisão no `$EDITOR`; aprovação grava `content_hash`.
4. No envio, o hash é recalculado; se divergir, o envio é recusado (preserva o conteúdo aprovado).

Geração por IA não entra no MVP. Pode ser um adapter opcional depois, sempre passando pela mesma aprovação.

### 4.7. Envio idempotente

Estados da mensagem: `draft` → `approved` → `sending` → `sent` | `failed` | `unknown`.

- Antes de chamar o provedor, uma transação muda `approved` → `sending` e grava um `Message-ID` gerado localmente e determinístico. Se outra execução encontrar `sending`, não envia.
- Sucesso do provedor: `sent` com o identificador retornado. Erro explícito: `failed` com o erro (sem segredos). Timeout ou queda do processo no meio: `unknown`.
- `unknown` **nunca** é reenviado automaticamente. O comando `reconcile` lista esses casos para conferência manual na pasta de enviados (e, numa evolução, via IMAP pelo `Message-ID`).
- Checagens antes de cada envio: campanha `active`, contato e domínio fora da supressão, empresa em estado elegível, follow-up sem resposta registrada, limite diário e janela de horário de `sending.json`, endereço com formato válido.
- Comando `send` exige confirmação interativa e tem `--dry-run`.

### 4.8. Follow-ups e respostas

- Regras em `sending.json`: número máximo de follow-ups (sugestão inicial conservadora: 1, no máximo 2) e intervalo mínimo em dias úteis.
- `followups due` lista quem venceu; cada follow-up é uma nova `message` (`step` > 0) e passa pela mesma aprovação e pelas mesmas checagens.
- Respostas registradas manualmente no MVP com as 11 categorias da spec (3.9). Categorias `unsubscribe` e `invalid_address` inserem supressão automaticamente; qualquer resposta cancela os follow-ups pendentes daquele contato. Classificação pode ser corrigida; a correção vira interação.
- Nenhuma categoria leva automaticamente a `opportunity`; essa mudança é manual.

### 4.9. Métricas

Consultas SQL sobre `messages` e `interactions`, exibidas por `report` (geral e por campanha, com período). Cada indicador mostra numerador, denominador e critério. "Abordado" = contato com ao menos uma mensagem `sent`; `unknown` aparece separado e fora dos denominadores. Sem dados de entrega ou abertura, porque SMTP não os fornece de forma confiável — o relatório diz isso em vez de estimar. Com menos de ~30 abordados por grupo, o relatório avisa que a amostra é pequena.

## 5. Dependências e integrações

### 5.1. Dependências de código

`better-sqlite3`, `zod`, `pino`, `dotenv` (mesmas do `crawler-leads`), `nodemailer` (SMTP) e um parser CSV pequeno (`csv-parse`). Dev: `typescript`, `tsx`, `@types/*`. Testes com `node:test`, sem framework extra.

Alternativa: `node:sqlite` nativo do Node 24 evita compilação nativa, mas ainda é experimental. Proponho `better-sqlite3`, já usado e testado no projeto vizinho.

### 5.2. Provedor de e-mail — alternativas

| Opção | Custo aprox. | Prós | Contras |
|---|---|---|---|
| **Caixa profissional em domínio próprio via SMTP** (Google Workspace, Zoho Mail, Fastmail) | ~US$1–8/mês por caixa + domínio | E-mail 1:1 normal, respostas caem na mesma caixa, envio aparece em "Enviados", funciona com qualquer cliente; troca de provedor só muda variáveis | Sem webhooks; leitura automática de respostas exigiria IMAP depois |
| Gmail API (Workspace) | igual ao acima | Thread IDs, leitura de respostas por API | OAuth e consentimento, mais código; acopla ao Google |
| Gmail pessoal | grátis | Já existe | Reputação e termos inadequados para prospecção; mistura vida pessoal e comercial |
| Serviços transacionais (Amazon SES, Resend, Postmark, SendGrid) | baixo | APIs boas, webhooks de entrega | Em geral proíbem ou restringem e-mail não solicitado/cold outreach; respostas não voltam naturalmente; aparência de disparo em massa |
| Ferramentas de cold e-mail (Instantly, Lemlist, Smartlead) | US$30+/mês | Sequências e aquecimento prontos | Custo, outro "CRM", foge do escopo e do controle pedido |

**Recomendação:** caixa profissional num domínio com o seu nome, enviando por SMTP com `nodemailer`, atrás da porta `EmailSender`. Volume baixo e manual combina com e-mail 1:1. Exige configurar SPF, DKIM e DMARC e aquecer a caixa com uso normal antes da primeira campanha. Termos e limites do provedor escolhido devem ser conferidos no momento da contratação.

Recebimento de respostas: manual no MVP (spec 7.3). Evolução natural: leitura IMAP casando `In-Reply-To`/`References` com o `Message-ID` gravado.

### 5.3. Variáveis de ambiente previstas

`DATABASE_PATH`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SENDER_NAME`, `SENDER_EMAIL`, `SENDER_POSTAL_ADDRESS`, `EMAIL_TRANSPORT` (`smtp` | `fake`, padrão `fake`), `LOG_LEVEL`. Limites e follow-up ficam em `config/sending.json` (versionado, sem segredos).

### 5.4. Notas legais (não é parecer jurídico)

Resumo para orientar a implementação; confirmar antes de operar:

- **EUA (CAN-SPAM):** permite e-mail B2B sem consentimento prévio, exigindo remetente identificado, assunto não enganoso, endereço postal físico e opt-out funcional atendido em até 10 dias úteis.
- **Reino Unido (PECR + UK GDPR):** e-mail para endereços de pessoas jurídicas (limited companies, LLPs) é permitido com identificação e opt-out; sole traders e partnerships são tratados como pessoas físicas e exigem consentimento. Tratar o dado pessoal com base em legítimo interesse documentado.
- **Irlanda (ePrivacy S.I. 336/2011 + GDPR):** regras parecidas com o Reino Unido para endereços corporativos; GDPR se aplica integralmente.
- **Canadá (CASL):** exige consentimento. A exceção mais aplicável é o consentimento implícito quando o endereço foi publicado de forma visível, sem aviso contra mensagens não solicitadas, e a mensagem tem relação com a função da pessoa. É preciso guardar a prova de onde o endereço estava publicado.
- **Austrália (Spam Act 2003):** lógica semelhante ao Canadá (consentimento inferido por publicação visível e relevância para a função), com identificação e opt-out obrigatórios.
- **Brasil (LGPD):** os dados são tratados por você no Brasil; aplicam-se finalidade, minimização e atendimento a pedidos de exclusão.

Consequências no sistema: `contacts.source_url` obrigatório para CA e AU; rodapé com nome, endereço postal e instrução de opt-out em toda mensagem; supressão permanente e prioritária; comando para apagar os dados de uma pessoa a pedido.

## 6. Riscos

- **Prazo.** A spec prevê processo operacional no fim de outubro; hoje é 26/10. Viável chegar a B e C com envio `fake`; envio real depende de domínio, caixa e DNS, que levam dias para estabilizar e aquecer. Proposta: começar novembro com lotes pequenos e manuais.
- **Entregabilidade.** Domínio novo e caixa fria vão para spam com facilidade. Mitigação: SPF/DKIM/DMARC, volume baixo, texto simples sem rastreadores ou links em excesso.
- **Estado `unknown`.** SMTP pode aceitar a mensagem e cair a conexão antes da confirmação. Tratado com reconciliação manual, nunca com reenvio automático.
- **Qualidade dos dados.** Cadastro manual é lento; o gargalo provável de novembro é pesquisa, não envio. As métricas vão mostrar isso.
- **Legal.** Canadá e Austrália são mais restritivos; sugiro começar por EUA e Reino Unido, como já diz a spec.
- **Dados pessoais locais.** O banco fica no disco sem criptografia; `data/` fica fora do git e os logs mascaram e-mails.

## 7. Complexidade por etapa

| Etapa | Complexidade | Conteúdo |
|---|---|---|
| B — estrutura e persistência | Média | Projeto, migrações, entidades, repositórios, transições, evidências, qualificação configurável, import CSV, testes |
| C — fluxo de prospecção | Média-alta | Campanhas, templates, rascunhos, aprovação com hash, supressão, envio idempotente, SMTP + fake, `reconcile` |
| D — follow-ups e respostas | Média | Regras de follow-up, respostas classificadas, supressão automática, histórico |
| E — métricas e operação | Baixa-média | Relatórios, documentação, teste ponta a ponta com envio fake, roteiro da primeira campanha |

## 8. Plano priorizado

1. **B1.** Esqueleto do projeto (toolchain do `crawler-leads`), migrações, `companies`, `contacts`, `evidences`, `interactions`, deduplicação por domínio e e-mail.
2. **B2.** Tabela de transições de estado e qualificação via `scoring.json` com motivos.
3. **B3.** CLI de cadastro, listagem com filtros (3.4), import CSV e histórico por empresa.
4. **C1.** Campanhas, templates versionados, rascunhos e aprovação com hash.
5. **C2.** Supressão, checagens de elegibilidade, `EmailSender` fake, envio idempotente e `reconcile`.
6. **C3.** Adapter SMTP, testado contra um servidor SMTP local de teste, nunca contra destinatários reais.
7. **D.** Follow-ups, registro e correção de respostas, supressão automática.
8. **E.** Relatórios, README operacional, roteiro da campanha de teste e da primeira campanha real.

## 9. Decisões pendentes do usuário

1. Confirmar CLI local como interface do MVP.
2. Provedor e domínio de e-mail: já existe domínio com seu nome? Qual caixa (Workspace, Zoho, Fastmail)?
3. Endereço postal para o rodapé (exigência do CAN-SPAM): pode ser caixa postal ou endereço comercial.
4. Começar só por EUA e Reino Unido, deixando Canadá, Irlanda e Austrália para depois?
5. Inicializar repositório git neste diretório.
