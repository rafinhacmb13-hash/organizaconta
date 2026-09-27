'use strict';

const APP_VERSION = '4.5.0';
const PAYOFF_STRATEGY_KEY = 'controleFinanceiroPWA.payoffStrategy';
const STORAGE_KEY = 'controleFinanceiroPWA.v4';
const PENDING_KEY = 'controleFinanceiroPWA.pending.v1';
const MONTH_KEY = 'controleFinanceiroPWA.activeMonth';
const PAYOFF_BUDGET_KEY = 'controleFinanceiroPWA.payoffBudget';
const PAYOFF_START_KEY = 'controleFinanceiroPWA.payoffStartMonth';
const DEPLOYMENT_ID = 'AKfycbzb1XlFawL49EtVr0tUVzp2LFmUWAb9kzCcycNHs2ZdPLcEwHjH1GUmnVkQcmypZ40VkQ';
const DEFAULT_API_URL = `https://script.google.com/macros/s/${DEPLOYMENT_ID}/exec`;
const APPS_SCRIPT_LIBRARY_URL = 'https://script.google.com/macros/library/d/1dQeyxkJpfweeRvqKwl1StjLr5xb4hDKlIYbCVk259AXhMGQfvypZtM3W/2';
const LEGACY_STORAGE_KEYS = ['controleFinanceiroPWA.v3', 'controleFinanceiroPWA.v2', 'controleFinanceiroPWA.v1'];

const ENTITIES = ['cartoes', 'faturas', 'contas', 'gastos', 'receitas', 'dividas', 'comprovantes'];
const ENTITY_TO_TAB = Object.fromEntries(ENTITIES.map(entity => [entity, entity]));
const NUMERIC_FIELDS = ['valor', 'limite', 'fechamento', 'vencimento', 'valorTotal', 'valorPago', 'pagamentoMensal'];

const defaultState = () => ({
  config: { apiUrl: DEFAULT_API_URL, deploymentId: DEPLOYMENT_ID, libraryUrl: APPS_SCRIPT_LIBRARY_URL, appVersion: APP_VERSION },
  cartoes: [],
  faturas: [],
  contas: [],
  gastos: [],
  receitas: [],
  dividas: [],
  comprovantes: []
});

const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const deepClone = value => JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();
const today = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};
const uid = () => `id_${Date.now().toString(36)}_${cryptoRandom()}`;
const opUid = () => `op_${Date.now().toString(36)}_${cryptoRandom()}`;

function cryptoRandom() {
  try {
    const bytes = new Uint32Array(2);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, n => n.toString(36)).join('').slice(0, 14);
  } catch (_) {
    return Math.random().toString(36).slice(2, 14);
  }
}

function currentMonth(date = new Date()) {
  const parsed = typeof date === 'string' ? new Date(`${String(date).slice(0, 10)}T12:00:00`) : date;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
}

function brl(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let text = String(value ?? '').replace(/[^\d,.-]/g, '').trim();
  if (!text) return 0;
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (comma >= 0) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if ((text.match(/\./g) || []).length > 1) {
    text = text.replace(/\./g, '');
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeJsonParse(value, fallback = null) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function readStorage(key) {
  try { return safeJsonParse(localStorage.getItem(key) || '', null); } catch (_) { return null; }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    toast('O armazenamento do navegador está cheio. Exporte um backup e remova dados antigos do navegador.', 'err');
    console.error(error);
    return false;
  }
}

function normalizeRecord(record, seenIds) {
  const clean = record && typeof record === 'object' ? { ...record } : {};
  let id = String(clean.id || '').trim();
  if (!id || seenIds.has(id)) id = uid();
  seenIds.add(id);
  clean.id = id;
  clean.createdAt = clean.createdAt || clean.updatedAt || nowIso();
  clean.updatedAt = clean.updatedAt || clean.createdAt;
  NUMERIC_FIELDS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(clean, key)) clean[key] = numberValue(clean[key]);
  });
  return clean;
}

function normalizeState(raw) {
  const base = defaultState();
  const safe = raw && typeof raw === 'object' ? raw : {};
  const result = { ...base, ...safe, config: { ...base.config, ...(safe.config || {}) } };
  // O backend desta versão é fixo para impedir que uma URL antiga salva no navegador bloqueie a sincronização.
  result.config.apiUrl = DEFAULT_API_URL;
  result.config.deploymentId = DEPLOYMENT_ID;
  result.config.libraryUrl = APPS_SCRIPT_LIBRARY_URL;
  result.config.appVersion = APP_VERSION;
  ENTITIES.forEach(entity => {
    const seenIds = new Set();
    result[entity] = (Array.isArray(safe[entity]) ? safe[entity] : []).map(item => normalizeRecord(item, seenIds));
  });
  return result;
}

function loadLocal() {
  const current = readStorage(STORAGE_KEY);
  if (current) return normalizeState(current);
  for (const key of LEGACY_STORAGE_KEYS) {
    const legacy = readStorage(key);
    if (legacy) {
      const migrated = normalizeState(legacy);
      writeStorage(STORAGE_KEY, migrated);
      return migrated;
    }
  }
  return defaultState();
}

let state = loadLocal();
let activeMonth = localStorage.getItem(MONTH_KEY) || currentMonth();
let pendingOperations = Array.isArray(readStorage(PENDING_KEY)) ? readStorage(PENDING_KEY) : [];
let cameraStream = null;
let selectedReceiptFile = null;
let installPrompt = null;
let syncPromise = Promise.resolve();
let isFlushing = false;
let invoiceFilterMonth = '';
let payoffMonthlyBudget = numberValue(localStorage.getItem(PAYOFF_BUDGET_KEY) || 0);
let payoffStartMonth = localStorage.getItem(PAYOFF_START_KEY) || currentMonth();
let payoffStrategy = ['padrao', 'neve', 'avalanche'].includes(localStorage.getItem(PAYOFF_STRATEGY_KEY)) ? localStorage.getItem(PAYOFF_STRATEGY_KEY) : 'padrao';
let receiptPreviewUrl = null;

function saveLocal() {
  state.config.apiUrl = DEFAULT_API_URL;
  state.config.deploymentId = DEPLOYMENT_ID;
  state.config.libraryUrl = APPS_SCRIPT_LIBRARY_URL;
  state.config.appVersion = APP_VERSION;
  writeStorage(STORAGE_KEY, state);
}

function savePending() {
  writeStorage(PENDING_KEY, pendingOperations);
}

function toast(message, type = '') {
  const host = qs('#toast');
  if (!host) return;
  const box = document.createElement('div');
  box.className = `toast-msg ${type}`;
  box.textContent = message;
  host.appendChild(box);
  setTimeout(() => box.remove(), 4500);
}

// Diálogo assíncrono: foco, Escape e cancelamento seguro em qualquer fluxo.
function askConfirmation(message, title = 'Confirmar ação') {
  return new Promise(resolve => {
    const previous = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `<div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialogTitle" aria-describedby="dialogMessage">
      <h2 id="dialogTitle"></h2><p id="dialogMessage"></p>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dialog="cancel">Cancelar</button><button type="button" class="btn primary" data-dialog="confirm">Confirmar</button></div></div>`;
    overlay.querySelector('#dialogTitle').textContent = title;
    overlay.querySelector('#dialogMessage').textContent = message;
    document.body.appendChild(overlay);
    const buttons = [...overlay.querySelectorAll('button')];
    const finish = value => { document.removeEventListener('keydown', keydown); overlay.remove(); previous?.focus?.(); resolve(value); };
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      if (event.key === 'Tab') {
        const index = buttons.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); buttons.at(-1).focus(); }
        else if (!event.shiftKey && index === buttons.length - 1) { event.preventDefault(); buttons[0].focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    overlay.addEventListener('click', event => {
      const action = event.target.closest('[data-dialog]')?.dataset.dialog;
      if (action) finish(action === 'confirm');
      else if (event.target === overlay) finish(false);
    });
    buttons[0].focus();
  });
}

function setSyncStatus(text, type = '') {
  const element = qs('#syncStatus');
  if (!element) return;
  element.textContent = text;
  element.className = `sync-pill ${type}`;
}

async function api(action, payload = {}) {
  const url = String(state.config.apiUrl || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(url)) {
    throw new Error('A URL do Apps Script é inválida.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload }),
      signal: controller.signal,
      redirect: 'follow'
    });
    const text = await response.text();
    const data = safeJsonParse(text, null);
    if (!data) throw new Error('O Apps Script retornou uma resposta inválida.');
    if (!response.ok || !data.ok) throw new Error(data.error || `Erro HTTP ${response.status}`);
    return data.data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('A conexão demorou demais e foi interrompida.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function operationKey(operation) {
  return `${operation.entity}:${operation.id}`;
}

function enqueueSave(entity, record) {
  const key = `${entity}:${record.id}`;
  pendingOperations = pendingOperations.filter(operation => operationKey(operation) !== key);
  pendingOperations.push({ opId: opUid(), type: 'save', entity, id: record.id, record: deepClone(record), createdAt: nowIso() });
  savePending();
}

function enqueueDelete(entity, id) {
  const key = `${entity}:${id}`;
  pendingOperations = pendingOperations.filter(operation => operationKey(operation) !== key);
  pendingOperations.push({ opId: opUid(), type: 'delete', entity, id, createdAt: nowIso() });
  savePending();
}

async function executeOperation(operation) {
  if (operation.type === 'delete') {
    return api('deleteRecord', { entity: operation.entity, id: operation.id });
  }
  return api('saveRecord', { entity: operation.entity, record: operation.record });
}

function flushPending(options = {}) {
  const { silent = false } = options;
  syncPromise = syncPromise.catch(() => null).then(async () => {
    if (isFlushing) return false;
    if (!navigator.onLine) {
      setSyncStatus(`${pendingOperations.length} pendente(s)`, 'warn');
      return false;
    }
    if (!pendingOperations.length) {
      setSyncStatus('Sincronizado', 'ok');
      return true;
    }
    isFlushing = true;
    setSyncStatus(`Sincronizando ${pendingOperations.length}...`);
    try {
      while (pendingOperations.length) {
        const operation = pendingOperations[0];
        await executeOperation(operation);
        if (pendingOperations[0]?.opId === operation.opId) pendingOperations.shift();
        else pendingOperations = pendingOperations.filter(item => item.opId !== operation.opId);
        savePending();
      }
      setSyncStatus('Sincronizado', 'ok');
      if (!silent) toast('Dados sincronizados com o Google Sheets.', 'ok');
      return true;
    } catch (error) {
      setSyncStatus(`${pendingOperations.length} pendente(s)`, 'err');
      if (!silent) toast(`Os dados ficaram salvos neste aparelho. Erro na nuvem: ${error.message}`, 'err');
      return false;
    } finally {
      isFlushing = false;
    }
  });
  return syncPromise;
}

function commitRecord(entity, record, message = 'Salvo com sucesso') {
  saveLocal();
  enqueueSave(entity, record);
  renderAll();
  toast(`${message}.`, 'ok');
  flushPending({ silent: true });
}

function commitRecords(records, message = 'Salvo com sucesso') {
  saveLocal();
  records.forEach(({ entity, record }) => enqueueSave(entity, record));
  renderAll();
  toast(`${message}.`, 'ok');
  flushPending({ silent: true });
}

function mergeEntity(localRows, remoteRows) {
  const merged = new Map();
  const put = (row, source) => {
    if (!row || !row.id) return;
    const current = merged.get(row.id);
    if (!current) {
      merged.set(row.id, deepClone(row));
      return;
    }
    const currentTime = Date.parse(current.updatedAt || current.createdAt || 0) || 0;
    const incomingTime = Date.parse(row.updatedAt || row.createdAt || 0) || 0;
    if (incomingTime > currentTime || (incomingTime === currentTime && source === 'local')) merged.set(row.id, deepClone(row));
  };
  remoteRows.forEach(row => put(row, 'remote'));
  localRows.forEach(row => put(row, 'local'));
  return Array.from(merged.values());
}

async function loadFromServer(options = {}) {
  const { notify = false } = options;
  try {
    setSyncStatus('Carregando...');
    await flushPending({ silent: true });
    const remote = normalizeState(await api('loadAll', {}));
    const apiUrl = DEFAULT_API_URL;
    const merged = defaultState();
    merged.config = { ...remote.config, ...state.config, apiUrl };
    ENTITIES.forEach(entity => { merged[entity] = mergeEntity(state[entity], remote[entity]); });
    state = normalizeState(merged);
    saveLocal();
    renderAll();
    setSyncStatus(pendingOperations.length ? `${pendingOperations.length} pendente(s)` : 'Sincronizado', pendingOperations.length ? 'warn' : 'ok');
    if (notify) toast('Dados atualizados sem apagar os registros locais.', 'ok');
    return true;
  } catch (error) {
    setSyncStatus(pendingOperations.length ? `${pendingOperations.length} pendente(s)` : 'Modo local', 'err');
    if (notify) toast(`Não foi possível carregar a nuvem: ${error.message}`, 'err');
    return false;
  }
}

function formDataObject(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  NUMERIC_FIELDS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(data, key)) data[key] = numberValue(data[key]);
  });
  return data;
}

function upsert(entity, data) {
  const timestamp = nowIso();
  const clean = { ...data, updatedAt: timestamp };
  const index = clean.id ? state[entity].findIndex(item => item.id === clean.id) : -1;
  if (index >= 0) {
    state[entity][index] = { ...state[entity][index], ...clean };
    return state[entity][index];
  }
  const created = { ...clean, id: uid(), createdAt: timestamp };
  state[entity].push(created);
  return created;
}

function removeItem(entity, id) {
  state[entity] = state[entity].filter(item => item.id !== id);
  saveLocal();
  enqueueDelete(entity, id);
  renderAll();
  toast('Registro excluído.', 'ok');
  flushPending({ silent: true });
}

function fillForm(form, data) {
  Object.entries(data).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value ?? '';
  });
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetFormDefaults(form) {
  if (!form) return;
  const hiddenId = form.elements.id;
  if (hiddenId) hiddenId.value = '';
  if (form.id === 'faturaForm' && form.elements.mes) form.elements.mes.value = activeMonth;
  if (['contaForm', 'gastoForm', 'receitaForm'].includes(form.id) && form.elements.data) form.elements.data.value = today();
  if (form.id === 'dividaForm' && form.elements.dataInicial) form.elements.dataInicial.value = today();
  if (form.id === 'receiptForm' && form.elements.data) form.elements.data.value = today();
}

function setActiveMonth(month) {
  activeMonth = /^\d{4}-\d{2}$/.test(month || '') ? month : currentMonth();
  localStorage.setItem(MONTH_KEY, activeMonth);
  ['#dashMonthFilter', '#monthFilter'].forEach(selector => {
    const input = qs(selector);
    if (input && input.value !== activeMonth) input.value = activeMonth;
  });
  const invoiceMonth = qs('#faturasMonthFilter');
  if (invoiceMonth && !invoiceMonth.value && invoiceFilterMonth) invoiceMonth.value = invoiceFilterMonth;
}

function findCard(id) {
  return state.cartoes.find(card => card.id === id);
}

function cardName(id) {
  const card = findCard(id);
  return card ? `${card.nome}${card.banco ? ` - ${card.banco}` : ''}` : 'Cartão removido';
}

function monthLabel(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return '-';
  const [year, number] = month.split('-').map(Number);
  const label = new Date(year, number - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function sameMonth(date, month) {
  return Boolean(date && String(date).slice(0, 7) === month);
}

function recurringFrom(date, month) {
  return Boolean(date && String(date).slice(0, 7) <= month);
}

function statusTag(status) {
  const value = String(status || '-').toLowerCase();
  const className = value.includes('paga') || value.includes('quitada') ? 'ok' : value.includes('cancel') ? 'bad' : 'warn';
  return `<span class="tag ${className}">${escapeHtml(status || '-')}</span>`;
}

function invoiceDueDate(invoice) {
  if (!invoice?.mes || !/^\d{4}-\d{2}$/.test(invoice.mes)) return '';
  const card = findCard(invoice.cartaoId);
  const [year, month] = invoice.mes.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(lastDay, Math.max(1, parseInt(card?.vencimento || 10, 10)));
  return `${invoice.mes}-${String(day).padStart(2, '0')}`;
}

function dateLabel(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '-';
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

function invoiceStatusTag(invoice) {
  const status = normalizedStatus(invoice.status);
  const dueDate = invoiceDueDate(invoice);
  if (status === 'pendente' && dueDate && dueDate < today()) {
    return `<span class="tag bad">atrasada</span>`;
  }
  return statusTag(invoice.status);
}

function getDebtStateInMonth(debt, targetMonth) {
  const startDate = debt.dataInicial || String(debt.createdAt || today()).slice(0, 10);
  const startMonth = startDate.slice(0, 7);
  const initialRemaining = Math.max(0, numberValue(debt.valorTotal) - numberValue(debt.valorPago));
  const monthly = Math.max(0, numberValue(debt.pagamentoMensal));
  const day = Math.min(31, Math.max(1, parseInt(startDate.split('-')[2] || '5', 10)));

  if (targetMonth < startMonth) return { remainingBefore: initialRemaining, paymentInMonth: 0, day };
  if (!initialRemaining || String(debt.status).toLowerCase() === 'quitada') return { remainingBefore: 0, paymentInMonth: 0, day };

  const [startYear, startNumber] = startMonth.split('-').map(Number);
  const [targetYear, targetNumber] = targetMonth.split('-').map(Number);
  const elapsed = (targetYear - startYear) * 12 + (targetNumber - startNumber);
  const remainingBefore = Math.max(0, initialRemaining - elapsed * monthly);
  return { remainingBefore, paymentInMonth: monthly > 0 ? Math.min(remainingBefore, monthly) : 0, day };
}

function monthTotals(month) {
  const receitas = state.receitas
    .filter(item => item.tipo === 'recorrente' ? recurringFrom(item.data, month) : sameMonth(item.data, month))
    .reduce((sum, item) => sum + numberValue(item.valor), 0);
  const faturas = state.faturas
    .filter(item => item.mes === month && String(item.status).toLowerCase() !== 'cancelada')
    .reduce((sum, item) => sum + numberValue(item.valor), 0);
  const contas = state.contas
    .filter(item => String(item.status).toLowerCase() !== 'cancelada')
    .filter(item => item.tipo === 'fixa' ? recurringFrom(item.data, month) : sameMonth(item.data, month))
    .reduce((sum, item) => sum + numberValue(item.valor), 0);
  const gastos = state.gastos.filter(item => sameMonth(item.data, month)).reduce((sum, item) => sum + numberValue(item.valor), 0);
  let dividas = 0;
  let dividaEmAberto = 0;
  state.dividas.forEach(item => {
    const debt = getDebtStateInMonth(item, month);
    dividas += debt.paymentInMonth;
    dividaEmAberto += debt.remainingBefore;
  });
  const saidas = faturas + contas + gastos + dividas;
  return { receitas, faturas, contas, gastos, dividas, saidas, saldo: receitas - saidas, dividaEmAberto };
}

function normalizedStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isInvoicePending(invoice) {
  const status = normalizedStatus(invoice.status);
  return status !== 'paga' && status !== 'cancelada';
}

function getInvoiceSummary(referenceMonth = currentMonth()) {
  const pending = state.faturas.filter(isInvoicePending);
  const paid = state.faturas.filter(item => normalizedStatus(item.status) === 'paga');
  const cancelled = state.faturas.filter(item => normalizedStatus(item.status) === 'cancelada');
  const selectedMonthPending = pending.filter(item => item.mes === referenceMonth);
  const previousMonthsPending = pending.filter(item => /^\d{4}-\d{2}$/.test(item.mes || '') && item.mes < currentMonth());
  const futurePending = pending.filter(item => /^\d{4}-\d{2}$/.test(item.mes || '') && item.mes > currentMonth());
  const sum = items => items.reduce((total, item) => total + numberValue(item.valor), 0);
  const byCardMap = new Map();

  pending.forEach(invoice => {
    const key = invoice.cartaoId || 'sem-cartao';
    const current = byCardMap.get(key) || {
      cartaoId: key,
      nome: cardName(invoice.cartaoId),
      total: 0,
      quantidade: 0,
      mesesAnteriores: 0,
      mesMaisAntigo: '',
      mesMaisNovo: ''
    };
    current.total += numberValue(invoice.valor);
    current.quantidade += 1;
    if (invoice.mes && invoice.mes < currentMonth()) current.mesesAnteriores += numberValue(invoice.valor);
    if (invoice.mes && (!current.mesMaisAntigo || invoice.mes < current.mesMaisAntigo)) current.mesMaisAntigo = invoice.mes;
    if (invoice.mes && (!current.mesMaisNovo || invoice.mes > current.mesMaisNovo)) current.mesMaisNovo = invoice.mes;
    byCardMap.set(key, current);
  });

  return {
    pending,
    paid,
    cancelled,
    pendingTotal: sum(pending),
    selectedMonthPendingTotal: sum(selectedMonthPending),
    previousMonthsPendingTotal: sum(previousMonthsPending),
    futurePendingTotal: sum(futurePending),
    paidTotal: sum(paid),
    pendingCount: pending.length,
    selectedMonthPendingCount: selectedMonthPending.length,
    previousMonthsPendingCount: previousMonthsPending.length,
    byCard: [...byCardMap.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'))
  };
}

function getRegisteredDebtTotal(referenceMonth = currentMonth()) {
  return state.dividas.reduce((total, debt) => total + getDebtStateInMonth(debt, referenceMonth).remainingBefore, 0);
}

function getBaseCashCapacity(month) {
  const totals = monthTotals(month);
  return {
    month,
    receitas: totals.receitas,
    despesasBasicas: totals.contas + totals.gastos,
    capacidade: Math.max(0, totals.receitas - totals.contas - totals.gastos)
  };
}

function getDebtPayoffPlan(maxMonths = 60, startMonth = currentMonth(), monthlyBudget = 0) {
  const safeStartMonth = /^\d{4}-\d{2}$/.test(startMonth || '') ? startMonth : currentMonth();
  const manualBudget = Math.max(0, numberValue(monthlyBudget));
  const invoices = getInvoiceSummary(safeStartMonth);
  const registeredDebt = getRegisteredDebtTotal(safeStartMonth);
  const totalOutstanding = invoices.pendingTotal + registeredDebt;
  let remaining = totalOutstanding;
  const rows = nextMonths(maxMonths, safeStartMonth).map(month => {
    const capacity = getBaseCashCapacity(month);
    const availableForPayment = manualBudget > 0 ? manualBudget : capacity.capacidade;
    const suggestedPayment = Math.min(remaining, availableForPayment);
    remaining = Math.max(0, remaining - suggestedPayment);
    return { ...capacity, availableForPayment, suggestedPayment, remaining };
  });
  const payoffIndex = totalOutstanding > 0 ? rows.findIndex(row => row.remaining <= 0) : -1;
  const firstYearCapacity = rows.slice(0, 12).reduce((sum, row) => sum + row.capacidade, 0);
  const averageMonthlyCapacity = rows.length ? firstYearCapacity / Math.min(12, rows.length) : 0;
  return {
    invoices,
    registeredDebt,
    totalOutstanding,
    rows,
    startMonth: safeStartMonth,
    manualBudget,
    mode: manualBudget > 0 ? 'manual' : 'automatico',
    payoffMonth: payoffIndex >= 0 ? rows[payoffIndex].month : '',
    payoffMonths: payoffIndex >= 0 ? payoffIndex + 1 : 0,
    averageMonthlyCapacity,
    remainingAfterHorizon: remaining
  };
}

function nextMonths(count = 12, startMonth = currentMonth()) {
  const [year, month] = startMonth.split('-').map(Number);
  return Array.from({ length: count }, (_, index) => currentMonth(new Date(year, month - 1 + index, 1)));
}

function projectionRows(count = 12) {
  let accumulated = 0;
  return nextMonths(count).map(month => {
    const totals = monthTotals(month);
    accumulated += totals.saldo;
    return { month, ...totals, acumulado: accumulated };
  });
}

function getPeriodFlow(month) {
  const periods = [
    { label: 'Dia 01 ao 19', entradas: 0, saidas: 0 },
    { label: 'Dia 20 ao fim do mês', entradas: 0, saidas: 0 }
  ];
  const dayOf = value => Math.min(31, Math.max(1, parseInt(String(value || '').split('-')[2] || '1', 10)));
  const add = (day, amount, type) => { periods[day <= 19 ? 0 : 1][type] += numberValue(amount); };

  state.receitas.forEach(item => {
    if (item.tipo === 'recorrente' ? recurringFrom(item.data, month) : sameMonth(item.data, month)) add(dayOf(item.data), item.valor, 'entradas');
  });
  state.contas.filter(item => String(item.status).toLowerCase() !== 'cancelada').forEach(item => {
    if (item.tipo === 'fixa' ? recurringFrom(item.data, month) : sameMonth(item.data, month)) add(dayOf(item.data), item.valor, 'saidas');
  });
  state.gastos.filter(item => sameMonth(item.data, month)).forEach(item => add(dayOf(item.data), item.valor, 'saidas'));
  state.faturas.filter(item => item.mes === month && String(item.status).toLowerCase() !== 'cancelada').forEach(item => {
    const card = findCard(item.cartaoId);
    add(Number(card?.vencimento || 10), item.valor, 'saidas');
  });
  state.dividas.forEach(item => {
    const debt = getDebtStateInMonth(item, month);
    if (debt.paymentInMonth > 0) add(debt.day, debt.paymentInMonth, 'saidas');
  });
  periods.forEach(period => { period.saldo = period.entradas - period.saidas; });
  return periods;
}

function renderDashboard() {
  const totals = monthTotals(activeMonth);
  const invoiceSummary = getInvoiceSummary(activeMonth);
  const payoffPlan = getDebtPayoffPlan(60, payoffStartMonth, payoffMonthlyBudget);
  const totalDue = invoiceSummary.pendingTotal + payoffPlan.registeredDebt;
  const label = qs('#dashMonthLabel');
  if (label) label.textContent = monthLabel(activeMonth);
  const rows = projectionRows(12);
  const best = rows.reduce((winner, item) => item.saldo > winner.saldo ? item : winner, rows[0] || { month: activeMonth, saldo: 0 });
  const cards = [
    ['Faturas do mês', totals.faturas],
    ['Faturas pendentes', invoiceSummary.pendingTotal],
    ['Dívidas cadastradas', payoffPlan.registeredDebt],
    ['Total geral devido', totalDue],
    ['Contas básicas', totals.contas],
    ['Gastos avulsos', totals.gastos],
    ['Entradas totais', totals.receitas],
    ['Sobra prevista no mês', totals.saldo],
    ['Melhor mês adiante', `${monthLabel(best.month)} • ${brl(best.saldo)}`]
  ];
  qs('#dashboardCards').innerHTML = cards.map(([labelText, value]) => `
    <article class="card metric ${typeof value === 'number' && value < 0 ? 'negative' : 'positive'}">
      <span>${escapeHtml(labelText)}</span><strong>${typeof value === 'number' ? brl(value) : escapeHtml(value)}</strong>
    </article>`).join('');

  const percentage = totals.receitas > 0 ? totals.saldo / totals.receitas * 100 : 0;
  const progress = Math.max(0, Math.min(100, percentage));
  qs('#savingsGoal').innerHTML = `<div class="goal-heading"><div><span class="eyebrow">SAÚDE FINANCEIRA</span><h3>Meta de economia do mês</h3></div><strong class="${percentage >= 20 ? 'text-ok' : percentage < 0 ? 'text-bad' : ''}">${percentage.toLocaleString('pt-BR', {maximumFractionDigits: 1})}%</strong></div>
    <div class="goal-track" role="progressbar" aria-label="Sobra sobre receitas" aria-valuenow="${progress.toFixed(1)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${progress}%"></span></div>
    <p class="muted">${totals.receitas <= 0 ? 'Cadastre receitas para calcular a meta.' : percentage > 20 ? 'Meta de Saúde Financeira Atingida · sobra de ' + brl(totals.saldo) : 'Sobra prevista: ' + brl(totals.saldo) + ' · referência: mais de 20% das receitas.'}</p>`;

  qs('#dashboardPeriods').innerHTML = getPeriodFlow(activeMonth).map(period => `
    <article class="period-card">
      <h4>${escapeHtml(period.label)}</h4>
      <div><span class="text-ok">Entradas</span><strong>${brl(period.entradas)}</strong></div>
      <div><span class="text-bad">Saídas</span><strong>${brl(period.saidas)}</strong></div>
      <div class="period-result"><span>Resultado</span><strong class="${period.saldo >= 0 ? 'text-ok' : 'text-bad'}">${brl(period.saldo)}</strong></div>
    </article>`).join('');

  const invoices = state.faturas.filter(item => item.mes === activeMonth && normalizedStatus(item.status) !== 'cancelada');
  qs('#dashboardFaturas').innerHTML = invoices.length
    ? invoices.map(item => `<div class="mini-item"><b>${escapeHtml(cardName(item.cartaoId))}</b><span>${brl(item.valor)} • ${statusTag(item.status)}</span></div>`).join('')
    : '<div class="empty">Nenhuma fatura lançada neste mês.</div>';

  if (!totalDue) {
    qs('#debtSuggestion').innerHTML = '<div class="payoff-highlight ok"><strong>Você não possui saldo devedor pendente.</strong><span>As faturas marcadas como pagas não entram no total.</span></div>';
  } else if (payoffPlan.payoffMonth) {
    qs('#debtSuggestion').innerHTML = `
      <div class="payoff-highlight">
        <span>Total registrado para quitar</span>
        <strong>${brl(totalDue)}</strong>
      </div>
      <p>Direcionando o saldo livre estimado para as dívidas, a previsão de quitação é <b>${escapeHtml(monthLabel(payoffPlan.payoffMonth))}</b>, em aproximadamente <b>${payoffPlan.payoffMonths} mês(es)</b>.</p>
      <p class="muted">Capacidade média estimada: <b>${brl(payoffPlan.averageMonthlyCapacity)}/mês</b>. A previsão considera faturas pendentes, dívidas cadastradas, receitas, contas básicas e gastos já lançados.</p>`;
  } else {
    qs('#debtSuggestion').innerHTML = `
      <div class="payoff-highlight warn"><span>Total registrado para quitar</span><strong>${brl(totalDue)}</strong></div>
      <p>Com os valores atuais, não foi possível projetar a quitação nos próximos 60 meses.</p>
      <p class="muted">Cadastre receitas e despesas futuras ou reduza gastos para obter uma previsão mais precisa.</p>`;
  }
}

function renderSelects() {
  const options = state.cartoes.map(card => `<option value="${escapeHtml(card.id)}">${escapeHtml(card.nome)}${card.banco ? ` - ${escapeHtml(card.banco)}` : ''}</option>`).join('');
  qsa('select[name="cartaoId"]').forEach(select => {
    const selected = select.value;
    select.innerHTML = options || '<option value="">Cadastre um cartão primeiro</option>';
    if (selected && state.cartoes.some(card => card.id === selected)) select.value = selected;
  });
}

function renderTable(selector, rows, columns, entity, options = {}) {
  const target = qs(selector);
  if (!target) return;
  if (!rows.length) { target.innerHTML = '<div class="empty">Nenhum registro.</div>'; return; }
  const header = columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join('') + '<th>Ações</th>';
  const body = rows.map(row => {
    const cells = columns.map(column => `<td data-label="${escapeHtml(column.label)}">${column.render ? column.render(row) : escapeHtml(row[column.key] ?? '-')}</td>`).join('');
    const edit = options.edit === false ? '' : `<button class="btn ghost" data-edit="${entity}" data-id="${escapeHtml(row.id)}" type="button">Editar</button>`;
    const status = options.status ? `<button class="btn soft" data-status="${entity}" data-id="${escapeHtml(row.id)}" type="button">Alterar status</button>` : '';
    return `<tr>${cells}<td data-label="Ações"><div class="actions">${edit}${status}<button class="btn danger" data-delete="${entity}" data-id="${escapeHtml(row.id)}" type="button">Excluir</button></div></td></tr>`;
  }).join('');
  target.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderInvoiceSummary() {
  const summary = getInvoiceSummary(activeMonth);
  const plan = getDebtPayoffPlan(60, payoffStartMonth, payoffMonthlyBudget);
  const cardsHost = qs('#invoiceSummaryCards');
  if (cardsHost) {
    const cards = [
      ['Total pendente', summary.pendingTotal],
      [`Pendente em ${monthLabel(activeMonth)}`, summary.selectedMonthPendingTotal],
      ['Meses anteriores pendentes', summary.previousMonthsPendingTotal],
      ['Total já pago', summary.paidTotal]
    ];
    cardsHost.innerHTML = cards.map(([label, value]) => `
      <article class="card metric ${label === 'Meses anteriores pendentes' && value > 0 ? 'negative' : 'positive'}">
        <span>${escapeHtml(label)}</span><strong>${brl(value)}</strong>
      </article>`).join('');
  }

  const byCardHost = qs('#invoiceByCard');
  if (byCardHost) {
    byCardHost.innerHTML = summary.byCard.length
      ? `<div class="debt-list">${summary.byCard.map(card => `
          <div class="debt-list-item">
            <div><strong>${escapeHtml(card.nome)}</strong><span>${card.quantidade} fatura(s) pendente(s)${card.mesMaisAntigo ? ` • ${escapeHtml(monthLabel(card.mesMaisAntigo))} até ${escapeHtml(monthLabel(card.mesMaisNovo))}` : ''}</span></div>
            <div class="debt-values"><strong>${brl(card.total)}</strong>${card.mesesAnteriores > 0 ? `<small>${brl(card.mesesAnteriores)} de meses anteriores</small>` : ''}</div>
          </div>`).join('')}</div>`
      : '<div class="empty">Nenhuma fatura pendente.</div>';
  }

  const payoffHost = qs('#invoicePayoffPreview');
  if (payoffHost) {
    const total = plan.totalOutstanding;
    payoffHost.innerHTML = !total
      ? '<div class="empty">Não há saldo pendente para projetar.</div>'
      : plan.payoffMonth
        ? `<div class="payoff-highlight"><span>Saldo total devido</span><strong>${brl(total)}</strong></div>
           <p>Previsão de quitação: <b>${escapeHtml(monthLabel(plan.payoffMonth))}</b>.</p>
           <p class="muted">Prazo estimado: ${plan.payoffMonths} mês(es), usando uma capacidade média de ${brl(plan.averageMonthlyCapacity)} por mês.</p>`
        : `<div class="payoff-highlight warn"><span>Saldo total devido</span><strong>${brl(total)}</strong></div>
           <p>A renda livre projetada ainda não cobre o total nos próximos 60 meses.</p>`;
  }
}

function renderTables() {
  renderTable('#cartoesTable', [...state.cartoes].sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR')), [
    { label: 'Cartão', key: 'nome' },
    { label: 'Banco', key: 'banco' },
    { label: 'Venc.', key: 'vencimento' },
    { label: 'Limite', render: row => brl(row.limite) }
  ], 'cartoes');

  let invoices = [...state.faturas];
  if (invoiceFilterMonth) invoices = invoices.filter(item => item.mes === invoiceFilterMonth);
  invoices.sort((a, b) => String(b.mes || '').localeCompare(String(a.mes || '')) || String(cardName(a.cartaoId)).localeCompare(cardName(b.cartaoId), 'pt-BR'));
  const counter = qs('#faturasCount');
  if (counter) {
    const displayedTotal = invoices.reduce((sum, item) => sum + numberValue(item.valor), 0);
    const displayedPending = invoices.filter(isInvoicePending).reduce((sum, item) => sum + numberValue(item.valor), 0);
    counter.textContent = `${invoices.length} exibida(s) • ${state.faturas.length} cadastrada(s) • Total exibido: ${brl(displayedTotal)} • Pendente: ${brl(displayedPending)}`;
  }
  renderTable('#faturasTable', invoices, [
    { label: 'Mês', render: row => monthLabel(row.mes) },
    { label: 'Cartão', render: row => escapeHtml(cardName(row.cartaoId)) },
    { label: 'Valor', render: row => brl(row.valor) },
    { label: 'Vencimento', render: row => dateLabel(invoiceDueDate(row)) },
    { label: 'Status', render: row => invoiceStatusTag(row) },
    { label: 'Observação', key: 'observacao' }
  ], 'faturas', { status: true });

  renderTable('#contasTable', [...state.contas].sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))), [
    { label: 'Conta', key: 'descricao' }, { label: 'Venc.', key: 'data' }, { label: 'Valor', render: row => brl(row.valor) }, { label: 'Status', render: row => statusTag(row.status) }
  ], 'contas', { status: true });
  renderTable('#gastosTable', [...state.gastos].sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))), [
    { label: 'Data', key: 'data' }, { label: 'Gasto', key: 'descricao' }, { label: 'Valor', render: row => brl(row.valor) }, { label: 'Categoria', key: 'categoria' }
  ], 'gastos');
  renderTable('#receitasTable', [...state.receitas].sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))), [
    { label: 'Data', key: 'data' }, { label: 'Origem', key: 'descricao' }, { label: 'Valor', render: row => brl(row.valor) }, { label: 'Tipo', key: 'tipo' }
  ], 'receitas');
  renderTable('#dividasTable', state.dividas, [
    { label: 'Dívida', key: 'nome' },
    { label: 'Aberto hoje', render: row => brl(getDebtStateInMonth(row, currentMonth()).remainingBefore) },
    { label: 'Mensal', render: row => brl(row.pagamentoMensal) },
    { label: 'Status', render: row => statusTag(row.status) }
  ], 'dividas', { status: true });
  renderTable('#comprovantesTable', [...state.comprovantes].sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))), [
    { label: 'Data', key: 'data' }, { label: 'Tipo', key: 'tipoLancamento' }, { label: 'Local', key: 'estabelecimento' }, { label: 'Valor', render: row => brl(row.valor) }
  ], 'comprovantes', { edit: false });
}

// SVG puro: dados são os mesmos totais usados na tabela, sem dependências extras.
function renderProjectionChart(rows) {
  const host = qs('#projectionChart');
  if (!host) return;
  const max = Math.max(1, ...rows.flatMap(row => [row.receitas, row.saidas]));
  const width = 960, height = 252, base = 194, plot = 158;
  const bars = rows.map((row, index) => {
    const x = 53 + index * 75;
    const incomeHeight = Math.max(0, row.receitas / max * plot);
    const expenseHeight = Math.max(0, row.saidas / max * plot);
    const label = monthLabel(row.month);
    return `<g><title>${escapeHtml(label)}: entradas ${brl(row.receitas)}, saídas ${brl(row.saidas)}</title>
      <rect x="${x}" y="${base-incomeHeight}" width="20" height="${incomeHeight}" rx="4" fill="#36d399"/>
      <rect x="${x+24}" y="${base-expenseHeight}" width="20" height="${expenseHeight}" rx="4" fill="#f29e75"/>
      <text x="${x+22}" y="216" text-anchor="middle">${escapeHtml(row.month.slice(5))}/${escapeHtml(row.month.slice(2,4))}</text></g>`;
  }).join('');
  host.innerHTML = `<div class="chart-legend"><span class="legend-income">Entradas</span><span class="legend-expense">Saídas</span></div>
    <div class="chart-scroll"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico de entradas e saídas nos próximos 12 meses">
      <line x1="30" y1="${base}" x2="945" y2="${base}" stroke="#475569"/>
      <line x1="30" y1="36" x2="945" y2="36" stroke="#334155" stroke-dasharray="4 5"/>
      <text x="30" y="27">Máximo: ${brl(max)}</text>${bars}</svg></div>`;
}

function payoffItems(startMonth) {
  const invoices = getInvoiceSummary(startMonth).pending.map(item => ({
    label: `Fatura ${cardName(item.cartaoId)} · ${monthLabel(item.mes)}`,
    amount: Math.max(0, numberValue(item.valor)),
    id: `f-${item.id}`
  }));
  const debts = state.dividas.map(item => ({
    label: item.nome || 'Dívida',
    amount: getDebtStateInMonth(item, startMonth).remainingBefore,
    id: `d-${item.id}`
  }));
  return [...invoices, ...debts].filter(item => item.amount > 0);
}

// Ordenação só na projeção: nenhum lançamento, parcela ou registro da planilha é alterado.
function strategyPlan(base) {
  if (payoffStrategy === 'padrao') return base;
  const items = payoffItems(base.startMonth).sort((a, b) =>
    payoffStrategy === 'neve' ? a.amount - b.amount || a.id.localeCompare(b.id)
      : b.amount - a.amount || a.id.localeCompare(b.id));
  const remainingItems = items.map(item => ({...item, remaining: item.amount}));
  const rows = base.rows.map(row => {
    let budget = row.suggestedPayment;
    const payments = [];
    for (const item of remainingItems) {
      if (budget <= 0) break;
      const paid = Math.min(budget, item.remaining);
      if (paid > 0) { item.remaining -= paid; budget -= paid; payments.push({ label: item.label, paid }); }
    }
    return {...row, payments, target: remainingItems.find(item => item.remaining > 0)?.label || ''};
  });
  return {...base, rows, priority: items, strategy: payoffStrategy};
}

function renderProjection() {
  const rows = projectionRows(12);
  renderProjectionChart(rows);
  qs('#projectionTable').innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Mês</th><th>Entradas</th><th>Faturas</th><th>Contas</th><th>Gastos</th><th>Dívidas</th><th>Saídas</th><th>Saldo</th><th>Acumulado</th></tr></thead><tbody>${rows.map(row => `
    <tr class="${row.saldo >= 0 ? 'positive-row' : 'negative-row'}">
      <td data-label="Mês"><b>${monthLabel(row.month)}</b></td><td data-label="Entradas">${brl(row.receitas)}</td><td data-label="Faturas">${brl(row.faturas)}</td><td data-label="Contas">${brl(row.contas)}</td><td data-label="Gastos">${brl(row.gastos)}</td><td data-label="Dívidas">${brl(row.dividas)}</td><td data-label="Saídas">${brl(row.saidas)}</td><td data-label="Saldo"><b>${brl(row.saldo)}</b></td><td data-label="Acumulado"><b>${brl(row.acumulado)}</b></td>
    </tr>`).join('')}</tbody></table></div>`;

  const payoff = strategyPlan(getDebtPayoffPlan(60, payoffStartMonth, payoffMonthlyBudget));
  const payoffHost = qs('#debtPayoffTable');
  if (!payoffHost) return;
  if (!payoff.totalOutstanding) {
    payoffHost.innerHTML = '<div class="empty">Nenhuma fatura pendente ou dívida aberta para projetar.</div>';
    return;
  }
  const relevantRows = payoff.rows.slice(0, payoff.payoffMonths > 0 ? Math.min(payoff.payoffMonths, 60) : 24);
  payoffHost.innerHTML = `
    ${payoffStrategy === 'padrao' ? '' : `<div class="priority-list"><strong>Ordem de quitação simulada</strong><ol>${payoff.priority.map(item => `<li>${escapeHtml(item.label)} · ${brl(item.amount)}</li>`).join('')}</ol></div>`}
    <div class="payoff-summary-line">
      <div><span>Saldo inicial</span><strong>${brl(payoff.totalOutstanding)}</strong></div>
      <div><span>${payoff.mode === 'manual' ? 'Valor escolhido' : 'Capacidade média'}</span><strong>${brl(payoff.mode === 'manual' ? payoff.manualBudget : payoff.averageMonthlyCapacity)}/mês</strong></div>
      <div><span>Quitação prevista</span><strong>${payoff.payoffMonth ? escapeHtml(monthLabel(payoff.payoffMonth)) : 'Além de 24 meses'}</strong></div>
    </div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Mês</th><th>Receitas</th><th>Despesas básicas</th><th>Pagamento sugerido</th><th>Saldo devedor</th>${payoffStrategy === 'padrao' ? '' : '<th>Próximo alvo</th>'}</tr></thead><tbody>${relevantRows.map(row => `
      <tr class="${row.remaining <= 0 ? 'positive-row' : ''}">
        <td data-label="Mês"><b>${monthLabel(row.month)}</b></td>
        <td data-label="Receitas">${brl(row.receitas)}</td>
        <td data-label="Despesas básicas">${brl(row.despesasBasicas)}</td>
        <td data-label="Pagamento sugerido"><b>${brl(row.suggestedPayment)}</b></td>
        <td data-label="Saldo devedor"><b>${brl(row.remaining)}</b></td>${payoffStrategy === 'padrao' ? '' : `<td data-label="Próximo alvo">${escapeHtml(row.target || 'Quitado')}</td>`}
      </tr>`).join('')}</tbody></table></div>
    <p class="muted projection-note">${payoff.mode === 'manual' ? 'Simulação personalizada com o valor mensal informado.' : 'Simulação automática: todo o saldo livre depois de contas básicas e gastos é destinado às faturas pendentes e dívidas cadastradas.'} Valores futuros ainda não lançados não entram no cálculo.</p>`;
}

function listBlock(items, renderer) {
  return items.length ? `<div class="mini-list">${items.map(renderer).join('')}</div>` : '<div class="empty">Sem registros.</div>';
}

function renderMonthly() {
  const totals = monthTotals(activeMonth);
  const selected = qs('#categoryFilter')?.value || '';
  const categories = [...new Set([...state.contas, ...state.gastos, ...state.receitas]
    .map(item => String(item.categoria || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  const filter = qs('#categoryFilter');
  if (filter) {
    filter.innerHTML = '<option value="">Todas as categorias</option>' + categories.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
    filter.value = categories.includes(selected) ? selected : '';
  }
  const category = filter?.value || '';
  const matches = item => !category || String(item.categoria || '').trim() === category;
  const monthInvoices = state.faturas.filter(item => item.mes === activeMonth && normalizedStatus(item.status) !== 'cancelada');
  const monthBills = state.contas.filter(item => normalizedStatus(item.status) !== 'cancelada')
    .filter(item => item.tipo === 'fixa' ? recurringFrom(item.data, activeMonth) : sameMonth(item.data, activeMonth));
  const monthExpenses = state.gastos.filter(item => sameMonth(item.data, activeMonth));
  const monthIncome = state.receitas.filter(item => item.tipo === 'recorrente' ? recurringFrom(item.data, activeMonth) : sameMonth(item.data, activeMonth));
  const sum = items => items.reduce((acc, item) => acc + numberValue(item.valor), 0);
  const filteredIncome = sum(monthIncome.filter(matches));
  const filteredExpenses = sum(monthBills.filter(matches)) + sum(monthExpenses.filter(matches));
  const viewTotals = category ? {receitas: filteredIncome, saidas: filteredExpenses, saldo: filteredIncome-filteredExpenses} : totals;
  qs('#categoryFilterNote').textContent = category
    ? `Categoria: ${category}. Faturas e pagamentos de dívidas não possuem categoria e ficam fora do somatório filtrado.`
    : 'Resumo completo do mês, incluindo faturas e pagamentos de dívidas.';
  qs('#monthlySummary').innerHTML = [
    ['Entradas', viewTotals.receitas], ['Saídas', viewTotals.saidas], ['Resultado', viewTotals.saldo], ['Mês', monthLabel(activeMonth)]
  ].map(([label, value]) => `<article class="card metric ${typeof value === 'number' && value < 0 ? 'negative' : 'positive'}"><span>${escapeHtml(label)}</span><strong>${typeof value === 'number' ? brl(value) : escapeHtml(value)}</strong></article>`).join('');
  qs('#monthFaturas').innerHTML = listBlock(category ? [] : monthInvoices, item => `<div class="mini-item"><b>${escapeHtml(cardName(item.cartaoId))}</b><span>${brl(item.valor)}</span></div>`);
  qs('#monthContas').innerHTML = listBlock(monthBills.filter(matches), item => `<div class="mini-item"><b>${escapeHtml(item.descricao)}</b><span>${brl(item.valor)}</span></div>`);
  qs('#monthGastos').innerHTML = listBlock(monthExpenses.filter(matches), item => `<div class="mini-item"><b>${escapeHtml(item.descricao)}</b><span>${brl(item.valor)}</span></div>`);
  qs('#monthReceitas').innerHTML = listBlock(monthIncome.filter(matches), item => `<div class="mini-item"><b>${escapeHtml(item.descricao)}</b><span>${brl(item.valor)}</span></div>`);
}

function renderPayoffSimulator() {
  const startInput = qs('#payoffStartMonth');
  const budgetInput = qs('#payoffMonthlyBudget');
  const note = qs('#payoffModeNote');
  const strategyInput = qs('#payoffStrategy');
  if (strategyInput) strategyInput.value = payoffStrategy;
  if (startInput && startInput.value !== payoffStartMonth) startInput.value = payoffStartMonth;
  if (budgetInput) budgetInput.value = payoffMonthlyBudget > 0 ? String(payoffMonthlyBudget) : '';
  if (note) {
    const plan = getDebtPayoffPlan(60, payoffStartMonth, payoffMonthlyBudget);
    note.innerHTML = plan.mode === 'manual'
      ? `Modo personalizado: <b>${brl(plan.manualBudget)} por mês</b>, começando em <b>${escapeHtml(monthLabel(plan.startMonth))}</b>.`
      : `Modo automático: utiliza o saldo livre calculado a partir das receitas, contas e gastos cadastrados.`;
  }
}

function renderSystemInfo() {
  const pending = qs('#pendingCount');
  const version = qs('#appVersion');
  const totals = qs('#databaseCount');
  if (pending) pending.textContent = String(pendingOperations.length);
  if (version) version.textContent = APP_VERSION;
  if (totals) totals.textContent = String(ENTITIES.reduce((sum, entity) => sum + state[entity].length, 0));
}

function renderAll() {
  setActiveMonth(activeMonth);
  renderSelects();
  renderDashboard();
  renderInvoiceSummary();
  renderTables();
  renderProjection();
  renderMonthly();
  renderPayoffSimulator();
  renderSystemInfo();
  if (typeof renderInsights === 'function') renderInsights();
}

function openTab(id) {
  qsa('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === id));
  qsa('.panel').forEach(panel => panel.classList.toggle('active', panel.id === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindForms() {
  const forms = [
    ['cartaoForm', 'cartoes'], ['faturaForm', 'faturas'], ['contaForm', 'contas'],
    ['gastoForm', 'gastos'], ['receitaForm', 'receitas'], ['dividaForm', 'dividas']
  ];
  forms.forEach(([id, entity]) => {
    const form = qs(`#${id}`);
    if (!form) return;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const data = formDataObject(form);
      if (entity === 'faturas' && !state.cartoes.some(card => card.id === data.cartaoId)) {
        toast('Cadastre ou selecione um cartão válido.', 'err');
        return;
      }
      if (entity === 'faturas' && !data.id) {
        const duplicate = state.faturas.find(item => item.cartaoId === data.cartaoId && item.mes === data.mes && normalizedStatus(item.status) !== 'cancelada');
        if (duplicate && !await askConfirmation(`Já existe uma fatura de ${cardName(data.cartaoId)} em ${monthLabel(data.mes)} no valor de ${brl(duplicate.valor)}. Deseja cadastrar outra mesmo assim?`)) {
          toast('Cadastro cancelado. Edite a fatura existente para atualizar o valor.', 'warn');
          return;
        }
      }
      const record = upsert(entity, data);
      form.reset();
      resetFormDefaults(form);
      commitRecord(entity, record);
    });
    form.addEventListener('reset', () => setTimeout(() => resetFormDefaults(form), 0));
  });

  qs('#receiptForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formDataObject(form);
    if (!data.data) data.data = today();
    if (!data.valor || data.valor <= 0) {
      toast('Informe um valor maior que zero.', 'err');
      return;
    }
    const receipt = upsert('comprovantes', data);
    const base = {
      data: data.data,
      valor: data.valor,
      descricao: data.estabelecimento || (data.tipoLancamento === 'receita' ? 'Entrada por comprovante' : 'Gasto por comprovante'),
      categoria: data.categoria,
      formaPagamento: data.formaPagamento,
      observacao: data.observacao,
      origemComprovante: receipt.id
    };
    const entity = data.tipoLancamento === 'receita' ? 'receitas' : 'gastos';
    if (entity === 'receitas') base.tipo = 'avulsa';
    const launch = upsert(entity, base);
    form.reset();
    resetFormDefaults(form);
    commitRecords([{ entity: 'comprovantes', record: receipt }, { entity, record: launch }], 'Comprovante e lançamento salvos');
  });
}

function bindGlobalActions() {
  qsa('.tab').forEach(button => button.addEventListener('click', () => openTab(button.dataset.tab)));
  qsa('[data-open-tab]').forEach(button => button.addEventListener('click', () => openTab(button.dataset.openTab)));
  qs('#monthFilter')?.addEventListener('change', event => { setActiveMonth(event.target.value); renderDashboard(); renderInvoiceSummary(); renderMonthly(); renderProjection(); renderInsights(); });
  qs('#dashMonthFilter')?.addEventListener('change', event => { setActiveMonth(event.target.value); renderDashboard(); renderInvoiceSummary(); renderMonthly(); renderProjection(); renderInsights(); });
  qs('#categoryFilter')?.addEventListener('change', renderMonthly);
  qs('#faturasMonthFilter')?.addEventListener('change', event => { invoiceFilterMonth = event.target.value; renderTables(); });
  qs('#clearFaturasFilter')?.addEventListener('click', () => {
    invoiceFilterMonth = '';
    const input = qs('#faturasMonthFilter');
    if (input) input.value = '';
    renderTables();
  });
  qs('#payoffSimulatorForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    payoffStartMonth = /^\d{4}-\d{2}$/.test(String(data.get('startMonth') || '')) ? String(data.get('startMonth')) : currentMonth();
    payoffMonthlyBudget = Math.max(0, numberValue(data.get('monthlyBudget')));
    payoffStrategy = ['padrao', 'neve', 'avalanche'].includes(data.get('strategy')) ? data.get('strategy') : 'padrao';
    localStorage.setItem(PAYOFF_STRATEGY_KEY, payoffStrategy);
    localStorage.setItem(PAYOFF_START_KEY, payoffStartMonth);
    localStorage.setItem(PAYOFF_BUDGET_KEY, String(payoffMonthlyBudget));
    renderDashboard();
    renderInvoiceSummary();
    renderProjection();
    renderPayoffSimulator();
    toast('Simulação atualizada.', 'ok');
  });
  qs('#resetPayoffSimulator')?.addEventListener('click', () => {
    payoffStartMonth = currentMonth();
    payoffMonthlyBudget = 0;
    payoffStrategy = 'padrao';
    localStorage.setItem(PAYOFF_STRATEGY_KEY, payoffStrategy);
    localStorage.setItem(PAYOFF_START_KEY, payoffStartMonth);
    localStorage.removeItem(PAYOFF_BUDGET_KEY);
    renderDashboard();
    renderInvoiceSummary();
    renderProjection();
    renderPayoffSimulator();
    toast('Simulação automática restaurada.', 'ok');
  });

  document.addEventListener('click', async event => {
    const editButton = event.target.closest('[data-edit]');
    const deleteButton = event.target.closest('[data-delete]');
    const statusButton = event.target.closest('[data-status]');
    if (editButton) {
      const entity = editButton.dataset.edit;
      const item = state[entity]?.find(record => record.id === editButton.dataset.id);
      const form = qs(`[data-entity="${entity}"]`);
      if (item && form) { openTab(ENTITY_TO_TAB[entity]); fillForm(form, item); }
    }
    if (deleteButton) {
      if (await askConfirmation('Excluir este registro? Essa ação também será enviada ao Google Sheets.', 'Excluir registro')) removeItem(deleteButton.dataset.delete, deleteButton.dataset.id);
    }
    if (statusButton) {
      const entity = statusButton.dataset.status;
      const item = state[entity]?.find(record => record.id === statusButton.dataset.id);
      if (!item) return;
      if (entity === 'dividas') item.status = item.status === 'quitada' ? 'aberta' : 'quitada';
      else item.status = item.status === 'paga' ? 'pendente' : 'paga';
      item.updatedAt = nowIso();
      commitRecord(entity, item, 'Status atualizado');
    }
  });

  window.addEventListener('online', () => { setSyncStatus('Reconectado...'); flushPending({ silent: true }).then(() => loadFromServer()); });
  window.addEventListener('offline', () => setSyncStatus(`${pendingOperations.length} pendente(s)`, 'warn'));
}

async function startCamera() {
  try {
    stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    const video = qs('#cameraVideo');
    video.srcObject = cameraStream;
    await video.play();
    toast('Câmera aberta.', 'ok');
  } catch (error) {
    toast(`Não foi possível abrir a câmera: ${error.message}`, 'err');
  }
}

function stopCamera() {
  if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
  cameraStream = null;
  const video = qs('#cameraVideo');
  if (video) video.srcObject = null;
}

async function capturePhoto() {
  const video = qs('#cameraVideo');
  const canvas = qs('#cameraCanvas');
  if (!cameraStream || !video?.videoWidth) {
    toast('Abra a câmera antes de tirar a foto.', 'warn');
    return;
  }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) return;
  selectedReceiptFile = new File([blob], `comprovante-${Date.now()}.jpg`, { type: 'image/jpeg' });
  showReceiptPreview(selectedReceiptFile, canvas.toDataURL('image/jpeg', 0.92));
  stopCamera();
}

function showReceiptPreview(file, dataUrl = '') {
  const preview = qs('#receiptPreview');
  if (!preview) return;
  if (receiptPreviewUrl) { URL.revokeObjectURL(receiptPreviewUrl); receiptPreviewUrl = null; }
  if (file.type === 'application/pdf') {
    preview.innerHTML = `<div class="file-preview"><strong>PDF selecionado</strong><span>${escapeHtml(file.name)} • ${(file.size / 1024).toFixed(1)} KB</span></div>`;
    return;
  }
  const url = dataUrl || URL.createObjectURL(file);
  if (!dataUrl) receiptPreviewUrl = url;
  preview.innerHTML = `<img src="${url}" alt="Pré-visualização do comprovante">`;
}

function handleReceiptFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
    toast('Escolha uma imagem ou um PDF.', 'err');
    event.target.value = '';
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    toast('O arquivo deve ter no máximo 15 MB.', 'err');
    event.target.value = '';
    return;
  }
  selectedReceiptFile = file;
  showReceiptPreview(file);
}

async function recognizeImage(source, progressCallback) {
  if (!window.Tesseract) throw new Error('Biblioteca de OCR não carregada. Verifique a internet.');
  const result = await Tesseract.recognize(source, 'por', {
    logger: info => {
      if (info.status === 'recognizing text' && progressCallback) progressCallback(Math.round((info.progress || 0) * 100));
    }
  });
  return result.data.text || '';
}

async function recognizePdf(file, progressCallback) {
  if (!window.pdfjsLib) throw new Error('Biblioteca de PDF não carregada. Verifique a internet.');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const bytes = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pageCount = Math.min(pdf.numPages, 5);
  const texts = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    texts.push(await recognizeImage(canvas, percent => progressCallback?.(Math.round(((pageNumber - 1 + percent / 100) / pageCount) * 100))));
  }
  if (pdf.numPages > pageCount) toast(`Foram lidas as primeiras ${pageCount} páginas do PDF.`, 'warn');
  return texts.join('\n\n');
}

function parseReceiptText(text) {
  const normalized = String(text || '').replace(/\r/g, '').trim();
  const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
  const dateMatch = normalized.match(/\b(\d{2})[\/.\-](\d{2})[\/.\-](\d{2,4})\b/);
  let date = today();
  if (dateMatch) {
    const year = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
    date = `${year}-${dateMatch[2]}-${dateMatch[1]}`;
  }
  const cnpj = normalized.match(/\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/.\s]?\d{4}[-\s]?\d{2}\b/)?.[0] || '';
  const moneyPattern = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})/g;
  const totalsLines = lines.filter(line => /\b(total|valor pago|valor da compra|a pagar)\b/i.test(line));
  const candidates = [];
  [...totalsLines, normalized].forEach(source => {
    for (const match of source.matchAll(moneyPattern)) {
      const value = numberValue(match[1]);
      if (value > 0 && value < 100000000) candidates.push(value);
    }
  });
  const value = candidates.length ? Math.max(...candidates) : 0;
  const ignored = /^(documento|cupom|nota fiscal|cnpj|cpf|data|hora|sat|nfce|nfc-e|comprovante)/i;
  const establishment = lines.find(line => line.length >= 3 && line.length <= 80 && !ignored.test(line) && !/^\d+$/.test(line)) || '';
  const payment = /pix/i.test(normalized) ? 'Pix' : /cr[eé]dito/i.test(normalized) ? 'Cartão de crédito' : /d[eé]bito/i.test(normalized) ? 'Cartão de débito' : /dinheiro/i.test(normalized) ? 'Dinheiro' : '';
  return { data: date, valor: value, estabelecimento: establishment, cnpj, formaPagamento: payment, texto: normalized };
}

function fillReceiptForm(parsed) {
  const form = qs('#receiptForm');
  if (!form) return;
  Object.entries(parsed).forEach(([key, value]) => {
    if (form.elements[key] && value !== undefined && value !== '') form.elements[key].value = value;
  });
}

async function runOcr() {
  if (!selectedReceiptFile) {
    toast('Selecione um arquivo ou tire uma foto primeiro.', 'warn');
    return;
  }
  const button = qs('#runOcrBtn');
  const original = button.textContent;
  button.disabled = true;
  try {
    button.textContent = 'Preparando leitura...';
    const update = percent => { button.textContent = `Lendo comprovante... ${percent}%`; };
    const text = selectedReceiptFile.type === 'application/pdf'
      ? await recognizePdf(selectedReceiptFile, update)
      : await recognizeImage(selectedReceiptFile, update);
    fillReceiptForm(parseReceiptText(text));
    toast('Leitura concluída. Revise os campos antes de salvar.', 'ok');
  } catch (error) {
    toast(`Falha na leitura: ${error.message}`, 'err');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function bindReceiptTools() {
  qs('#receiptFile')?.addEventListener('change', handleReceiptFile);
  qs('#startCameraBtn')?.addEventListener('click', startCamera);
  qs('#captureBtn')?.addEventListener('click', capturePhoto);
  qs('#stopCameraBtn')?.addEventListener('click', stopCamera);
  qs('#runOcrBtn')?.addEventListener('click', runOcr);
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportBackup() {
  downloadJson(`controle-financeiro-backup-${today()}.json`, { exportedAt: nowIso(), appVersion: APP_VERSION, state, insights: getInsightsBackup() });
  toast('Backup gerado.', 'ok');
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const content = safeJsonParse(await file.text(), null);
    const incoming = normalizeState(content?.state || content);
    if (!await askConfirmation('Importar este backup e mesclar com os dados atuais?', 'Importar backup')) return;
    if (content?.insights) importInsightsBackup(content.insights);
    ENTITIES.forEach(entity => { state[entity] = mergeEntity(state[entity], incoming[entity]); });
    state.config = { ...incoming.config, ...state.config, apiUrl: DEFAULT_API_URL, deploymentId: DEPLOYMENT_ID, libraryUrl: APPS_SCRIPT_LIBRARY_URL, appVersion: APP_VERSION };
    saveLocal();
    ENTITIES.forEach(entity => state[entity].forEach(record => enqueueSave(entity, record)));
    renderAll();
    toast('Backup importado e preparado para sincronização.', 'ok');
    flushPending({ silent: true });
  } catch (error) {
    toast(`Backup inválido: ${error.message}`, 'err');
  }
}

async function manualSync() {
  await flushPending({ silent: true });
  try {
    setSyncStatus('Conferindo nuvem...');
    await api('saveAll', deepClone(state));
    await loadFromServer();
    toast('Sincronização completa finalizada sem substituir registros antigos.', 'ok');
  } catch (error) {
    setSyncStatus('Falha na sincronização', 'err');
    toast(`Falha na sincronização completa: ${error.message}`, 'err');
  }
}

function bindSystemTools() {
  qs('#configForm')?.addEventListener('submit', event => {
    event.preventDefault();
    state.config.apiUrl = DEFAULT_API_URL;
    state.config.deploymentId = DEPLOYMENT_ID;
    state.config.libraryUrl = APPS_SCRIPT_LIBRARY_URL;
    saveLocal();
    toast('Backend confirmado e fixado nesta implantação.', 'ok');
  });
  qs('#testApiBtn')?.addEventListener('click', async () => {
    try {
      setSyncStatus('Testando...');
      const result = await api('ping', {});
      setSyncStatus('Conectado', 'ok');
      toast(`Conexão funcionando${result?.at ? ` • ${new Date(result.at).toLocaleString('pt-BR')}` : ''}.`, 'ok');
    } catch (error) {
      setSyncStatus('Sem conexão', 'err');
      toast(`Falha no teste: ${error.message}`, 'err');
    }
  });
  qs('#syncNowBtn')?.addEventListener('click', manualSync);
  qs('#reloadCloudBtn')?.addEventListener('click', () => loadFromServer({ notify: true }));
  qs('#exportBackupBtn')?.addEventListener('click', exportBackup);
  qs('#importBackupFile')?.addEventListener('change', importBackup);
}

function bindPwa() {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    qs('#installBtn')?.classList.remove('hidden');
  });
  qs('#installBtn')?.addEventListener('click', async () => {
    if (!installPrompt) {
      toast('Use o menu do navegador e escolha “Adicionar à tela inicial”.', 'warn');
      return;
    }
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    qs('#installBtn')?.classList.add('hidden');
  });
  window.addEventListener('appinstalled', () => {
    qs('#installBtn')?.classList.add('hidden');
    toast('Aplicativo instalado.', 'ok');
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register(`service-worker.js?v=${APP_VERSION}`).catch(error => console.warn('Service Worker:', error));
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  setActiveMonth(activeMonth);
  qsa('form').forEach(resetFormDefaults);
  bindForms();
  bindGlobalActions();
  bindReceiptTools();
  bindSystemTools();
  bindPwa();
  renderAll();
  await loadFromServer();
});

window.addEventListener('beforeunload', () => { stopCamera(); if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl); });
