CONTROLE FINANCEIRO PESSOAL v4.5.0

INSTALAÇÃO
1. Faça um backup JSON da versão atual na aba Sistema.
2. Extraia este ZIP e substitua os arquivos na raiz do site, incluindo a pasta icons e o novo insights.js.
3. Publique no mesmo endereço HTTPS (ou localhost para testes). Recarregue a página; se o PWA ainda mostrar a versão anterior, feche e abra novamente e limpe apenas o cache do site se necessário.
4. O Code.gs está incluído para entrega completa e é idêntico ao anterior. Se o backend v4.3.0 já funciona, não precisa reimplantar Apps Script.

NOVIDADES
- Paleta de verde profundo, jade e dourado, com novo ícone.
- Orçamento diário indicativo com saldo informado hoje, entradas futuras e obrigações restantes do mês.
- Fechamento parcial: previsão e despesas marcadas pagas/gastos lançados.
- Cenários sem gravação: compra, redução de gastos e renda extra por 1 a 12 meses.
- Listagem das contas fixas como compromissos recorrentes e projeção anual.
- Meta local de reserva de emergência baseada na média das saídas projetadas de 3 meses.
- Compras planejadas locais com valor mensal necessário até o mês escolhido.
- Avisos de vencimentos atrasados, agenda dos próximos 30 dias e risco de saldo negativo nos próximos 30 dias.
- Comparação de entradas, saídas, faturas, contas, gastos e saldo com o mês anterior.

DADOS E LIMITES
As entidades cartoes, faturas, contas, gastos, receitas, dividas e comprovantes, a fila pendingOperations, os timestamps e as rotas da API continuam como antes. A planilha não ganhou abas nem colunas.
Saldo disponível de hoje, reserva e compras planejadas ficam somente no navegador deste aparelho; são incluídos no backup JSON, mas não sincronizam pela planilha. Exporte backup antes de limpar os dados do navegador. Cenários não são salvos.
A estimativa diária exige atualizar o saldo a cada dia. Receitas lançadas para hoje não são somadas ao saldo informado; compromissos pendentes vencidos neste mês são deduzidos. Os avisos dependem de datas e valores cadastrados; não consultam saldos bancários reais.
O fechamento é parcial: não há campo 'recebida' em receitas, nem baixa por mês para dívidas/contas recorrentes. Contas fixas essenciais aparecem na lista de assinaturas. A reserva usa saídas previstas, não uma medição completa de despesas reais.
OCR requer conexão para carregar Tesseract.js/PDF.js. Câmera e PWA exigem HTTPS ou localhost.

TESTE RÁPIDO
- Abra Planos e informe saldo disponível de hoje. Confira o valor por dia no Dashboard.
- Cadastre uma conta pendente vencida; confira o alerta e a dedução no valor livre.
- Simule compra e renda extra; confirme que não surgem lançamentos novos.
- Salve reserva e uma compra planejada; exporte/import backup e confirme a restauração.
- Abra Análise, confira fechamento, comparação, assinaturas e vencimentos.
- Teste edição/exclusão offline e depois reconecte para conferir sincronização.
