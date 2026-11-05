# Operação

## 1. Preparar o e-mail (uma vez)

1. **Domínio.** O domínio das SHs e consultorias é o seu próprio (decidido em 2026-11-05; `seudominio.com.br`, ainda a comprar). Cold e-mail desgasta a reputação do domínio, e quem escreve é você como pessoa, não a marca. Não use lou.dev nem LudenDev. Custo típico: US$10–15/ano.
2. **Caixa profissional.** Crie uma caixa nesse domínio num provedor com SMTP: Google Workspace, Zoho Mail ou Fastmail. Confira os termos e limites de envio do plano antes de contratar.
3. **DNS.** Configure, seguindo o guia do provedor:
   - **SPF** (registro TXT autorizando o provedor);
   - **DKIM** (chave gerada no painel do provedor);
   - **DMARC** (comece com `v=DMARC1; p=none; rua=mailto:voce@seunome.dev`).

   Valide com o próprio painel do provedor ou com uma ferramenta como mail-tester.com.
4. **Senha de app.** Gere uma senha específica para SMTP. Nunca use a senha principal da conta.
5. **Aquecimento.** Use a caixa normalmente por alguns dias antes da primeira campanha: assinatura, algumas trocas de e-mail reais. Domínio novo mandando prospecção no primeiro dia tende a cair em spam.
   - Dias 1 a 3: só e-mails reais (amigos, você mesmo, cadastros), sem prospecção.
   - Semana 1 de envio: 3 a 5 por dia, só as empresas de melhor encaixe. Suba aos poucos até o `dailyLimit` (20).
   - Pare e investigue ao primeiro sinal de spam (resposta de bounce em série, "caiu no spam" ou reclamação). Perder uma semana aqui custa menos que queimar o domínio.
6. **`.env`:**

   ```
   SENDER_NAME=Seu Nome
   SENDER_EMAIL=voce@seudominio.com.br
   SENDER_POSTAL_ADDRESS=CNPJ 00.000.000/0001-00 · Cidade/UF
   EMAIL_TRANSPORT=smtp
   SMTP_HOST=smtp.provedor.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=voce@seunome.dev
   SMTP_PASSWORD=senha-de-app
   ```

   A linha do rodapé identifica o remetente (CNPJ e cidade conforme o cadastro público; o endereço postal completo é exigência do CAN-SPAM, só se um dia houver envio para os EUA).

7. **Descadastro por link.** Um Worker da Cloudflare (`worker/descadastro/`) serve a página de saída. O e-mail leva um link pessoal e assinado; o clique mostra um botão de confirmação (um GET nunca descadastra, porque filtros de e-mail abrem links sozinhos). O cabeçalho `List-Unsubscribe-Post` faz o Gmail mostrar o botão nativo "cancelar inscrição". Só o hash do endereço é guardado.
   - Já publicado em `https://descadastro.SUA-CONTA.workers.dev` (teste de ponta a ponta feito em 2026-11-05). O `.env` tem `UNSUBSCRIBE_BASE_URL`, `UNSUBSCRIBE_SECRET` e `UNSUBSCRIBE_API_TOKEN` (as três juntas, ou nenhuma). Sem elas o rodapé volta a pedir resposta por e-mail.
   - Ao comprar o domínio próprio, ligue o Worker a uma rota dele (ex.: `seudominio.com.br/d*` e `/api/*`) e troque só `UNSUBSCRIBE_BASE_URL`. Faça isso **antes do primeiro envio**: links já enviados apontam para o endereço antigo.
   - Antes de cada `send`, o app busca os descadastros e aplica o mesmo efeito de uma resposta "unsubscribe" (mensagens pendentes canceladas, endereço bloqueado para sempre, empresa fechada). Se não conseguir consultar o serviço, **nada é enviado**. Para conferir à mão: `npm run cli -- optout sync`.
   - A lista do Cloudflare KV pode demorar até cerca de 1 minuto para refletir um clique novo.

## 2. Campanha de teste (sem envio real)

Com `EMAIL_TRANSPORT=outbox` e um banco separado, para não misturar com os dados reais:

```bash
export DATABASE_PATH=./data/teste.db OUTBOX_DIR=./data/outbox-teste
npm run cli -- company add --name "Empresa Teste" --website teste.example --country BR --employees 10 --tech "React;Node.js" --source manual
npm run cli -- evidence add teste.example --kind business_model --claim "atende clientes" --certainty verified --source manual
npm run cli -- contact add teste.example --name "Pessoa Teste" --role CTO --email cto@teste.example --source manual
npm run cli -- company status teste.example qualified
npm run cli -- campaign create teste --market BR
npm run cli -- campaign template teste --step 0 --subject "Reforço de desenvolvimento para a {{company.name}}" --file templates/first.txt
npm run cli -- campaign approve-template teste
npm run cli -- campaign activate teste
npm run cli -- campaign select teste
npm run cli -- message draft-all teste
npm run cli -- message review teste
npm run cli -- send teste
npm run cli -- reply add cto@teste.example --category interested_to_talk
npm run cli -- report
npm run cli -- company show teste.example
```

Confira o `.eml` gerado em `data/outbox-teste/`, o histórico da empresa e o relatório. Depois apague `data/teste.db` e `data/outbox-teste/`.

## 3. Teste do SMTP real (só para você)

Antes da primeira campanha real, envie uma mensagem para uma caixa sua:

1. Banco separado (`DATABASE_PATH=./data/smtp-teste.db`) e `EMAIL_TRANSPORT=smtp`.
2. Cadastre uma empresa com o domínio de uma caixa sua e um contato com esse endereço. Se for Gmail, use `--website gmail.com` e o seu endereço.
3. Repita o fluxo da seção 2 e rode `send`. A CLI pede para digitar `ENVIAR`.
4. Confirme:
   - a mensagem chegou na caixa de entrada, não no spam;
   - o remetente e o rodapé estão corretos;
   - nos cabeçalhos, SPF, DKIM e DMARC aparecem como `pass`;
   - a mensagem está na pasta Enviados do provedor.
5. Responda à mensagem e registre com `reply add` para treinar o fluxo.

## 4. Primeira campanha real

Checklist antes do `send`:

- [ ] Seções 1 e 3 concluídas, com SPF, DKIM e DMARC passando.
- [ ] Só Brasil nesta fase (decisão de 2026-10-30). Empresas de outros países ficam para quando o inglês permitir; as notas legais deles estão na seção 6.
- [ ] Só e-mails de pessoas ligadas à empresa (CNPJ), com finalidade clara. Evite e-mail pessoal de pessoa física.
- [ ] Toda empresa tem fato verificado, e todo e-mail tem fonte pública registrada.
- [ ] Template revisado em português, sem prometer o que não foi confirmado e sem supor que existe vaga aberta.
- [ ] Mensagens personalizadas com motivo real (`--reason` e `--evidence`). Reveja as genéricas uma a uma: mande só as que fazem sentido.
- [ ] Lote pequeno na primeira semana (sugestão: 5 a 10 empresas), abaixo do `dailyLimit`.
- [ ] `send <campanha> --dry-run` conferido.

Execução:

```bash
npm run cli -- campaign select uk-agencies-nov --country GB --limit 10
npm run cli -- message draft uk-agencies-nov <domínio> --reason "..." --evidence <id>   # para cada empresa
npm run cli -- message review uk-agencies-nov
npm run cli -- send uk-agencies-nov --dry-run
npm run cli -- send uk-agencies-nov
```

## 5. Rotina

**Diária, cerca de 10 minutos:**

1. Leia a caixa de entrada e registre cada resposta: `reply add <e-mail> --category ...`.
   - Fora do escritório: `auto_reply`.
   - Bounce: `invalid_address`.
   - "Remove me": `unsubscribe`.
2. `npm run cli -- message list --status unknown`. Se houver alguma, confira na pasta Enviados e use `message resolve <id> --sent` ou `--not-sent`.
3. `npm run cli -- company list --due-by <hoje>` para as próximas ações vencidas.
4. Para interesse real: `company status <domínio> interested`; depois `opportunity` ou `converted`, conforme avançar.

**Semanal:**

1. `followup due`, depois `followup draft <campanha>`, `message review <campanha>` e `send <campanha>`.
2. `report --campaign <campanha>`.
3. Cadastre e qualifique o próximo lote.

**Pedido de remoção de dados:** `contact forget <e-mail> --reason "pedido por e-mail em AAAA-MM-DD"`.

## 6. Notas legais

Resumo para orientar a operação. Não é parecer jurídico.

| País | Regra principal | Como o sistema ajuda |
|---|---|---|
| EUA (CAN-SPAM) | B2B permitido; remetente real, assunto honesto, endereço postal, opt-out atendido em até 10 dias úteis | rodapé obrigatório, `List-Unsubscribe`, supressão imediata |
| Reino Unido (PECR + UK GDPR) | e-mail para empresas permitido com identificação e opt-out; pessoa física exige consentimento | fonte por contato, supressão, remoção de dados |
| Irlanda (S.I. 336/2011 + GDPR) | semelhante ao Reino Unido | idem |
| Canadá (CASL) | exige consentimento; exceção para e-mail publicado sem aviso contra e relacionado à função | fonte por contato (guarde onde estava publicado) |
| Austrália (Spam Act) | consentimento inferido em condições semelhantes ao Canadá | idem |
| Brasil (LGPD) | foco atual. Você trata os dados daqui: finalidade, minimização, exclusão a pedido. A base legal usual para contato B2B é o legítimo interesse, com identificação clara e opt-out | fonte por contato, supressão, `contact forget` |

## 7. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `Sem valor para {{sender.postalAddress}}` | `.env` incompleto | preencha `SENDER_*` |
| `Configuração inválida: SMTP_HOST obrigatória` | `EMAIL_TRANSPORT=smtp` sem credenciais | complete o `.env` |
| `failed` com `EAUTH` ou `535` | senha errada | gere nova senha de app |
| `unknown` | timeout ou conexão caída | conferir Enviados e usar `message resolve` |
| `Já existe um envio em andamento` | outro `send` rodando ou um que caiu há menos de 30 min | aguarde; depois de 30 min a trava expira |
| Mensagem cancelada no `send` | contato, empresa ou conteúdo mudou depois da aprovação | veja o motivo em `message show <id>` |
