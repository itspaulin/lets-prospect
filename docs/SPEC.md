# SPEC — Automação de Prospecção Comercial Internacional

## 1. Visão geral

### 1.1. Objetivo do projeto

Desenvolver uma automação comercial para organizar, executar e acompanhar a prospecção de software houses estrangeiras, com o objetivo de conseguir oportunidades remuneradas em dólar como desenvolvedor full-stack.

O sistema deverá auxiliar no processo comercial, desde a identificação de empresas potencialmente interessadas em contratar capacidade adicional de desenvolvimento até o acompanhamento das abordagens e a análise dos resultados.

A automação deverá reduzir tarefas operacionais repetitivas, organizar os dados de prospecção e permitir que o processo comercial seja executado de maneira consistente.

### 1.2. Objetivo comercial

O objetivo não é vender inicialmente softwares sob medida para clientes finais.

A estratégia consiste em estabelecer relacionamentos comerciais com software houses estrangeiras que desenvolvem produtos e soluções para seus próprios clientes e que possam precisar de desenvolvedores externos para ampliar sua capacidade de entrega.

A proposta é oferecer minha capacidade técnica como desenvolvedor, podendo trabalhar por horas, por projeto ou mediante contratos recorrentes, conforme a necessidade da empresa.

O resultado esperado é conseguir oportunidades reais de trabalho remunerado internacionalmente.

### 1.3. Princípios do projeto

O desenvolvimento deverá respeitar os seguintes princípios:

- Priorizar a prospecção de software houses estrangeiras.
- Apresentar-me como profissional independente, utilizando meu próprio nome e posicionamento profissional.
- Não utilizar a marca lou.dev ou LudenDev na estratégia comercial.
- Priorizar relacionamentos comerciais e oportunidades recorrentes.
- Automatizar tarefas operacionais sem transformar a comunicação em spam.
- Manter controle sobre os contatos realizados, as mensagens enviadas e as respostas recebidas.
- Permitir a análise dos resultados para melhorar continuamente a estratégia.
- Evitar complexidade técnica desnecessária.
- Desenvolver uma solução funcional, testável e sustentável.
- Não estabelecer uma meta mensal fixa de contatos antes de termos dados reais sobre a capacidade operacional e a efetividade da abordagem.

---

## 2. Contexto comercial

### 2.1. Público-alvo

O público-alvo inicial são software houses e agências de desenvolvimento de software estrangeiras que trabalham com projetos para clientes e podem precisar ampliar sua capacidade técnica.

O foco não deve ser empresas que estejam apenas anunciando vagas de emprego. A prospecção deve buscar oportunidades comerciais de colaboração, contratação de desenvolvedores externos ou reforço temporário de equipes.

### 2.2. Perfil de cliente ideal (ICP)

| Critério | Definição inicial |
|---|---|
| Tipo de empresa | Software houses e agências de desenvolvimento de software |
| Tamanho | Aproximadamente 5 a 50 funcionários |
| Mercados prioritários | Estados Unidos e Reino Unido |
| Mercados secundários | Canadá, Irlanda e Austrália |
| Modelo de negócio | Desenvolvimento de software para clientes, projetos recorrentes ou equipes dedicadas |
| Necessidade potencial | Aumento de capacidade de desenvolvimento, apoio a projetos ou contratação de desenvolvedores externos |
| Tecnologias relevantes | Node.js, TypeScript, NestJS, React, PostgreSQL e AWS |
| Decisores | Founder, CTO, Head of Engineering, Engineering Manager e Delivery Manager |

Esses critérios são parâmetros iniciais, não regras absolutas.

O sistema deverá permitir ajustar os critérios de qualificação conforme os resultados da prospecção.

### 2.3. Sinais de oportunidade

A automação deverá permitir registrar indícios de que uma empresa pode precisar de capacidade adicional de desenvolvimento.

Exemplos:

- Crescimento recente da equipe.
- Novos contratos ou projetos anunciados.
- Expansão dos serviços oferecidos.
- Projetos compatíveis com minha stack tecnológica.
- Histórico de contratação de desenvolvedores externos.
- Publicações sobre aumento da demanda ou dificuldades de entrega.
- Necessidade de competências técnicas que correspondam ao meu perfil.

A existência de um sinal não significa que a empresa esteja necessariamente procurando um desenvolvedor naquele momento.

O sistema deverá distinguir fatos verificados de hipóteses comerciais.

---

## 3. Escopo funcional

O projeto deverá organizar o processo de prospecção em etapas.

### 3.1. Identificação e cadastro de empresas

O sistema deverá permitir cadastrar empresas potencialmente qualificadas para a prospecção.

Cada empresa deverá possuir, quando disponível:

- Nome da empresa.
- Site oficial.
- País.
- Cidade ou região.
- Segmento de atuação.
- Número aproximado de funcionários.
- Descrição dos serviços.
- Tecnologias utilizadas.
- Evidências de compatibilidade com o ICP.
- Sinais de oportunidade identificados.
- Fonte das informações.
- Data da última verificação.
- Nível de prioridade.
- Status comercial.
- Observações.

A origem e a confiabilidade dos dados deverão ser consideradas.

Não se deve inventar informações ausentes nem classificar uma empresa como qualificada apenas por possuir um site relacionado a tecnologia.

### 3.2. Cadastro de contatos

Quando houver informações públicas e legítimas disponíveis, o sistema deverá permitir cadastrar os profissionais relevantes de cada empresa.

Campos possíveis:

- Nome.
- Cargo.
- Empresa associada.
- E-mail profissional.
- Fonte do contato.
- Perfil profissional público, quando disponível.
- Data de identificação.
- Status de verificação do contato.
- Observações.

Os cargos prioritários são:

- Founder.
- Co-Founder.
- CTO.
- Head of Engineering.
- Engineering Manager.
- Delivery Manager.

O sistema deverá evitar duplicidades e permitir que vários contatos estejam associados à mesma empresa.

Deverá também respeitar a legislação aplicável à coleta e ao uso de dados pessoais, além das políticas dos provedores utilizados.

### 3.3. Qualificação de leads

Cada empresa deverá receber uma avaliação de compatibilidade com o perfil de cliente ideal.

A qualificação poderá considerar:

- Compatibilidade do modelo de negócio.
- Tamanho da empresa.
- País.
- Compatibilidade tecnológica.
- Evidências de projetos recorrentes.
- Sinais de demanda.
- Disponibilidade de um contato comercial relevante.
- Confiabilidade das informações coletadas.

O sistema deverá apresentar os motivos da classificação, permitindo compreender por que determinada empresa recebeu prioridade.

Não implementar uma pontuação arbitrária sem documentar os critérios utilizados.

A pontuação deverá ser configurável e validada durante a utilização inicial.

### 3.4. Organização da base comercial

A base deverá permitir consultar e filtrar empresas por critérios como:

- País.
- Tamanho.
- Tecnologias.
- Prioridade.
- Status da prospecção.
- Data da última interação.
- Próxima ação.
- Existência de contatos identificados.
- Existência de respostas.
- Motivo de desqualificação.

Também deverá ser possível identificar empresas duplicadas e evitar que a mesma empresa receba abordagens repetidas por engano.

### 3.5. Preparação das abordagens

O sistema deverá auxiliar na criação de mensagens comerciais personalizadas para cada empresa.

A abordagem deverá ser baseada em informações verificadas sobre a empresa e no meu perfil profissional.

A comunicação deverá apresentar a possibilidade de colaboração como desenvolvedor externo, sem pressupor que a empresa possui uma vaga aberta ou uma necessidade que não foi confirmada.

A mensagem poderá considerar:

- Nome da empresa.
- Área de atuação.
- Projetos ou serviços relevantes.
- Tecnologias utilizadas.
- Motivo específico do contato.
- Como minha experiência pode ser relevante.
- Convite simples para iniciar uma conversa.

O sistema deverá permitir gerar e revisar a mensagem antes do envio.

A personalização não poderá depender de informações inventadas.

Mensagens genéricas deverão ser identificadas como tais, sem simular uma pesquisa que não foi realizada.

### 3.6. Gestão de campanhas de prospecção

O sistema deverá organizar as empresas em campanhas ou lotes de prospecção.

Cada campanha poderá conter:

- Nome interno.
- Critérios de seleção.
- Mercado ou país.
- Perfil das empresas.
- Data de início.
- Mensagens utilizadas.
- Quantidade de empresas selecionadas.
- Quantidade de contatos realizados.
- Resultados obtidos.
- Observações sobre a campanha.

O objetivo é permitir comparar diferentes segmentos, abordagens e mensagens.

Não será necessário implementar inicialmente um sistema complexo de marketing automation.

A prioridade será construir um processo simples, rastreável e funcional.

### 3.7. Envio de mensagens

O canal inicial de prospecção será o e-mail profissional.

A implementação deverá avaliar a melhor integração disponível para envio e acompanhamento de mensagens, considerando o ambiente e a infraestrutura já existentes no projeto.

O sistema deverá registrar, no mínimo:

- Destinatário.
- Empresa associada.
- Campanha.
- Conteúdo enviado.
- Data e horário do envio.
- Identificador da mensagem, quando disponível.
- Status do envio.
- Resultado ou erro retornado pelo provedor.

O envio deverá ocorrer somente para contatos selecionados e aprovados conforme as regras definidas.

A integração deverá impedir o envio duplicado causado por reprocessamento ou repetição de uma operação.

O sistema não deverá marcar uma mensagem como enviada quando o provedor retornar uma falha.

### 3.8. Acompanhamento e follow-ups

O sistema deverá permitir acompanhar contatos que ainda não responderam e identificar quando uma próxima ação estiver prevista.

O fluxo poderá contemplar:

1. Primeiro contato.
2. Aguardar resposta.
3. Programar um follow-up, quando apropriado.
4. Registrar a resposta recebida.
5. Encerrar a sequência quando houver resposta, recusa ou solicitação de interrupção.

As regras de follow-up deverão ser configuráveis.

Não definir inicialmente uma sequência agressiva de mensagens nem enviar contatos repetidos indefinidamente.

Antes de qualquer follow-up, o sistema deverá verificar se o contato já respondeu, recusou a abordagem, pediu para não receber novas mensagens ou foi marcado para não receber contatos.

A quantidade de tentativas e os intervalos deverão ser definidos com base na estratégia comercial e nos resultados observados.

### 3.9. Registro de respostas

O sistema deverá permitir registrar e classificar as respostas recebidas.

Categorias iniciais:

- Interesse em conversar.
- Interesse em colaboração futura.
- Solicitação de mais informações.
- Solicitação de currículo ou portfólio.
- Ausência de necessidade no momento.
- Recusa.
- Encaminhamento para outro contato.
- Resposta automática.
- Endereço inválido.
- Solicitação para interromper os contatos.
- Resposta inconclusiva.

A classificação automática poderá ser implementada posteriormente, caso seja útil.

Na primeira versão, deverá ser possível registrar e corrigir a classificação manualmente.

O sistema nunca deverá interpretar uma resposta ambígua como uma oportunidade confirmada sem revisão.

### 3.10. Histórico comercial

Cada empresa deverá possuir um histórico de interações.

Esse histórico deverá permitir identificar:

- Quando a empresa foi cadastrada.
- Quais contatos foram identificados.
- Quais mensagens foram enviadas.
- Quando ocorreram os envios.
- Quais respostas foram recebidas.
- Quais follow-ups foram realizados.
- Quais alterações de status ocorreram.
- Qual será a próxima ação.
- Por que a prospecção foi encerrada, quando aplicável.

O histórico deverá evitar a perda de informações importantes e facilitar a retomada de uma negociação.

---

## 4. Estados do processo comercial

O sistema deverá utilizar estados explícitos para representar o estágio de cada empresa.

| Estado | Significado |
|---|---|
| `identified` | Empresa identificada, ainda não avaliada |
| `researching` | Informações sendo coletadas ou verificadas |
| `qualified` | Empresa considerada compatível com o ICP |
| `disqualified` | Empresa considerada inadequada |
| `ready_for_contact` | Empresa qualificada e pronta para abordagem |
| `contacted` | Primeiro contato realizado com sucesso |
| `follow_up_due` | Existe uma próxima ação de acompanhamento prevista |
| `replied` | Foi recebida uma resposta |
| `interested` | Existe interesse comercial identificado |
| `meeting_scheduled` | Conversa ou reunião agendada |
| `opportunity` | Oportunidade comercial em avaliação |
| `converted` | O contato resultou em uma contratação ou colaboração |
| `not_interested` | Empresa ou contato recusou a abordagem |
| `do_not_contact` | Não realizar novos contatos |
| `inactive` | Prospecção pausada ou encerrada sem conversão |

A implementação deverá avaliar se todos esses estados são necessários para a primeira versão.

Não criar complexidade desnecessária. Caso seja possível começar com um conjunto menor, documentar a decisão e manter a possibilidade de evolução.

As transições deverão ser validadas para evitar estados inconsistentes.

Por exemplo, uma empresa marcada como `do_not_contact` não poderá voltar automaticamente para uma fila de envio.

---

## 5. Métricas e análise de resultados

### 5.1. Indicadores operacionais

- Empresas cadastradas.
- Empresas qualificadas.
- Contatos identificados.
- Empresas prontas para abordagem.
- Mensagens enviadas com sucesso.
- Falhas de envio.
- Follow-ups pendentes.
- Respostas recebidas.
- Empresas que solicitaram interrupção dos contatos.
- Oportunidades em andamento.
- Contratações ou colaborações concretizadas.

### 5.2. Indicadores de desempenho comercial

Quando houver dados suficientes, calcular:

- **Taxa de resposta:** contatos com resposta / contatos efetivamente abordados, conforme definição documentada.
- **Taxa de interesse:** respostas com interesse / contatos com resposta.
- **Taxa de conversão:** contratações ou colaborações concretizadas / contatos abordados.
- **Taxa de falha de envio:** tentativas que falharam / total de tentativas.

Os indicadores deverão deixar explícitos seus denominadores, período analisado e critérios de inclusão.

Não confundir mensagens enviadas com mensagens entregues, nem respostas com oportunidades comerciais.

Se o provedor não disponibilizar dados de entrega ou abertura, o sistema não deverá inventá-los.

### 5.3. Análise por campanha

Deverá ser possível comparar campanhas e identificar:

- Quais países apresentam melhores resultados.
- Quais segmentos respondem melhor.
- Quais características de empresas estão associadas a respostas positivas.
- Quais mensagens geram conversas relevantes.
- Quais abordagens apresentam resultados ruins.
- Em quais etapas ocorrem mais perdas.
- Quais atividades operacionais ainda exigem trabalho manual.

As conclusões deverão ser baseadas nos dados registrados, sem atribuir causalidade indevida a amostras pequenas.

---

## 6. Arquitetura e implementação técnica

### 6.1. Inspeção inicial obrigatória

Antes de escrever código, inspecionar o repositório: estrutura, linguagem, frameworks, gerenciador de pacotes, persistência, integrações, autenticação, configuração de ambiente, deploy, convenções, testes e funcionalidades reutilizáveis. Não presumir que o projeto começa do zero.

### 6.2. Decisões de arquitetura

Propor arquitetura compatível com o projeto existente, explicando componentes, responsabilidades, fluxo de dados, persistência, integrações, configuração, tratamento de falhas, testes, custos e limitações. Não adicionar tecnologias por preferência pessoal. Evitar filas, serviços gerenciados, bancos adicionais ou infraestrutura complexa sem necessidade demonstrada.

### 6.3. Separação de responsabilidades

Separar, quando compatível: cadastro e qualificação de empresas, contatos, preparação de mensagens, envio de e-mails, campanhas, follow-ups, respostas, métricas, integrações externas, persistência e regras comerciais. Regras de negócio não devem depender de um provedor de e-mail ou interface específicos.

### 6.4. Persistência

Considerar integridade, identificadores consistentes, relacionamentos entre empresas, contatos, campanhas e mensagens, prevenção de duplicidades, histórico, recuperação após falhas, migrações e proteção de dados pessoais. Não introduzir nova base de dados se a infraestrutura atual resolver.

### 6.5. Configuração

Credenciais e configurações sensíveis por variáveis de ambiente (provedor de e-mail, tokens, remetente, limites, follow-ups, logs, ambiente). Nunca inserir credenciais reais no código, testes, exemplos ou controle de versão.

---

## 7. Integrações externas

### 7.1. Provedor de e-mail

Escolher considerando compatibilidade, custo, limites, documentação, autenticação, registro, erros, webhooks para respostas/eventos e uso de domínio profissional configurado. Apresentar alternativas antes de adicionar dependências. Não pressupor que qualquer provedor permite envio comercial em massa. Respeitar limites, termos e políticas.

### 7.2. Coleta de informações

Priorizar fontes públicas, confiáveis e adequadas. APIs pagas ou enriquecimento de dados exigem explicação de necessidade e custo antes. Cadastro manual deve funcionar sem integração de pesquisa automática.

### 7.3. Recebimento de respostas

Recebimento automático via provedor quando viável, com limitações documentadas. Se não fizer parte da primeira versão, permitir registro manual sem comprometer o histórico.

---

## 8. Automação e controle operacional

### 8.1. Execução segura

Rotinas reexecutáveis sem duplicação. Distinguir operação solicitada, em execução, concluída, falha e resultado não confirmado. Idempotência no envio sempre que possível.

### 8.2. Aprovação de mensagens

Na primeira versão, mensagens revisadas antes do envio. Aprovação humana para novas campanhas, novos modelos de mensagem, novos segmentos e alterações relevantes nas regras de envio. Envio automático só depois de fluxos testados e controles validados.

### 8.3. Limites e prevenção de abuso

Limites configuráveis de envio; prevenção de duplicados; respeito a descadastramento; supressão de inválidos; registro de falhas; pausa de campanhas; interrupção segura; tratamento de respostas antes de novos follow-ups.

---

## 9. Segurança e privacidade

Proteger credenciais; evitar dados pessoais em logs; restringir acesso; validar entradas; tratar erros sem revelar segredos; registrar operações relevantes; evitar dados de fontes incompatíveis; permitir interromper contatos; respeitar a legislação de EUA, Reino Unido, Canadá, Irlanda e Austrália conforme mercados usados. Não presumir que contato público autoriza qualquer comunicação. Documentar decisões legais sem tratar implementação técnica como garantia de conformidade.

---

## 10. Escopo da primeira versão (MVP)

### Funcionalidades prioritárias

1. Cadastro de empresas.
2. Cadastro de contatos.
3. Qualificação manual ou assistida de empresas.
4. Organização dos leads por status.
5. Registro de fontes e evidências.
6. Preparação de mensagens personalizadas.
7. Revisão e aprovação antes do envio.
8. Integração com um provedor de e-mail.
9. Registro dos envios e dos respectivos resultados.
10. Controle de follow-ups.
11. Registro de respostas.
12. Histórico de interações.
13. Prevenção de duplicidades.
14. Respeito aos contatos que não devem receber novas mensagens.
15. Relatório básico de resultados.

Se não existir interface, propor a forma mais simples e sustentável de operar, sem criar aplicação web completa por padrão.

### Fora da prioridade inicial

CRM complexo; IA em todas as etapas; agentes autônomos irrestritos; múltiplos provedores de e-mail; enriquecimento pago; grandes pipelines de coleta; infraestrutura distribuída; painéis avançados; sequências multicanal; automação de redes sociais; marca de software sob medida; site institucional, Instagram ou TikTok.

---

## 11. Estratégia de implementação

- **Etapa A — auditoria do repositório.** Critério: diagnóstico técnico documentado, decisões justificadas.
- **Etapa B — estrutura comercial e persistência** (empresas, contatos, campanhas, mensagens, interações, estados, próximas ações). Critério: cadastro e atualização confiáveis, relacionamentos consistentes, validações e testes.
- **Etapa C — fluxo de prospecção** (seleção, preparação, revisão, integração, registro, erros, duplicidades). Critério: campanha de teste com dados controlados e histórico verificável.
- **Etapa D — follow-ups e acompanhamento** (próximas ações, pendentes, respostas, interrupção, histórico, prevenção de follow-ups indevidos). Critério: acompanhar do primeiro contato à resposta ou encerramento.
- **Etapa E — métricas e operação** (indicadores, relatórios por campanha, falhas, documentação, ambiente, testes ponta a ponta simulados, procedimento da primeira campanha real). Critério: sistema documentado, testado e pronto para uso real.

---

## 12. Testes obrigatórios

- **Cadastro e qualificação:** empresa válida; atualização; duplicidades; contatos na empresa correta; qualificação com dados incompletos; fonte registrada.
- **Envio:** sucesso; falha do provedor; registro do resultado; duplicados; contato bloqueado; validação de destinatários; preservação do conteúdo aprovado.
- **Follow-ups:** pendentes; follow-up conforme regras; cancelamento após resposta; interrupção após recusa; bloqueio após pedido de interrupção; recuperação após falhas.
- **Histórico e métricas:** interações; mensagens associadas a empresa e campanha; cálculo de indicadores; ausência de dados; consistência entre estados e histórico.
- **Integrações:** sem envios reais, APIs pagas ou contatos verdadeiros. Usar mocks, stubs ou ambientes de teste.

---

## 13. Critérios gerais de aceitação

1. Cadastrar e qualificar empresas estrangeiras.
2. Registrar contatos associados.
3. Preparar mensagens personalizadas.
4. Revisar mensagens antes do envio.
5. Envios registrados com resultados.
6. Duplicações indevidas impedidas.
7. Acompanhar respostas e follow-ups.
8. Contatos bloqueados respeitados.
9. Histórico comercial disponível.
10. Métricas básicas corretas.
11. Principais fluxos com testes automatizados.
12. Configurações e credenciais documentadas e protegidas.
13. Execução por instruções claras.
14. Nenhuma dependência externa não documentada.
15. Primeira campanha executável com aprovação humana.

---

## 14. Diretrizes

- Trabalhar sobre o projeto existente.
- Etapas pequenas e verificáveis; ao final de cada uma: resumo, decisões, testes, limitações, como validar, próxima etapa.
- Evitar complexidade desnecessária.
- Não presumir credenciais ou serviços; não acessar contas externas nem enviar mensagens reais sem autorização explícita.
- Preservar o controle comercial: operações com efeito externo exigem aprovação.
- Documentar decisões (arquitetura, custos, segurança, manutenção, escalabilidade, operação, limitações).
- Não inventar funcionalidades concluídas: distinguir implementado, testado, dependente de configuração externa, não implementado e limitações.

---

## 15. Cronograma

- **Outubro de 2026:** construir e testar; chegar ao fim do mês com processo operacional utilizável.
- **Novembro de 2026:** iniciar prospecção organizada e registrar resultados.
- **Dezembro de 2026:** analisar e otimizar; definir evolução para 2027.

O cronograma orienta prioridades, mas não justifica ignorar testes ou operar integração não validada.

---

## 16. Relação com outros projetos pessoais

Hermes (tarefas, metas, métricas), Renato (ideias e decisões) e Obsidian Vault (documentação) podem se integrar depois, mas não são requisitos do MVP. A automação deve funcionar de forma independente.

---

## 17. Relatório por etapa

Resumo; alterações técnicas; decisões de arquitetura; testes; configuração; pendências; próxima etapa. Ao concluir o MVP: procedimento para campanha de teste e para a primeira campanha real com aprovação humana.
