# Templates

Pontos de partida em português, para ajustar antes de aprovar. Uso:

```bash
npm run cli -- campaign template <campanha> --step 0 --subject "Reforço de desenvolvimento para a {{company.name}}" --file templates/first.txt
npm run cli -- campaign template <campanha> --step 1 --subject "Re: reforço de desenvolvimento para a {{company.name}}" --file templates/follow-up.txt
npm run cli -- campaign template <campanha> --step 2 --subject "Re: reforço de desenvolvimento para a {{company.name}}" --file templates/follow-up-2.txt
npm run cli -- campaign template <campanha> --step 3 --subject "Re: reforço de desenvolvimento para a {{company.name}}" --file templates/follow-up-3.txt
```

Os follow-ups são opcionais e independentes: a campanha só envia as etapas que tiverem template aprovado. Quantos existem e quando vencem (3, 5 e 7 dias úteis depois do primeiro e-mail) fica em `config/sending.json`.

- A linha `{{reason}}` só aparece quando o rascunho é personalizado com um fato verificado (`message draft ... --reason --evidence`).
- A linha `{{stack}}` some quando a empresa não tem tecnologias compatíveis cadastradas.
- O rodapé com seu nome, endereço postal e opção de descadastro vem de `config/sending.json`.
- Nunca afirme vaga, projeto ou necessidade que não foi confirmado.

## Consultorias de TI e outsourcing

A pasta `consultoria/` tem a mesma sequência (inicial e 3 follow-ups) com o argumento para quem já vende projetos e alocação de desenvolvedores: você entra como reforço quando a demanda passa da capacidade do time. Use uma campanha por tipo de empresa:

```bash
npm run cli -- campaign create br-consultorias --market BR --segment "consultoria de TI"
npm run cli -- campaign template br-consultorias --step 0 --subject "Desenvolvedor full-stack PJ para projetos da {{company.name}}" --file templates/consultoria/first.txt
npm run cli -- campaign template br-consultorias --step 1 --subject "Re: desenvolvedor full-stack PJ para projetos da {{company.name}}" --file templates/consultoria/follow-up.txt
npm run cli -- campaign template br-consultorias --step 2 --subject "Re: desenvolvedor full-stack PJ para projetos da {{company.name}}" --file templates/consultoria/follow-up-2.txt
npm run cli -- campaign template br-consultorias --step 3 --subject "Re: desenvolvedor full-stack PJ para projetos da {{company.name}}" --file templates/consultoria/follow-up-3.txt
```

Os follow-ups saem como resposta na mesma conversa (cabeçalhos `In-Reply-To` e `References`), por isso o assunto começa com "Re:". Cada follow-up muda o ângulo e o último avisa que é o último, para não haver dois "últimos contatos".

Com o segmento exatamente `software house` ou `consultoria de TI`, `campaign select` só põe na campanha as empresas desse tipo (a IA grava o tipo ao qualificar). Para software houses, crie a campanha com `--segment "software house"` e os arquivos de `templates/` (`first.txt`, `follow-up.txt`, `follow-up-2.txt`, `follow-up-3.txt`). Empresa sem tipo (cadastrada à mão) fica fora dessas campanhas; ajuste o tipo na tela da empresa ou use `campaign add-target`.
