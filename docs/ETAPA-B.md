# Etapa B — Estrutura comercial e persistência

Data: 2026-10-26.

## Implementado e testado

- Empresas: cadastro, atualização com registro dos campos alterados, deduplicação por domínio normalizado, aviso de empresas parecidas (nome normalizado ou subdomínio) e `company duplicates`.
- Contatos: vários por empresa, deduplicação por e-mail (global) e por nome dentro da empresa, e-mail validado contra o domínio da empresa, fonte obrigatória quando há e-mail, `do_not_contact` por contato (remoção só com motivo).
- Evidências com tipo, fato ou hipótese, a favor ou contra, e fonte obrigatória para fato verificado (no caso de uso e por CHECK no banco).
- Qualificação configurável com motivos, cobertura e requisito de fato verificado para `qualified`.
- Status com tabela de transições, motivo obrigatório nos encerramentos e `do_not_contact` sem volta automática.
- Próxima ação, notas e histórico somente inclusão.
- Listagem com os filtros da spec 3.4, exceto "existência de respostas" (depende da Etapa D).
- Importação CSV idempotente, linha a linha, com relatório.
- Migrações versionadas.

44 testes automatizados (`npm test`), todos com SQLite em memória e relógio controlado.

## Decisões

- **Estados reduzidos de 15 para 11**: `researching`, `ready_for_contact`, `follow_up_due` e `meeting_scheduled` não são persistidos. "Pronta para contato" e "follow-up vencido" serão calculados na Etapa C/D a partir de status, contatos, supressão e `next_action_at`.
- **Repositórios síncronos.** `better-sqlite3` é síncrono, e manter o core síncrono deixa as transações (escrita + histórico) simples e atômicas. O envio de e-mail (assíncrono) ficará fora dessas transações, com estado intermediário `sending`, como previsto na auditoria.
- **`node --env-file-if-exists`** no lugar de `dotenv`: uma dependência a menos.
- **Sem `pino`** por enquanto: a CLI só escreve no terminal. Logs estruturados entram com o envio de e-mails, com mascaramento de endereços.
- **Mudança de status manual para `contacted`** continua permitida (contato feito fora da ferramenta). Na Etapa C, o envio bem-sucedido fará essa transição automaticamente.

## Limitações

- Datas e horários em UTC.
- Contatos não são apagados. Apagar dados de uma pessoa a pedido (LGPD/GDPR) entra na Etapa D, junto com a lista de supressão, para que a supressão sobreviva à exclusão.
- `company status ... do_not_contact` ainda não marca os contatos nem cria supressão; a checagem antes do envio (Etapa C) vai considerar o status da empresa e o contato.
- Sem interface para editar ou remover evidências; registre uma nova evidência contrária quando algo mudar.

## Como validar

```bash
npm run check
DATABASE_PATH=/tmp/teste.db npm run cli -- import companies exemplo.csv
DATABASE_PATH=/tmp/teste.db npm run cli -- company show <domínio>
```

## Próxima etapa

Etapa C: campanhas, templates versionados, rascunhos com marcação `evidence_based`/`generic`, aprovação com hash, lista de supressão, envio idempotente com adapter falso e, depois, SMTP. Antes do SMTP é preciso decidir domínio e caixa de e-mail.
