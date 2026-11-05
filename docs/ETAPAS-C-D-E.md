# Etapas C, D e E — Envio, acompanhamento e métricas

Data: 2026-10-26.

## Implementado e testado

**C — fluxo de prospecção**

- Campanhas com status `draft`, `active`, `paused` e `closed`. Ativar é a aprovação humana e exige template aprovado.
- Templates versionados por etapa. Uma versão aprovada é imutável (trigger no banco); mudar o texto cria nova versão, que precisa de nova aprovação.
- Seleção de empresas `qualified` com contato apto. Uma empresa fica em no máximo uma campanha aberta, com um contato (decisor e verificado têm preferência).
- Rascunho personalizado só com `--reason` citando fato verificado da empresa; sem isso a mensagem é marcada como genérica e a linha de motivo some.
- Revisão interativa (`message review`), edição no `$EDITOR` e aprovação que trava o conteúdo por hash (destinatário, assunto e corpo).
- Envio:
  - reserva atômica da mensagem (`approved -> sending`) e chave única (campanha, contato, etapa);
  - trava de execução única;
  - limite diário e intervalo entre envios;
  - checagens de elegibilidade antes de cada mensagem;
  - `Message-ID` próprio e cabeçalho `List-Unsubscribe`.
- Resultados:
  - erro explícito do provedor vira `failed`;
  - timeout ou queda vira `unknown`, e o mesmo vale para uma execução interrompida no meio;
  - `unknown` só sai por conciliação manual (`message resolve`).
- Transportes: `outbox` (padrão, grava `.eml`) e `smtp` (`nodemailer`), este testado contra um servidor SMTP local nos testes automatizados.
- Envio por SMTP pede confirmação digitando `ENVIAR`; `--dry-run` mostra o que sairia.

**D — follow-ups e acompanhamento**

- Follow-ups calculados na hora, a partir do **primeiro** e-mail e dos dias úteis de `config/sending.json` (padrão: até 3 follow-ups, em 3, 5 e 7 dias úteis; um envio atrasado nunca faz o seguinte vencer no mesmo dia). Cada follow-up é opcional: só sai se a campanha tiver o template da etapa aprovado. Nada fica agendado que precise ser cancelado.
- Antes de listar ou enviar um follow-up, o sistema confere resposta registrada, status da empresa, contato bloqueado e supressão.
- Respostas manuais com as 11 categorias da spec. Efeitos:
  - qualquer resposta humana cancela as mensagens pendentes da empresa e move `contacted -> replied`;
  - recusa leva a `not_interested`;
  - descadastro leva a supressão permanente e `do_not_contact`;
  - endereço inválido marca o contato como inválido e suprime o endereço;
  - resposta automática não conta e não interrompe a sequência.
- Correção de classificação aplica o novo efeito e registra a correção. Nenhuma resposta leva automaticamente a `interested` ou `opportunity`.
- Supressão por e-mail ou domínio, guardando só o hash. O banco impede apagar supressões.
- Remoção de dados pessoais a pedido: o endereço continua bloqueado, e mensagens, respostas e histórico perdem o conteúdo pessoal, mas os números das métricas continuam.

**E — métricas e operação**

- `report` com indicadores operacionais, as quatro taxas da spec (numerador, denominador e definição), quebra por campanha, país e tipo de mensagem (genérica ou personalizada), aviso de amostra pequena e de envios não conciliados.
- Documentação operacional em [OPERACAO.md](OPERACAO.md): e-mail, DNS, campanha de teste, teste SMTP, primeira campanha real, rotina, notas legais e problemas comuns.

81 testes automatizados, nenhum com envio real. A CLI também foi testada manualmente de ponta a ponta com o transporte `outbox`.

## Definições das métricas

- **Abordados:** contatos cujo primeiro e-mail (etapa 0) foi enviado no período. Respostas e conversões desse grupo contam quando quer que aconteçam; por isso períodos recentes parecem piores até as respostas chegarem.
- **Taxa de resposta:** abordados com resposta humana (exclui `auto_reply` e `invalid_address`) / abordados.
- **Taxa de interesse:** contatos com `interested_to_talk`, `future_collaboration`, `more_info` ou `cv_or_portfolio` / contatos com resposta.
- **Taxa de conversão:** empresas em `converted` / empresas abordadas. Por empresa, porque a contratação é da empresa.
- **Taxa de falha:** tentativas `failed` / tentativas. `unknown` fica fora do numerador e aparece em aviso separado.
- Entrega e abertura não são medidas. Não há pixel de rastreamento: prejudicaria a entregabilidade e não seria confiável.

## Decisões

- **SMTP em vez de API de provedor transacional:** e-mail 1:1 de uma caixa real, respostas na mesma caixa, troca de provedor só no `.env`. Detalhes na auditoria.
- **Respostas registradas à mão.** A leitura automática via IMAP fica como evolução: o `Message-ID` gravado permite casar respostas pelos cabeçalhos `In-Reply-To` e `References`.
- **Uma empresa, um contato, uma campanha aberta.** Evita abordar a mesma empresa duas vezes por engano. Para trocar de contato, encerre a campanha ou use outra depois.
- **Sem agendador.** Follow-ups e limites são avaliados quando você roda os comandos. Rodar `send` uma vez por dia basta e evita deixar um processo rodando.
- **Sem IA.** A personalização vem do motivo que você escreve, preso a um fato verificado. Gerar rascunhos com IA pode virar um adaptador depois, passando pela mesma aprovação.

## Limitações

- Integração SMTP validada contra o servidor local de teste e com envio real via Gmail para a própria caixa em 2026-10-26 (mensagem entregue). Falta repetir com o domínio próprio, conferindo SPF, DKIM e DMARC, antes da primeira campanha.
- Os arquivos `.eml` do transporte `outbox` não são apagados por `contact forget`. Use o outbox só com dados de teste.
- Horários em UTC; o limite diário vira à meia-noite UTC.
- Sem janela de horário por fuso do destinatário: rode `send` em horário comercial de Brasília (foco atual: Brasil).
- Sem edição ou exclusão de evidências e respostas. Corrija registrando uma nova evidência ou usando `reply correct`.
- Os pesos da qualificação e o texto dos templates ainda precisam ser calibrados com os resultados de novembro.

## Pendências externas

1. Domínio e caixa de e-mail com SMTP, com SPF, DKIM e DMARC.
2. Endereço postal para o rodapé.
3. Repetir o teste SMTP com o domínio próprio (o teste via Gmail já passou).
4. ~~Template em inglês~~ Não se aplica: foco só no Brasil desde 2026-10-30; os templates em `templates/` estão em português.

## Próxima etapa recomendada

Operar: cadastrar e qualificar as primeiras 10 a 20 empresas brasileiras (`prospect run --country BR`) enquanto o domínio aquece, e rodar a campanha de teste da OPERACAO.md. Depois do primeiro mês de dados, avaliar a leitura automática de respostas por IMAP, o ponto manual mais repetitivo.
