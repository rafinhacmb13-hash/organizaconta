const APP_SCHEMA_VERSION = '4.3.0';

const SHEETS = {
  cartoes: ['id','nome','banco','fechamento','vencimento','limite','observacao','createdAt','updatedAt'],
  faturas: ['id','cartaoId','mes','valor','status','observacao','createdAt','updatedAt'],
  contas: ['id','descricao','valor','data','categoria','tipo','status','observacao','createdAt','updatedAt'],
  gastos: ['id','data','descricao','valor','categoria','formaPagamento','observacao','origemComprovante','createdAt','updatedAt'],
  receitas: ['id','descricao','valor','data','tipo','observacao','formaPagamento','origemComprovante','createdAt','updatedAt'],
  dividas: ['id','nome','valorTotal','valorPago','pagamentoMensal','dataInicial','previsaoQuitacao','status','observacao','createdAt','updatedAt'],
  comprovantes: ['id','tipoLancamento','data','valor','estabelecimento','cnpj','categoria','formaPagamento','observacao','texto','createdAt','updatedAt']
};

const SHEET_NAMES = {
  config: 'Config',
  cartoes: 'Cartoes',
  faturas: 'FaturasCartao',
  contas: 'Contas',
  gastos: 'Gastos',
  receitas: 'Receitas',
  dividas: 'Dividas',
  comprovantes: 'Comprovantes',
  logs: 'Logs'
};

function doGet(e) {
  try {
    criarAbas();
    const action = e && e.parameter && e.parameter.action;
    if (action === 'loadAll') return jsonOutput({ ok: true, data: loadAll_() });
    return jsonOutput({ ok: true, data: { status: 'online', schemaVersion: APP_SCHEMA_VERSION, message: 'Apps Script ativo.' } });
  } catch (error) {
    return jsonOutput({ ok: false, error: error.message });
  }
}

function doPost(e) {
  let lock = null;
  try {
    const body = parseBody_(e);
    const action = body.action || 'ping';
    const payload = body.payload || {};

    // Ping não precisa abrir a planilha nem disputar bloqueio.
    if (action === 'ping') {
      return jsonOutput({ ok: true, data: { status: 'online', schemaVersion: APP_SCHEMA_VERSION, at: new Date().toISOString() } });
    }

    // Leituras não ficam presas atrás de gravações longas.
    if (action === 'loadAll' || action === 'list') {
      criarAbas();
      const data = action === 'loadAll' ? loadAll_() : list_(payload.entity);
      return jsonOutput({ ok: true, data: data });
    }

    lock = LockService.getScriptLock();
    lock.waitLock(30000);
    criarAbas();

    if (action === 'saveAll') {
      mergeAll_(payload);
      log_('saveAll', 'Mesclagem completa recebida do site');
      return jsonOutput({ ok: true, data: loadAll_() });
    }
    if (action === 'saveRecord') return jsonOutput({ ok: true, data: saveRecord_(payload.entity, payload.record || {}) });
    if (action === 'deleteRecord') return jsonOutput({ ok: true, data: deleteRecord_(payload.entity, payload.id) });
    if (action === 'updateStatus') return jsonOutput({ ok: true, data: updateStatus_(payload.entity, payload.id, payload.status) });

    throw new Error('Ação inválida: ' + action);
  } catch (error) {
    log_('error', error.stack || error.message);
    return jsonOutput({ ok: false, error: error.message });
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (_) {}
    }
  }
}

function criarAbas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEET_NAMES.config, ['chave','valor']);
  Object.keys(SHEETS).forEach(function(entity) {
    ensureSheet_(ss, SHEET_NAMES[entity], SHEETS[entity]);
  });
  ensureSheet_(ss, SHEET_NAMES.logs, ['data','tipo','mensagem']);

  const config = ss.getSheetByName(SHEET_NAMES.config);
  const current = readConfig_(ss);
  const needsMigration = String(current.schemaVersion || '') !== APP_SCHEMA_VERSION;
  if (needsMigration) {
    Object.keys(SHEETS).forEach(function(entity) {
      repairRecordIds_(ss.getSheetByName(SHEET_NAMES[entity]));
    });
    setConfigValue_(config, 'schemaVersion', APP_SCHEMA_VERSION);
    log_('migration', 'Banco atualizado para a versão ' + APP_SCHEMA_VERSION);
  }
  if (!current.createdAt) setConfigValue_(config, 'createdAt', new Date().toISOString());
  if (!current.observacao) setConfigValue_(config, 'observacao', 'Banco de dados do Controle Financeiro Pessoal');
}

function loadAll_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = { config: readConfig_(ss), cartoes: [], faturas: [], contas: [], gastos: [], receitas: [], dividas: [], comprovantes: [] };
  Object.keys(SHEETS).forEach(function(entity) {
    data[entity] = readSheet_(ss.getSheetByName(SHEET_NAMES[entity]), SHEETS[entity]);
  });
  return data;
}

/**
 * Mescla o estado recebido com as linhas existentes.
 * Nunca apaga registros ausentes no payload. Exclusões são feitas apenas por deleteRecord.
 * Isso elimina o problema de uma sincronização antiga substituir faturas de outros meses.
 */
function mergeAll_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function(entity) {
    const incoming = Array.isArray(payload[entity]) ? payload[entity] : [];
    mergeSheet_(ss.getSheetByName(SHEET_NAMES[entity]), SHEETS[entity], incoming);
  });
  if (payload.config) writeConfig_(ss, payload.config);
}

function list_(entity) {
  assertEntity_(entity);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return readSheet_(ss.getSheetByName(SHEET_NAMES[entity]), SHEETS[entity]);
}

function saveRecord_(entity, record) {
  assertEntity_(entity);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES[entity]);
  const headers = SHEETS[entity];
  const now = new Date().toISOString();
  const data = Object.assign({}, record || {});
  data.id = String(data.id || makeId_());
  data.createdAt = data.createdAt || now;
  data.updatedAt = data.updatedAt || now;

  const rowIndex = findRowById_(sheet, data.id);
  const values = headers.map(function(header) { return data[header] !== undefined ? data[header] : ''; });
  if (rowIndex > 0) {
    const currentRow = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    const current = {};
    headers.forEach(function(header, index) { current[header] = normalizeValue_(currentRow[index]); });
    if (timestamp_(data.updatedAt || data.createdAt) < timestamp_(current.updatedAt || current.createdAt)) {
      return current;
    }
    sheet.getRange(rowIndex, 1, 1, headers.length).setValues([values]);
  } else {
    const targetRow = Math.max(2, sheet.getLastRow() + 1);
    ensureSheetCapacity_(sheet, targetRow, headers.length);
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([values]);
  }
  log_('saveRecord', entity + ' / ' + data.id);
  return data;
}

function deleteRecord_(entity, id) {
  assertEntity_(entity);
  if (!id) throw new Error('ID não informado.');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES[entity]);
  const rowIndex = findRowById_(sheet, String(id));
  if (rowIndex > 1) sheet.deleteRow(rowIndex);
  log_('deleteRecord', entity + ' / ' + id);
  return { id: id, deleted: rowIndex > 1 };
}

function updateStatus_(entity, id, status) {
  assertEntity_(entity);
  if (!id) throw new Error('ID não informado.');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES[entity]);
  const headers = SHEETS[entity];
  const rowIndex = findRowById_(sheet, String(id));
  if (rowIndex < 2) throw new Error('Registro não encontrado.');
  const statusColumn = headers.indexOf('status') + 1;
  const updatedColumn = headers.indexOf('updatedAt') + 1;
  if (!statusColumn) throw new Error('Essa entidade não possui status.');
  sheet.getRange(rowIndex, statusColumn).setValue(status || '');
  if (updatedColumn) sheet.getRange(rowIndex, updatedColumn).setValue(new Date().toISOString());
  const row = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const result = {};
  headers.forEach(function(header, index) { result[header] = normalizeValue_(row[index]); });
  log_('updateStatus', entity + ' / ' + id + ' / ' + status);
  return result;
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  ensureSheetCapacity_(sheet, Math.max(2, sheet.getMaxRows()), headers.length);
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeader = headers.some(function(header, index) { return current[index] !== header; });
  if (needsHeader) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

function ensureSheetCapacity_(sheet, requiredRows, requiredColumns) {
  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < requiredColumns) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), requiredColumns - sheet.getMaxColumns());
  }
}

function repairRecordIds_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return;
  const count = sheet.getLastRow() - 1;
  const range = sheet.getRange(2, 1, count, 1);
  const values = range.getValues();
  const seen = {};
  let changed = false;
  values.forEach(function(row) {
    let id = String(row[0] || '').trim();
    if (!id || seen[id]) {
      id = makeId_();
      row[0] = id;
      changed = true;
    }
    seen[id] = true;
  });
  if (changed) {
    range.setValues(values);
    log_('repairIds', 'IDs vazios ou duplicados foram corrigidos em ' + sheet.getName());
  }
}

function readSheet_(sheet, headers) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return values.filter(function(row) {
    return row.some(function(value) { return value !== ''; });
  }).map(function(row) {
    const obj = {};
    headers.forEach(function(header, index) { obj[header] = normalizeValue_(row[index]); });
    return obj;
  });
}

function mergeSheet_(sheet, headers, incomingRows) {
  if (!sheet || !incomingRows.length) return;
  const existing = readSheet_(sheet, headers);
  const byId = {};
  existing.forEach(function(row) {
    if (!row.id) row.id = makeId_();
    byId[String(row.id)] = row;
  });
  incomingRows.forEach(function(row) {
    if (!row || typeof row !== 'object') return;
    const incoming = Object.assign({}, row);
    incoming.id = String(incoming.id || makeId_());
    incoming.createdAt = incoming.createdAt || incoming.updatedAt || new Date().toISOString();
    incoming.updatedAt = incoming.updatedAt || incoming.createdAt;
    const current = byId[incoming.id];
    if (!current || timestamp_(incoming.updatedAt || incoming.createdAt) >= timestamp_(current.updatedAt || current.createdAt)) {
      byId[incoming.id] = Object.assign({}, current || {}, incoming);
    }
  });
  const merged = Object.keys(byId).map(function(id) { return byId[id]; });
  writeSheet_(sheet, headers, merged);
}

function writeSheet_(sheet, headers, rows) {
  if (!sheet) return;
  const safeRows = Array.isArray(rows) ? rows : [];
  const requiredRows = Math.max(2, safeRows.length + 1);
  ensureSheetCapacity_(sheet, requiredRows, headers.length);

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, headers.length).clearContent();
  if (!safeRows.length) return;

  const values = safeRows.map(function(row) {
    return headers.map(function(header) { return row && row[header] !== undefined ? row[header] : ''; });
  });
  sheet.getRange(2, 1, values.length, headers.length).setValues(values);
}

function findRowById_(sheet, id) {
  if (!sheet || sheet.getLastRow() < 2 || !id) return -1;
  const finder = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return finder ? finder.getRow() : -1;
}

function timestamp_(value) {
  const time = new Date(value || 0).getTime();
  return isNaN(time) ? 0 : time;
}

function readConfig_(ss) {
  const sheet = ss.getSheetByName(SHEET_NAMES.config);
  const config = {};
  if (!sheet || sheet.getLastRow() < 2) return config;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  values.forEach(function(row) {
    if (row[0]) config[String(row[0])] = normalizeValue_(row[1]);
  });
  return config;
}

function writeConfig_(ss, config) {
  const sheet = ss.getSheetByName(SHEET_NAMES.config);
  const safe = Object.assign({}, config || {});
  delete safe.apiUrl;
  Object.keys(safe).forEach(function(key) { setConfigValue_(sheet, key, safe[key]); });
}

function setConfigValue_(sheet, key, value) {
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const finder = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(String(key)).matchEntireCell(true).findNext();
    if (finder) {
      sheet.getRange(finder.getRow(), 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  const raw = e.postData.contents;
  try { return JSON.parse(raw); } catch (_) {}
  const params = e.parameter || {};
  if (params.payload) return JSON.parse(params.payload);
  return {};
}

function normalizeValue_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return value;
}

function assertEntity_(entity) {
  if (!entity || !SHEETS[entity]) throw new Error('Entidade inválida: ' + entity);
}

function makeId_() {
  return 'id_' + new Date().getTime().toString(36) + '_' + Math.random().toString(36).slice(2, 11);
}

function log_(type, message) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.logs) || ss.insertSheet(SHEET_NAMES.logs);
    if (sheet.getLastRow() === 0) sheet.appendRow(['data','tipo','mensagem']);
    sheet.appendRow([new Date(), type, String(message || '')]);
    const maxRows = 2000;
    const excess = sheet.getLastRow() - maxRows;
    if (excess > 0) sheet.deleteRows(2, excess);
  } catch (_) {}
}

/** Executa uma manutenção manual segura quando necessário. */
function executarManutencao() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    criarAbas();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    Object.keys(SHEETS).forEach(function(entity) {
      repairRecordIds_(ss.getSheetByName(SHEET_NAMES[entity]));
    });
    log_('maintenance', 'Manutenção manual concluída');
    return 'Manutenção concluída.';
  } finally {
    lock.releaseLock();
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
