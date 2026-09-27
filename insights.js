'use strict';

// Preferências extras ficam separadas das entidades sincronizadas com a planilha.
const INSIGHTS_KEY = 'controleFinanceiroPWA.insights.v1';
function cleanInsights(input) {
  const safe = input && typeof input === 'object' ? input : {};
  const money = value => Math.max(0, Math.min(1e12, numberValue(value)));
  return {
    cash: safe.cash === null || safe.cash === undefined || safe.cash === '' ? null : money(safe.cash),
    cashUpdatedAt: /^\d{4}-\d{2}-\d{2}$/.test(safe.cashUpdatedAt || '') ? safe.cashUpdatedAt : '',
    reserveSaved: money(safe.reserveSaved),
    reserveMonths: Math.max(1, Math.min(36, Math.round(numberValue(safe.reserveMonths) || 6))),
    purchases: (Array.isArray(safe.purchases) ? safe.purchases : []).slice(0, 100).map(item => ({
      id: String(item?.id || uid()), name: String(item?.name || '').trim().slice(0, 80),
      price: money(item?.price), saved: money(item?.saved),
      month: /^\d{4}-(0[1-9]|1[0-2])$/.test(item?.month || '') ? item.month : currentMonth()
    })).filter(item => item.name && item.price > 0)
  };
}
let insights = cleanInsights(readStorage(INSIGHTS_KEY));
let scenarioPreview = null;
function saveInsights() { writeStorage(INSIGHTS_KEY, insights); renderInsights(); }
function getInsightsBackup() { return deepClone(insights); }
function importInsightsBackup(data) {
  const incoming = cleanInsights(data);
  const combined = new Map(insights.purchases.map(item => [item.id, item]));
  incoming.purchases.forEach(item => combined.set(item.id, item));
  insights = {...insights, ...incoming, purchases: [...combined.values()]};
  saveInsights();
}
function monthDifference(start, end) {
  const [sy, sm] = start.split('-').map(Number), [ey, em] = end.split('-').map(Number);
  return (ey - sy) * 12 + em - sm;
}
function dayInMonth(month, day) {
  const [year, number] = month.split('-').map(Number);
  return `${month}-${String(Math.min(new Date(year, number, 0).getDate(), Math.max(1, Number(day) || 1))).padStart(2, '0')}`;
}
function occurrenceDate(date, month, recurring) {
  if (!date) return '';
  if (!recurring) return sameMonth(date, month) ? String(date).slice(0, 10) : '';
  if (!recurringFrom(date, month)) return '';
  return dayInMonth(month, String(date).slice(8, 10));
}
function datedCashEvents(month) {
  const events = [];
  const add = (date, amount, label, kind, outstanding = false) => {
    const value = numberValue(amount);
    if (date && value > 0) events.push({date, amount: kind === 'in' ? value : -value, label, outstanding});
  };
  state.receitas.forEach(item => add(occurrenceDate(item.data, month, item.tipo === 'recorrente'), item.valor, item.descricao || 'Entrada', 'in'));
  state.contas.filter(item => normalizedStatus(item.status) !== 'cancelada' && normalizedStatus(item.status) !== 'paga').forEach(item =>
    add(occurrenceDate(item.data, month, item.tipo === 'fixa'), item.valor, item.descricao || 'Conta', 'out', true));
  state.gastos.forEach(item => add(occurrenceDate(item.data, month, false), item.valor, item.descricao || 'Gasto', 'out'));
  state.faturas.filter(item => item.mes === month && isInvoicePending(item)).forEach(item =>
    add(invoiceDueDate(item), item.valor, `Fatura ${cardName(item.cartaoId)}`, 'out', true));
  state.dividas.forEach(item => {
    const debt = getDebtStateInMonth(item, month);
    if (debt.paymentInMonth) add(dayInMonth(month, debt.day), debt.paymentInMonth, item.nome || 'Dívida', 'out');
  });
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
}
function dailyBudgetModel(date = today()) {
  if (insights.cash === null || insights.cashUpdatedAt !== date) return null;
  const month = date.slice(0, 7);
  const [year, number] = month.split('-').map(Number);
  const end = dayInMonth(month, 31);
  const days = Math.max(1, Math.round((new Date(`${end}T12:00:00`) - new Date(`${date}T12:00:00`)) / 86400000) + 1);
  const events = datedCashEvents(month).filter(item => (item.date >= date && (item.amount < 0 || item.date > date)) || (item.date < date && item.outstanding));
  const futureIncome = events.filter(item => item.amount > 0).reduce((sum, item) => sum + item.amount, 0);
  const due = -events.filter(item => item.amount < 0).reduce((sum, item) => sum + item.amount, 0);
  return {days, futureIncome, due, free: insights.cash + futureIncome - due, perDay: Math.max(0, (insights.cash + futureIncome - due) / days), events};
}
function riskModel(date = today()) {
  if (insights.cash === null || insights.cashUpdatedAt !== date) return null;
  const horizon = new Date(new Date(`${date}T12:00:00`).getTime() + 30*86400000).toISOString().slice(0,10);
  const events = nextMonths(2,date.slice(0,7)).flatMap(datedCashEvents)
    .filter(item => ((item.date >= date && (item.amount < 0 || item.date > date)) || (item.date < date && item.outstanding)) && item.date <= horizon)
    .sort((a,b)=>a.date.localeCompare(b.date) || a.amount-b.amount);
  let balance = insights.cash;
  for (const event of events) {
    balance += event.amount;
    if (balance < 0) return {date: event.date < date ? date : event.date, balance, label:event.label};
  }
  return null;
}
function renderDailyBudget() {
  const model = dailyBudgetModel();
  const host = qs('#dailyBudget'), detail = qs('#dailyBudgetDetail');
  if (!host) return;
  const message = model ? `<span class="eyebrow">LIMITE INDICATIVO POR DIA</span><strong>${brl(model.perDay)}</strong><small>${model.days} dia(s) até o fim do mês · saldo livre estimado ${brl(model.free)}</small>`
    : '<span class="eyebrow">PLANEJE COM SEGURANÇA</span><strong>Quanto posso gastar hoje?</strong><small>Informe o saldo disponível de hoje na aba Planos.</small>';
  host.innerHTML = `<div>${message}</div><button class="btn soft" type="button" data-open-plan>Ver cálculo</button>`;
  if (detail) detail.innerHTML = model ? `<div class="insight-stats"><div>Saldo informado hoje <b>${brl(insights.cash)}</b></div><div>Entradas futuras <b>${brl(model.futureIncome)}</b></div><div>Compromissos restantes <b>${brl(model.due)}</b></div><div>Valor livre ÷ ${model.days} dias <b>${brl(model.perDay)}/dia</b></div></div><p class="muted">Estimativa baseada nas datas cadastradas. Receitas de hoje não são somadas ao saldo informado; revise gastos futuros e contas já pagas.</p>`
    : '<p class="muted">Informe o saldo disponível agora. O cálculo inclui obrigações de hoje em diante e receitas a partir de amanhã. Atualize o saldo diariamente para manter a estimativa útil.</p>';
}
function renderRisks() {
  const risk = riskModel();
  const overdue = datedCashEvents(today().slice(0,7)).filter(item => item.outstanding && item.date < today());
  const host = qs('#riskAlerts');
  if (!host) return;
  host.innerHTML = (overdue.length ? `<div class="risk-item"><strong>${overdue.length} compromisso(s) vencido(s) neste mês</strong><span>${brl(-overdue.reduce((sum,item)=>sum+item.amount,0))} em lançamentos ainda pendentes. Confira se já foram pagos.</span></div>` : '') + (risk ? `<div class="risk-item"><strong>Possível falta de saldo em ${dateLabel(risk.date)}</strong><span>Após ${escapeHtml(risk.label)}: ${brl(risk.balance)}. Confira vencimentos e o saldo informado.</span></div>`
    : `<div class="risk-item ${dailyBudgetModel() ? 'safe' : ''}"><strong>${dailyBudgetModel() ? 'Sem falta de saldo identificada nos próximos 30 dias' : 'Alertas de saldo disponíveis'}</strong><span>${dailyBudgetModel() ? 'A análise usa apenas os lançamentos cadastrados.' : 'Informe o saldo de hoje em Planos para verificar vencimentos.'}</span></div>`);
}
function renderClosing() {
  const month = activeMonth, totals = monthTotals(month);
  const paidBills = state.contas.filter(item => normalizedStatus(item.status) === 'paga')
    .filter(item => item.tipo === 'fixa' ? recurringFrom(item.data, month) : sameMonth(item.data, month))
    .reduce((sum, item) => sum + numberValue(item.valor), 0);
  const paidInvoices = state.faturas.filter(item => item.mes === month && normalizedStatus(item.status) === 'paga')
    .reduce((sum, item) => sum + numberValue(item.valor), 0);
  const expenses = state.gastos.filter(item => sameMonth(item.data, month)).reduce((sum, item) => sum + numberValue(item.valor), 0);
  const recognized = paidBills + paidInvoices + expenses;
  qs('#monthClosing').innerHTML = `<div class="insight-stats"><div>Entradas previstas <b>${brl(totals.receitas)}</b></div><div>Saídas previstas <b>${brl(totals.saidas)}</b></div><div>Sobra prevista <b>${brl(totals.saldo)}</b></div><div>Saídas marcadas pagas + gastos lançados <b>${brl(recognized)}</b></div></div>
    <p class="muted">Fechamento parcial de ${escapeHtml(monthLabel(month))}. Receitas não têm status “recebida” e dívidas não têm baixa mensal; por isso não há saldo realizado confiável para comparar.</p>`;
}
function previousMonth(month) { const [year, number] = month.split('-').map(Number); return currentMonth(new Date(year, number - 2, 1)); }
function renderComparison() {
  const previous = previousMonth(activeMonth), current = monthTotals(activeMonth), before = monthTotals(previous);
  const rows = [['Entradas','receitas'],['Saídas','saidas'],['Faturas','faturas'],['Contas','contas'],['Gastos','gastos'],['Saldo','saldo']];
  qs('#monthComparison').innerHTML = `<p class="muted">${escapeHtml(monthLabel(activeMonth))} × ${escapeHtml(monthLabel(previous))}</p><div class="insight-stats">${rows.map(([label,key]) => {
    const delta = current[key]-before[key], percent = before[key] ? `${(delta/Math.abs(before[key])*100).toLocaleString('pt-BR',{maximumFractionDigits:1})}%` : '—';
    return `<div>${label}<b>${brl(current[key])}</b><small class="${delta > 0 ? (key === 'saidas' || key === 'gastos' ? 'text-bad' : 'text-ok') : ''}">${delta >= 0 ? '+' : ''}${brl(delta)} · ${percent}</small></div>`;
  }).join('')}</div>`;
}
function renderSubscriptions() {
  const items = state.contas.filter(item => item.tipo === 'fixa' && normalizedStatus(item.status) !== 'cancelada' && recurringFrom(item.data, activeMonth));
  const total = items.reduce((sum, item) => sum + numberValue(item.valor), 0);
  qs('#subscriptions').innerHTML = items.length ? `<p><strong>${brl(total)}/mês</strong> · ${brl(total*12)}/ano, se todos continuarem ativos.</p><div class="mini-list">${items.map(item => `<div class="mini-item"><b>${escapeHtml(item.descricao)}</b><span>${brl(item.valor)}/mês · ${brl(numberValue(item.valor)*12)}/ano</span></div>`).join('')}</div>` : '<div class="empty">Nenhuma conta fixa mensal ativa neste mês.</div>';
}
function renderUpcoming() {
  const start=today(), months=[start.slice(0,7),nextMonths(2,start.slice(0,7))[1]];
  const upcoming=months.flatMap(datedCashEvents).filter(item => item.amount < 0 && item.date >= start && item.date <= new Date(new Date(`${start}T12:00:00`).getTime()+30*86400000).toISOString().slice(0,10));
  qs('#upcomingDue').innerHTML = upcoming.length ? `<div class="mini-list">${upcoming.map(item => `<div class="mini-item"><b>${dateLabel(item.date)} · ${escapeHtml(item.label)}</b><span class="text-bad">${brl(-item.amount)}</span></div>`).join('')}</div>` : '<div class="empty">Nenhum vencimento registrado nos próximos 30 dias.</div>';
}
function renderReserve() {
  const average = nextMonths(3).reduce((sum, month) => { const totals=monthTotals(month); return sum+totals.contas+totals.gastos+totals.dividas+totals.faturas; },0)/3;
  const target=average*insights.reserveMonths, progress=target>0 ? Math.min(100,insights.reserveSaved/target*100) : 0;
  qs('#reserveProgress').innerHTML = `<p>Meta de ${insights.reserveMonths} meses: <strong>${brl(target)}</strong></p><div class="goal-track" role="progressbar" aria-label="Progresso da reserva" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.toFixed(1)}"><span style="width:${progress}%"></span></div><p class="muted">Guardado: ${brl(insights.reserveSaved)} · faltam ${brl(Math.max(0,target-insights.reserveSaved))}. Base: média das saídas projetadas nos próximos 3 meses; revise gastos que ainda não foram cadastrados.</p>`;
}
function renderPurchases() {
  qs('#purchases').innerHTML = insights.purchases.length ? `<div class="mini-list">${insights.purchases.map(item => {
    const months=Math.max(1,monthDifference(currentMonth(),item.month)+1), remaining=Math.max(0,item.price-item.saved);
    return `<div class="purchase-item"><div><strong>${escapeHtml(item.name)}</strong><span>${brl(item.price)} · alvo ${escapeHtml(monthLabel(item.month))}</span><small>Faltam ${brl(remaining)} · guardar ${brl(remaining/months)}/mês por ${months} mês(es)</small></div><button class="btn danger" type="button" data-remove-purchase="${escapeHtml(item.id)}" aria-label="Excluir plano ${escapeHtml(item.name)}">Excluir</button></div>`;
  }).join('')}</div>` : '<div class="empty">Nenhuma compra planejada.</div>';
}
function renderScenario() {
  const host=qs('#scenarioResult'); if (!scenarioPreview) {host.innerHTML='<p class="muted">A simulação não altera lançamentos ou saldo disponível.</p>';return;}
  const {kind,amount,duration}=scenarioPreview, months=nextMonths(duration), delta=months.map(month => {
    const baseline=monthTotals(month);
    return kind==='expense' ? -amount : kind==='income' ? amount : Math.min(amount,baseline.saidas);
  });
  const baseline=months.reduce((sum,month)=>sum+monthTotals(month).saldo,0), difference=delta.reduce((sum,value)=>sum+value,0);
  host.innerHTML=`<div class="insight-stats"><div>Saldo previsto no período <b>${brl(baseline)}</b></div><div>Impacto da hipótese <b class="${difference>=0?'text-ok':'text-bad'}">${difference>=0?'+':''}${brl(difference)}</b></div><div>Novo saldo hipotético <b>${brl(baseline+difference)}</b></div></div><p class="muted">${duration} mês(es), começando em ${escapeHtml(monthLabel(months[0]))}. A redução de gasto é limitada às saídas previstas em cada mês.</p>`;
}
function renderInsights() {
  if (!qs('#dailyBudget')) return;
  renderDailyBudget(); renderRisks(); renderClosing(); renderComparison();
  renderSubscriptions(); renderUpcoming(); renderReserve(); renderPurchases(); renderScenario();
  const cash=qs('#cashTodayForm');
  if (cash && document.activeElement !== cash.elements.cash) cash.elements.cash.value=insights.cash === null ? '' : insights.cash;
  const reserve=qs('#reserveForm');
  if (reserve && !reserve.contains(document.activeElement)) {reserve.elements.saved.value=insights.reserveSaved;reserve.elements.months.value=insights.reserveMonths;}
  const purchaseMonth=qs('#purchaseForm')?.elements.month;
  if (purchaseMonth && !purchaseMonth.value) purchaseMonth.value=currentMonth();
}
function bindInsights() {
  qs('#cashTodayForm')?.addEventListener('submit',event=>{
    event.preventDefault();const value=Number(event.currentTarget.elements.cash.value);
    if (!Number.isFinite(value)||value<0) return;
    insights.cash=value;insights.cashUpdatedAt=today();saveInsights();toast('Saldo de hoje salvo neste aparelho.','ok');
  });
  qs('#reserveForm')?.addEventListener('submit',event=>{
    event.preventDefault();const form=event.currentTarget;
    insights.reserveSaved=Math.max(0,numberValue(form.elements.saved.value));
    insights.reserveMonths=Math.max(1,Math.min(36,Math.round(Number(form.elements.months.value)||6)));
    saveInsights();toast('Meta da reserva salva neste aparelho.','ok');
  });
  qs('#purchaseForm')?.addEventListener('submit',event=>{
    event.preventDefault();const form=event.currentTarget, data=new FormData(form), month=String(data.get('month'));
    if (month<currentMonth()) {toast('Escolha o mês atual ou um mês futuro.','warn');return;}
    insights.purchases.push({id:uid(),name:String(data.get('name')).trim().slice(0,80),price:numberValue(data.get('price')),saved:numberValue(data.get('saved')),month});
    saveInsights();form.reset();form.elements.month.value=currentMonth();toast('Compra planejada salva neste aparelho.','ok');
  });
  qs('#scenarioForm')?.addEventListener('submit',event=>{
    event.preventDefault();const data=new FormData(event.currentTarget);
    scenarioPreview={kind:data.get('kind'),amount:numberValue(data.get('amount')),duration:Math.min(12,Math.max(1,Number(data.get('duration'))||1))};
    renderScenario();
  });
  document.addEventListener('click',async event=>{
    if (event.target.closest('[data-open-plan]')) openTab('planejamento');
    const remove=event.target.closest('[data-remove-purchase]');
    if (remove && await askConfirmation('Excluir esta compra planejada deste aparelho?','Excluir plano')) {
      insights.purchases=insights.purchases.filter(item=>item.id!==remove.dataset.removePurchase);
      saveInsights();
    }
  });
}
document.addEventListener('DOMContentLoaded',bindInsights);
