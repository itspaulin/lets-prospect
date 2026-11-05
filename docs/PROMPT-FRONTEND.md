# Prompt para o Claude Design: frontend do Prospecção

Copie tudo abaixo da linha.

---

Crie o design completo (telas navegáveis em alta fidelidade) do frontend de um aplicativo chamado **Prospecção**. É uma ferramenta pessoal, local e de usuário único, que hoje funciona por linha de comando (Node.js + SQLite). O frontend vai substituir a CLI no dia a dia, chamando os mesmos casos de uso por uma API local. Toda regra de negócio descrita aqui já existe no backend: o design deve expor essas regras, não inventar outras.

## 1. Contexto do produto

Sou desenvolvedor full-stack no Brasil (Node.js, TypeScript, NestJS, React, PostgreSQL, AWS). Uso a ferramenta para prospectar **software houses e agências estrangeiras** (5 a 50 funcionários; EUA e Reino Unido primeiro, depois Canadá, Irlanda e Austrália) e oferecer capacidade extra de desenvolvimento como profissional independente, por hora, por projeto ou em contrato recorrente.

O processo inteiro passa pelo app: cadastrar empresas, registrar evidências, encontrar contatos, qualificar, montar campanhas, escrever e aprovar mensagens, enviar e-mails, acompanhar follow-ups, registrar respostas e analisar resultados.

O que a ferramenta não é: não é um CRM complexo, não é marketing automation, não dispara e-mail em massa. O volume é baixo (até 20 envios por dia, um a cada 90 s), e cada mensagem passa por revisão humana.

## 2. Usuário e uso

- Uma pessoa, no desktop (1280 a 1920 px). Precisa funcionar em tablet, mas não é prioridade. Celular é só para consulta.
- Sessões curtas e diárias: abrir, ver o que precisa de atenção hoje, revisar rascunhos, enviar o lote, registrar respostas.
- Interface em **português do Brasil**. O conteúdo dos e-mails, os templates e as previews ficam em **inglês**, porque é o que o destinatário recebe.
- Horários: o backend grava em UTC. Mostre no fuso de Brasília, com o UTC visível no hover. O limite diário zera à meia-noite UTC (21h em Brasília), e isso precisa ficar claro.

## 3. Princípios de design (obrigatórios)

1. **Controle humano em toda ação com efeito externo.** Enviar, aprovar e ativar são ações explícitas, nunca automáticas. O envio real pede confirmação digitando `ENVIAR`.
2. **Fato x hipótese sempre visível.** Evidências `verified` e `hypothesis` têm tratamento visual diferente em todo lugar. Mensagem personalizada com fato verificado (`evidence_based`) e mensagem `generic` também, e a genérica nunca se passa por personalizada.
3. **Não inventar dados.** Não existem métricas de abertura, entrega ou clique (o SMTP não fornece). Não desenhe nada disso. Taxa com denominador zero aparece como "—" com explicação, nunca como 0%.
4. **Toda taxa mostra numerador, denominador e definição** (tooltip ou linha de apoio). Amostra abaixo de 30 contatos exibe o aviso "trate como indício, não como conclusão".
5. **Rastreabilidade.** Cada empresa tem uma linha do tempo, somente inclusão, com tudo o que aconteceu. Nada é apagado, exceto dados pessoais a pedido (e isso também fica registrado).
6. **Erro e incerteza são estados de primeira classe.** `failed` e `unknown` não ficam escondidos: `unknown` exige conciliação manual e bloqueia reenvio.
7. **Bloqueios explicados.** Quando algo não pode ser feito (transição inválida, contato suprimido, limite diário atingido, template não aprovado), mostre o motivo e o caminho para resolver, não só um botão desabilitado.
8. **Densidade de ferramenta de trabalho.** Tabelas compactas, atalhos de teclado nas filas de revisão, pouco espaço decorativo. Pense em Linear, Attio e Height, não em dashboards de marketing.

## 4. Estilo visual

- Sóbrio, profissional e neutro. Sem marca: o app não usa "lou.dev" nem "LudenDev", e o nome exibido é só "Prospecção".
- Tema claro e escuro.
- Uma cor de destaque. Status com cores semânticas consistentes:
  - neutro/cinza: `identified`, `draft`, `inactive`;
  - azul: `qualified`, `approved`, `contacted`;
  - violeta: `replied`, `interested`;
  - verde: `opportunity`, `converted`, `sent`;
  - âmbar: `unknown`, `sending`, follow-up vencido, hipótese;
  - vermelho: `failed`, `disqualified`, `not_interested`;
  - vermelho escuro com ícone de bloqueio: `do_not_contact`, supressões.
- Tipografia legível em tabelas densas e fonte monoespaçada para e-mails, domínios, hashes e IDs.
- Ícones de linha simples.

## 5. Modelo de dados (para os dados de exemplo)

**Empresa:** nome, domínio (único), site, país (US, GB, CA, IE, AU), região, segmento, nº de funcionários, serviços, tecnologias (lista), fonte, data da última verificação, prioridade (`high`/`medium`/`low`), status, motivo de desqualificação/encerramento, próxima ação (data e nota), notas, resultado da qualificação.

**Status da empresa e transições permitidas:**
```
identified     -> qualified, disqualified, inactive, do_not_contact
qualified      -> contacted (automático no 1º envio), identified, disqualified, inactive, do_not_contact
disqualified   -> identified, do_not_contact
contacted      -> replied, not_interested, inactive, do_not_contact
replied        -> interested, not_interested, inactive, do_not_contact
interested     -> opportunity, not_interested, inactive, do_not_contact
opportunity    -> converted, interested, not_interested, inactive, do_not_contact
converted      -> inactive, do_not_contact
not_interested -> inactive, do_not_contact
inactive       -> identified, qualified, do_not_contact
do_not_contact -> (nenhuma; só "override" para inactive, com motivo)
```
`disqualified`, `not_interested`, `inactive` e `do_not_contact` exigem motivo. `qualified` exige ao menos um fato verificado de modelo de negócio. `interested`, `opportunity` e `converted` são sempre manuais.

**Evidência:** tipo (`business_model`, `size`, `technology`, `recurring_work`, `demand_signal`, `other`), afirmação, certeza (`verified`/`hypothesis`), posição (`supports`/`contradicts`), fonte (URL), data observada.

**Contato:** nome, cargo (decisores: Founder, Co-Founder, CTO, Head of Engineering, Engineering Manager, Delivery Manager), e-mail, fonte do e-mail, perfil público, verificação (`unverified`/`verified`/`invalid`), flag de não contatar, notas. Vários contatos por empresa; o domínio do e-mail diferente do da empresa gera alerta.

**Qualificação (configurável):**

| Critério | Peso | Regra |
|---|---|---|
| Modelo de negócio | 30 | evidências business_model (fato obrigatório para qualified) |
| Tamanho | 15 | 5 a 50 funcionários |
| País | 15 | US/GB integral; CA/IE/AU 60% |
| Stack | 15 | tecnologias em comum; 2 ou mais = integral |
| Trabalho recorrente | 10 | evidências recurring_work |
| Sinal de demanda | 10 | evidências demand_signal |
| Decisor | 5 | contato com cargo de decisor |

Cada critério tem resultado `met`, `partial`, `not_met` ou `unknown`, pontos e uma frase de detalhe. Também há pontuação, cobertura (% do peso com dado conhecido), prioridade sugerida (alta a partir de 70%, média a partir de 45%, só com cobertura ≥ 50%) e lista de requisitos faltando. Hipótese vale 50%; fato contrário zera o critério.

**Campanha:** nome, mercado, segmento, critérios, notas, status (`draft`, `active`, `paused`, `closed`). Ativar é a aprovação humana. Cada empresa fica em no máximo uma campanha aberta, com um contato.

**Template:** por campanha e por etapa (0 = primeiro contato, 1 = follow-up), versionado. Cada versão nova precisa de aprovação. Placeholders: `{{company.name}}`, `{{contact.firstName}}`, `{{contact.name}}`, `{{stack}}`, `{{reason}}`, `{{sender.name}}`, `{{sender.email}}`, `{{sender.postalAddress}}`. A linha com `{{reason}}` some quando não há fato verificado; a linha com `{{stack}}` some sem tecnologia em comum. Rodapé fixo com nome, endereço postal e instrução de descadastro.

**Mensagem:** campanha, empresa, contato, etapa, destinatário, assunto, corpo, personalização (`evidence_based` com evidências vinculadas, ou `generic`), hash do conteúdo aprovado (qualquer edição invalida a aprovação), status (`draft`, `approved`, `sending`, `sent`, `failed`, `unknown`, `cancelled`), Message-ID, erro do provedor, motivo de cancelamento, tentativas de envio (início, fim, resultado, erro).

**Resposta:** contato, mensagem, categoria, resumo, data. Categorias e efeitos:

| Categoria | Conta como resposta | Interesse | Efeito |
|---|---|---|---|
| interested_to_talk | sim | sim | para a sequência |
| future_collaboration | sim | sim | para a sequência |
| more_info | sim | sim | para a sequência |
| cv_or_portfolio | sim | sim | para a sequência |
| no_need_now | sim | não | para a sequência |
| declined | sim | não | empresa vai para not_interested |
| referral | sim | não | para a sequência |
| auto_reply | não | não | não para follow-ups |
| invalid_address | não | não | contato inválido e suprimido |
| unsubscribe | sim | não | supressão permanente; empresa vai para do_not_contact |
| inconclusive | sim | não | para a sequência |

Toda resposta humana move a empresa de `contacted` para `replied` e cancela as mensagens pendentes. A classificação pode ser corrigida, e a correção vira um evento no histórico.

**Supressão:** e-mail ou domínio, motivo, data. É permanente e não pode ser removida.

**Histórico (eventos):** empresa criada/atualizada, status alterado, contato adicionado/atualizado, evidência adicionada, qualificação avaliada, próxima ação definida, nota, entrada em campanha, mensagem rascunhada/aprovada/cancelada/enviada/falhou/desconhecida/conciliada, resposta registrada/corrigida, suprimido, dados pessoais apagados.

**Configuração de envio:** limite diário 20, intervalo mínimo 90 s, 1 follow-up após 5 a 7 dias úteis, rodapé.

## 6. Telas

### 6.1. Hoje (tela inicial)
Fila do que precisa de atenção, em ordem de urgência:
- envios `unknown` aguardando conciliação (bloqueiam a confiança nos números);
- envios `failed` (tentar de novo ou cancelar);
- rascunhos aguardando revisão, por campanha;
- mensagens aprovadas prontas para enviar, com o contador do limite diário (ex.: 7/20 hoje; zera às 21h de Brasília);
- follow-ups vencidos;
- próximas ações vencidas ou de hoje;
- empresas prontas para abordagem (qualified, com contato apto, fora de campanha).

Também mostra um resumo pequeno (abordados, respostas, interessados e oportunidades no mês) e um banner de ambiente, se aplicável: "Modo simulação (outbox): nada sai da máquina" ou "SMTP não configurado".

Inclua uma dica de janela de envio: horário comercial de Reino Unido e EUA, entre 11h e 15h de Brasília.

### 6.2. Empresas (lista)
- Tabela densa: nome, domínio, país (bandeira + código), funcionários, tecnologias (chips, com destaque para as da minha stack), prioridade, pontuação/cobertura, status, nº de contatos, última interação, próxima ação, campanha atual.
- Filtros: status (múltiplo), país, tecnologia, prioridade, faixa de funcionários, tem contatos (sim/não), próxima ação até a data, inativa desde, ativa desde, motivo de desqualificação. Filtros salvos.
- Visão alternativa em **kanban por status**. Arrastar respeita as transições permitidas: colunas inválidas ficam esmaecidas durante o arraste, e transições que exigem motivo abrem um diálogo.
- Ações: nova empresa, importar CSV, ver possíveis duplicadas.

### 6.3. Empresa (detalhe)
Cabeçalho com nome, domínio, país, status (botão de mudar status mostrando só as transições permitidas, com o motivo quando exigido), prioridade, próxima ação editável e campanha atual.

Abas ou seções:
- **Visão geral:** dados cadastrais, serviços, tecnologias, fonte, última verificação, notas.
- **Evidências:** lista agrupada por tipo, separando fato e hipótese, a favor e contra, com fonte clicável e data. Formulário rápido de nova evidência. O ID fica copiável, porque é usado para personalizar a mensagem.
- **Contatos:** cards com cargo (selo de decisor), e-mail e fonte, verificação, não contatar e supressão. Ações: editar, marcar inválido, bloquear/liberar (liberar exige motivo), "esquecer dados pessoais" (ação destrutiva com confirmação forte, explicando que o endereço continua bloqueado).
- **Qualificação:** barra de pontuação com cobertura, prioridade sugerida, requisitos faltando e tabela de critérios (peso, resultado, pontos, detalhe). Botão "reavaliar" e indicação de quando foi avaliada e com qual versão da configuração.
- **Mensagens e respostas:** todas as mensagens da empresa, por campanha e etapa, com status e respostas vinculadas.
- **Histórico:** linha do tempo vertical com ícone por tipo de evento, filtro por tipo e o detalhe de cada evento expansível.

### 6.4. Formulários de cadastro
- Nova empresa: domínio normalizado a partir da URL, com aviso imediato de duplicada (mesmo domínio, nome parecido ou subdomínio).
- Novo contato: alerta quando o domínio do e-mail não bate com o da empresa; a fonte do e-mail é obrigatória quando há e-mail.
- Nova evidência.
- **Importação CSV** (empresas e contatos): upload, mapeamento de colunas, prévia com linhas válidas, duplicadas e com erro, e relatório final.

### 6.5. Duplicadas
Pares de possíveis duplicadas com o motivo (nome parecido, subdomínio) e comparação lado a lado.

### 6.6. Campanhas (lista)
Cards ou tabela: nome, mercado, status, empresas selecionadas, rascunhos, aprovadas, enviadas, falhas/desconhecidas, respostas, interessados e taxa de resposta (com denominador).

### 6.7. Campanha (detalhe)
Um **stepper** com o ciclo de vida, cada etapa mostrando se está concluída, bloqueada (e por quê) ou pendente:
1. Criar (nome, mercado, segmento, critérios).
2. Templates: etapa 0 e etapa 1 (follow-up). Editor de texto simples com inserção de placeholders, **preview renderizado com uma empresa real da campanha** (mostrando o que some sem `{{reason}}` ou `{{stack}}`), histórico de versões com diff, e o botão "aprovar template".
3. Ativar a campanha (aprovação humana; resume o que foi aprovado).
4. Selecionar empresas: lista das prontas (filtro por país e prioridade, com limite), adição manual com escolha do contato, e motivo de inelegibilidade para quem não pode entrar.
5. Rascunhos: gerar genéricos para todos e personalizar individualmente.
6. Revisão.
7. Envio.

Também tem ações de pausar, retomar e encerrar, e as métricas da campanha.

### 6.8. Personalizar mensagem
Painel lateral ou modal para uma empresa: à esquerda, as evidências **verificadas** da empresa (hipóteses aparecem, mas não podem ser selecionadas); à direita, o campo "motivo" (uma frase em inglês presa a um fato) e a preview do e-mail atualizando ao vivo. Selo "personalizada com evidência" ou "genérica".

### 6.9. Fila de revisão
Modo foco, uma mensagem por vez:
- preview exatamente como o destinatário verá (De, Para, Assunto, corpo e rodapé);
- ao lado: contexto da empresa (status, pontuação, evidências usadas, contato e cargo);
- selo genérica ou personalizada; nas genéricas, um aviso para revisar se faz sentido mandar;
- ações: aprovar (A), editar (E), pular (S), cancelar com motivo, com atalhos de teclado e progresso (3 de 12);
- depois de aprovada, um indicador de "conteúdo travado" (hash). Editar uma aprovada avisa que ela volta para rascunho.

### 6.10. Envio
- **Simulação (dry-run) primeiro:** lista do que seria enviado e do que seria bloqueado, com o motivo por mensagem (campanha inativa, contato suprimido, empresa em estado errado, resposta já registrada, limite diário).
- Resumo: X mensagens agora, limite restante hoje, tempo estimado (90 s entre envios).
- Confirmação digitando `ENVIAR`, só no modo SMTP. No modo outbox, um aviso claro de simulação.
- Progresso ao vivo: fila com contagem regressiva do intervalo e um resultado por mensagem (`sent`, `failed` com o erro do provedor, `unknown`). Dá para interromper com segurança.
- Rodar de novo nunca duplica, e a interface deve passar essa segurança.

### 6.11. Conciliação e falhas
Lista de mensagens `unknown` com as tentativas (início, fim e erro) e as ações "foi enviada" ou "não foi enviada" com nota, com a orientação de conferir a pasta Enviados do provedor. Lista de `failed` com as ações tentar de novo e cancelar.

### 6.12. Follow-ups
Follow-ups vencidos por campanha (etapa 1, 5 a 7 dias úteis depois do primeiro envio, no máximo 1), mostrando por que cada um é elegível e quais foram barrados (respondeu, recusou, suprimido). Ação de gerar rascunhos, que levam para a mesma fila de revisão.

### 6.13. Respostas
- Lista de respostas: empresa, contato, categoria (chip colorido), resumo e data, com filtro por categoria e campanha.
- **Registrar resposta:** busca pelo e-mail do contato, seleção da categoria com o **efeito mostrado antes de salvar** (ex.: "unsubscribe: o endereço será suprimido para sempre e a empresa irá para do_not_contact"), resumo e data.
- Corrigir categoria, com o registro da correção.
- Depois de uma resposta de interesse, um atalho para mover a empresa para `interested` (sempre manual).

### 6.14. Supressões
Lista de e-mails e domínios suprimidos, com motivo e data. Adicionar supressão. Sem opção de remover, com uma explicação curta do porquê.

### 6.15. Relatório
- Filtros: campanha e período (de/até).
- Indicadores operacionais: empresas cadastradas, qualificadas, contatos, prontas para abordagem, enviadas, falhas, desconhecidas, follow-ups pendentes, respostas, pedidos de descadastro, oportunidades, convertidas.
- Funil por status da empresa.
- Taxas, cada uma com numerador/denominador e definição:
  - resposta = contatos com resposta humana / contatos com primeiro e-mail enviado;
  - interesse = respostas de interesse / contatos com resposta;
  - conversão = empresas convertidas / empresas abordadas;
  - falha de envio = tentativas com falha / tentativas.
- Comparativos (coorte = contatos cujo primeiro e-mail saiu no período): por campanha, por país e genérica x personalizada. Tabelas simples com barras horizontais; nada de gráfico decorativo.
- Avisos no topo: amostra pequena, períodos recentes ainda sem respostas, envios desconhecidos não conciliados.
- Exportar CSV.

### 6.16. Configurações
- **Remetente:** nome, e-mail e endereço postal (exigido pelo CAN-SPAM).
- **Transporte:** outbox (simulação) ou SMTP, com status de conexão, host, porta, usuário e senha de app mascarada. Botão "enviar teste para mim".
- **Checklist de entregabilidade** (configuração planejada: domínio na Cloudflare e caixa no Zoho Mail Lite): domínio registrado, caixa criada, MX, SPF, DKIM, DMARC, senha de app, teste SMTP com SPF/DKIM/DMARC em `pass`, aquecimento de alguns dias. Cada item com estado e link para o guia.
- **Regras de envio:** limite diário, intervalo, número de follow-ups, intervalo em dias úteis e rodapé (com preview).
- **Qualificação:** editor dos pesos e critérios, mostrando o total e avisando que mudar a configuração cria uma nova versão e exige reavaliar.
- **Checklist da primeira campanha real:** só EUA e Reino Unido; no Reino Unido, só empresas (Ltd, LLP); fato verificado e fonte do e-mail em todas; template revisado em inglês, sem prometer vaga; lote de 5 a 10; dry-run conferido.
- **Dados:** local do banco e orientação de backup.

### 6.17. Busca global e atalhos
Paleta de comandos (Ctrl+K) para ir a empresa, contato ou campanha e executar ações ("registrar resposta", "nova empresa", "enviar campanha X").

## 7. Estados que precisam de design

Para as telas principais: vazio (primeiro uso, com o caminho para começar), carregando, erro, sem permissão para a ação (motivo do bloqueio), limite diário atingido, campanha pausada, empresa em `do_not_contact` (tudo de envio bloqueado e explicado), contato suprimido, template com versão nova não aprovada, mensagem aprovada que foi editada, envio em andamento, modo simulação x modo real.

## 8. Dados de exemplo

Use dados fictícios e plausíveis, coerentes entre as telas: cerca de 25 empresas (agências pequenas de Londres, Manchester, Austin, Nova York e Toronto, com domínios `.co.uk`, `.io`, `.dev` e `.com` claramente fictícios), em status variados; 2 campanhas (`uk-agencies-nov` ativa e `us-node-shops-nov` em rascunho); mensagens em todos os status, incluindo 1 `unknown` e 1 `failed`; respostas de várias categorias, incluindo 1 `unsubscribe` e 1 `auto_reply`. Remetente "Seu Nome". As amostras são pequenas (menos de 30 abordados), então o aviso de amostra aparece no relatório.

## 9. Fora do escopo (não desenhar)

Métricas de abertura, entrega ou clique; envio em massa; sequências multicanal; LinkedIn ou redes sociais; enriquecimento pago de dados; IA gerando mensagens automaticamente; multiusuário, login e permissões; cobrança.

**Evolução prevista** (reserve espaço, mas marque como "em breve"): leitura automática de respostas por IMAP, casando pelo Message-ID e sugerindo a categoria para eu confirmar; nunca classificar sozinho como oportunidade.

## 10. Entregáveis

1. Mapa de navegação (sidebar: Hoje, Empresas, Campanhas, Revisão, Follow-ups, Respostas, Relatório, Supressões, Configurações).
2. Telas de alta fidelidade de todas as seções acima, em tema claro e escuro, para desktop, mais as versões tablet de Hoje, Empresa e Revisão.
3. Fluxos clicáveis ponta a ponta:
   a. cadastrar empresa, adicionar evidência e contato, qualificar;
   b. criar campanha, escrever e aprovar o template, ativar, selecionar, personalizar, revisar, simular e enviar;
   c. registrar uma resposta de interesse e mover para `interested`;
   d. registrar um `unsubscribe` e ver o bloqueio em todo o app;
   e. conciliar um envio `unknown`.
4. Biblioteca de componentes: chips de status (empresa, mensagem, campanha, categoria de resposta), selo fato/hipótese, selo genérica/personalizada, barra de pontuação com cobertura, card de taxa com numerador/denominador, item de linha do tempo, diálogo de transição com motivo, confirmação destrutiva, banner de ambiente, contador de limite diário.
