# Lets Prospect

Ferramenta local para prospectar, com aprovação humana em cada envio, empresas que compram capacidade de desenvolvimento: **software houses e consultorias de TI** (foco atual: Brasil, por e-mail) e **negócios locais com WhatsApp**, como imobiliárias (primeira mensagem por fila pausada). Cobre o processo inteiro: descoberta, leitura do site e qualificação por IA, contatos, evidências, campanhas, mensagens revisadas, envio, follow-ups, respostas, descadastro, histórico e relatório. Roda pela linha de comando e por uma interface web local.

- Spec: [docs/SPEC.md](docs/SPEC.md)
- Operação (e-mail, domínio, aquecimento, descadastro, primeira campanha real): [docs/OPERACAO.md](docs/OPERACAO.md)
- Decisões e relatórios por etapa: [A](docs/ETAPA-A-AUDITORIA.md), [B](docs/ETAPA-B.md), [C, D e E](docs/ETAPAS-C-D-E.md)

## Requisitos

- Node.js 22.13 ou superior (testado com 24).
- Cadastro manual e importação por CSV funcionam sem serviço externo. Cada recurso extra tem a sua chave, e sem ela o comando avisa o que falta:

| Recurso | Serviço | Variável |
|---|---|---|
| Envio real de e-mail | caixa com SMTP (Zoho Mail Lite ou similar) | `SMTP_*`, `SENDER_*` |
| Descobrir empresas e achar decisores | Hunter.io (plano Free: 50 créditos por mês) | `HUNTER_API_KEY` |
| Qualificação por IA | Amazon Bedrock (Claude Haiku 4.5) | `AWS_BEARER_TOKEN_BEDROCK` |
| Negócios locais com telefone | Google Places API (New) | `GOOGLE_PLACES_API_KEY` |
| Descadastro por link | Cloudflare Worker + KV (pasta `worker/`) | `UNSUBSCRIBE_*` |

## Começar

```bash
npm install
cp .env.example .env     # preencha SENDER_NAME, SENDER_EMAIL e SENDER_POSTAL_ADDRESS
npm run check            # typecheck + testes
npm run app              # abre a interface web em http://127.0.0.1:4380
```

Por padrão `EMAIL_TRANSPORT=outbox`: as mensagens viram arquivos `.eml` em `data/outbox/` e nada sai da máquina. O WhatsApp também começa em canal simulado. Envio real de e-mail só com `EMAIL_TRANSPORT=smtp` (ver [docs/OPERACAO.md](docs/OPERACAO.md)).

O banco fica em `data/prospeccao.db`. `data/` e `.env` ficam fora do git. Para backup, copie o arquivo com a API parada.

## Interface web

```bash
npm run app              # compila o frontend e sobe em http://127.0.0.1:4380
```

Para desenvolver o frontend com recarga automática, rode `npm run api` e `npm run web` em dois terminais e abra http://127.0.0.1:5173.

A API (Fastify, em `src/api/`) só escuta em 127.0.0.1, recusa outros nomes de host e exige o cabeçalho `x-prospeccao` em toda escrita, para que outras páginas abertas no navegador não consigam usá-la. Ela chama os mesmos casos de uso da linha de comando, então as regras são as mesmas. O frontend (React + Vite, em `web/`) segue o design de `docs/PROMPT-FRONTEND.md`.

Telas, agrupadas no menu em **E-mail**, **WhatsApp** e **Geral**: Hoje, Descoberta (funil automático), Empresas (lista e kanban; as desqualificadas ficam ocultas por padrão), Empresa (evidências, contatos, qualificação, mensagens, histórico), Cadastros e importação CSV, Possíveis duplicadas, Campanhas (templates versionados com preview, ativação, seleção, rascunhos), Personalizar mensagem, Fila de revisão (atalhos A/E/S), Envio (simulação, confirmação `ENVIAR` no SMTP real, progresso ao vivo e parada segura), Conciliação e falhas, Follow-ups, Respostas, Supressões, Leads, Fila de WhatsApp, Relatório (exporta CSV), Configurações (remetente, transporte, DNS do domínio, regras de envio e pesos) e busca com Ctrl+K. Cada tela tem um tour guiado.

Remetente e SMTP continuam só no `.env`: a senha nunca passa pelo navegador. Regras de envio e pesos da qualificação salvos pela tela gravam `config/sending.json` e `config/scoring.json` com versão nova. O envio roda no processo da API, um por vez; fechar a aba não o interrompe, use "Interromper com segurança".

> **Tudo o que está nas seções seguintes (funil, campanhas, WhatsApp) é feito pelas telas.** Os blocos de comando mostram o equivalente em linha de comando (`npm run cli -- help` lista todos), útil para automatizar ou depurar; no dia a dia não são necessários.

## Funil automático (e-mail)

Hunter e IA fazem o trabalho repetitivo, e uma pessoa aprova o que sai.

```bash
npm run cli -- prospect discover --country BR --city "Belo Horizonte" --dry-run   # grátis: acha empresas
npm run cli -- prospect run --country BR --limit 20 --max-credits 5               # descobre, a IA lê o site e qualifica
npm run cli -- prospect contacts <domínio...>                                     # gasta crédito: acha CEO/CTO/sócios
npm run cli -- prospect credits                                                   # saldo do Hunter
```

- A descoberta é grátis. Só as empresas **qualificadas** gastam crédito do Hunter (1 por busca que devolve resultado).
- A IA lê o site e propõe fatos com citação. O código confere a citação palavra por palavra na página: só citação conferida vira fato **verificado**, e só fato verificado sobre o modelo de negócio qualifica uma empresa. Sem isso a empresa fica em revisão humana. O mesmo vale para o tipo (`software house` ou `consultoria de TI`).
- O contato de cada empresa é o cargo mais alto: dono ou CEO, depois CTO, depois outros "Chief", depois heads e VPs, depois diretores. Quem não decide só entra na falta de alguém melhor.
- Sites que bloqueiam robôs (`robots.txt`, 403) não são burlados: vão para a fila de revisão.

## Fluxo manual de uma campanha

```bash
# 1. Cadastrar e pesquisar (ou deixar o funil automático fazer)
npm run cli -- company add --name "Acme Software" --website acme.dev --country BR \
  --employees 20 --tech "React;Node.js" --source https://acme.dev
npm run cli -- evidence add acme.dev --kind business_model --certainty verified \
  --claim "Case studies de projetos para clientes" --source https://acme.dev/work
npm run cli -- contact add acme.dev --name "Jane Doe" --role CTO \
  --email jane@acme.dev --source https://acme.dev/team

# 2. Qualificar
npm run cli -- company evaluate acme.dev
npm run cli -- company status acme.dev qualified

# 3. Campanha (aprovação humana do template e da campanha)
npm run cli -- campaign create br-software-houses --market BR --segment "software house"
npm run cli -- campaign template br-software-houses --step 0 --subject "Reforço de desenvolvimento para a {{company.name}}" --file templates/first.txt
npm run cli -- campaign approve-template br-software-houses --step 0
npm run cli -- campaign activate br-software-houses
npm run cli -- campaign select br-software-houses --limit 10

# 4. Mensagens: personalizar com fato verificado, revisar e aprovar
npm run cli -- company show acme.dev          # mostra o id das evidências
npm run cli -- message draft br-software-houses acme.dev --reason "Li o seu case sobre ..." --evidence <id>
npm run cli -- message draft-all br-software-houses
npm run cli -- message review br-software-houses

# 5. Enviar
npm run cli -- send br-software-houses --dry-run
npm run cli -- send br-software-houses

# 6. Acompanhar
npm run cli -- reply add jane@acme.dev --category interested_to_talk --summary "Quer conversar quinta"
npm run cli -- followup due
npm run cli -- followup draft br-software-houses
npm run cli -- report --campaign br-software-houses
```

`npm run cli -- help` lista todos os comandos. Uma campanha com segmento exatamente `software house` ou `consultoria de TI` só seleciona empresas desse tipo. Os textos de cada tipo ficam em [templates/](templates/README.md).

## Trilha de WhatsApp (negócios locais)

Módulo separado do e-mail, porque lead local tem telefone, não domínio. Ainda em canal simulado: falta a conta Meta e o chip.

```bash
npm run cli -- lead discover --city "Belo Horizonte" --segment imobiliária --dry-run   # Google Places
npm run cli -- lead qualify        # a IA lê o site; só os bons perfis são contatados
npm run cli -- lead enrich         # acha o WhatsApp que a empresa publica
npm run cli -- wa run --dry-run    # prepara e envia a fila, com espera aleatória e horário comercial
```

Limite diário, intervalos, janela de horário e texto da primeira mensagem ficam em [config/whatsapp.json](config/whatsapp.json). Recusa de um lead bloqueia o telefone para sempre (`wa suppress`). O plano do closer de conversa (a IA responde no tom do dono e passa para ele o que envolve preço, prazo ou reunião) está descrito em `ideas/closer-whatsapp.md`, que fica fora do git.

## Descadastro por link

Cada e-mail leva um link pessoal assinado (HMAC) para uma página servida por um Cloudflare Worker (`worker/descadastro/`). Um GET só mostra o botão de confirmação, porque filtros de e-mail abrem links sozinhos; o POST (botão ou o clique único do Gmail, RFC 8058) grava apenas o hash do endereço. Antes de cada `send`, o app busca os descadastros e aplica o mesmo efeito de uma resposta `unsubscribe`. Se o serviço não responder, **nada é enviado**. Sem `UNSUBSCRIBE_*` no `.env`, o rodapé volta a pedir resposta por e-mail. Passo a passo em [docs/OPERACAO.md](docs/OPERACAO.md).

## Templates

Texto simples. Placeholders aceitos: `{{company.name}}`, `{{contact.firstName}}`, `{{contact.name}}`, `{{stack}}` (tecnologias da empresa que batem com a sua stack), `{{reason}}`, `{{sender.name}}`, `{{sender.email}}`, `{{sender.postalAddress}}`.

- A linha que contém `{{reason}}` só aparece quando a mensagem é personalizada com `--reason` e `--evidence` (fato verificado da empresa). Sem isso, a linha some e a mensagem fica marcada como **genérica**.
- A linha com `{{stack}}` some se a empresa não tiver tecnologias compatíveis cadastradas.
- O rodapé de [config/sending.json](config/sending.json) (nome, identificação do remetente e como parar de receber) é anexado a toda mensagem; `footerWithLink` é usado quando o descadastro por link está configurado. Depois dele vai a imagem de assinatura (`signature` no mesmo arquivo, arquivo em `data/assinatura.png`): o e-mail sai com texto e HTML, e quem só lê texto vê o rodapé. Trocar a imagem pede reiniciar a API. A assinatura traz foto e contatos pessoais, então fica fora do git: o `config/sending.json` versionado não tem `signature`, e a cópia real vive em `data/sending.json` (aponte `SENDING_CONFIG_PATH` para ela no `.env`).
- Os follow-ups saem como resposta na mesma conversa (`In-Reply-To` e `References`).

## Regras que o sistema garante

- Empresa duplicada (mesmo domínio) e contato duplicado (mesmo e-mail ou nome na empresa) são recusados.
- `qualified` exige fato verificado sobre o modelo de negócio.
- Uma empresa fica em no máximo uma campanha aberta, com um contato.
- Só mensagens aprovadas são enviadas. O conteúdo aprovado é travado por hash; qualquer alteração exige nova aprovação.
- Antes de cada envio: campanha ativa, contato apto, fora da supressão, empresa no estado certo, sem resposta registrada (follow-ups), descadastros conferidos e dentro do limite diário.
- Falha do provedor nunca vira "enviada". Resultado incerto (timeout, conexão caída) vira `unknown` e não é reenviado sem conciliação manual.
- Executar `send` de novo não duplica: cada mensagem tem chave única (campanha, contato, etapa) e é reservada antes do envio.
- Pedido de descadastro suprime o endereço de forma permanente (o banco impede apagar supressões) e coloca a empresa em `do_not_contact`.
- O histórico é somente inclusão; a única alteração permitida é a remoção de dados pessoais a pedido. Por isso empresas não são apagadas: as desqualificadas só saem da lista padrão.

## Configuração

| Arquivo | Conteúdo |
|---|---|
| `.env` | caminhos, remetente, transporte, SMTP, chaves dos serviços e descadastro (modelo em [.env.example](.env.example)) |
| [config/scoring.json](config/scoring.json) | critérios e pesos da qualificação e a lista da sua stack |
| [config/sending.json](config/sending.json) | limite diário (20), intervalo entre envios (90 s), follow-ups (até 3, em 3/5/7 dias úteis após o 1º e-mail), rodapé e imagem de assinatura |
| [config/whatsapp.json](config/whatsapp.json) | limite diário, intervalos, janela de horário, primeira mensagem |
| [config/leads.json](config/leads.json) | buscas automáticas de negócios locais |

### Qualificação

| Critério | Peso | Como avalia |
|---|---|---|
| business_model | 30 | evidências `business_model` (obrigatório como fato para `qualified`) |
| size | 15 | `employees` entre 5 e 50 |
| country | 15 | países principais US/GB integral; CA/IE/AU 60% (configurável) |
| stack | 15 | parte da stack da empresa que também está na sua lista; menos de 3 tecnologias conhecidas vale como hipótese |
| recurring_work | 10 | evidências `recurring_work` |
| demand_signal | 10 | evidências `demand_signal` |
| decision_maker | 5 | contato com cargo de decisor |

Dado ausente é `unknown` (não soma nem subtrai, mas reduz a cobertura). Hipótese vale 50%. Fato contrário anula o critério. Prioridade sugerida: alta a partir de 70%, média a partir de 45%, só com cobertura de 50% ou mais.

## Status

```
Empresa:  identified -> qualified -> contacted -> replied -> interested -> opportunity -> converted
          encerramentos: disqualified, not_interested, inactive, do_not_contact (exigem --reason)
Mensagem: draft -> approved -> sending -> sent | failed | unknown ; cancelled
```

`qualified -> contacted` acontece no primeiro envio confirmado. `contacted -> replied`, `not_interested` e `do_not_contact` acontecem ao registrar a resposta. `interested`, `opportunity` e `converted` são sempre manuais.

## Arquitetura

```
src/core/entities     tipos do domínio
src/core/rules        regras puras: normalização, status, qualificação, renderização, elegibilidade de envio, efeitos de resposta, cargos de decisão
src/core/use-cases    casos de uso; cada escrita grava o histórico na mesma transação
src/core/ports        interfaces (Store, EmailSender, descadastro, fontes de empresas, páginas, IA)
src/adapters          SQLite (migrações), e-mail (outbox e SMTP), Hunter, Google Places, Bedrock, WhatsApp, descadastro, CSV
src/infra             ambiente, configurações, composição
src/cli               comandos e formatação
src/api               API local (Fastify)
web/                  interface (React + Vite)
worker/descadastro    Cloudflare Worker do descadastro por link
```

Horários são gravados e exibidos em UTC.
