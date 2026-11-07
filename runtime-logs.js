const MAX_LOGS = 300;
const logs = { website: [], bot: [] };
const original = { log: console.log.bind(console), info: console.info.bind(console), warn: console.warn.bind(console), error: console.error.bind(console), debug: console.debug.bind(console) };

function valueToText(value) {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function getLocation(stack) {
  const text = String(stack || '');
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/(?:\(|\s)([^()\s]+\.js):(\d+):(\d+)\)?$/);
    if (m) {
      const file = m[1];
      if (file.includes('runtime-logs.js')) continue;
      return { file, line: Number(m[2]), column: Number(m[3]) };
    }
  }
  return { file: 'unknown', line: null, column: null };
}

function push(kind, level, args) {
  const stack = new Error().stack || '';
  const location = getLocation(stack);
  const file = location.file || '';
  const source = file.includes('web-dashboard.js') ? 'website' : 'bot';
  const message = args.map(valueToText).join(' ');
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    level,
    message: message.slice(0, 5000),
    source,
    file: file.split('/').pop() || file,
    line: location.line,
    column: location.column
  };
  logs[source].push(entry);
  if (logs[source].length > MAX_LOGS) logs[source].splice(0, logs[source].length - MAX_LOGS);
}

for (const level of ['log','info','warn','error','debug']) {
  console[level] = (...args) => {
    push(level, level, args);
    original[level](...args);
  };
}

function getLogs(source, limit = 120) {
  const list = logs[source] || [];
  return list.slice(-Math.min(Number(limit) || 120, MAX_LOGS));
}

function getState(source) {
  const list = logs[source] || [];
  const cutoff = Date.now() - 5 * 60 * 1000;
  const recentErrors = list.filter(x => (x.level === 'error') && Date.parse(x.time) >= cutoff);
  return { status: recentErrors.length ? 'ERROR' : 'GOOD', recentErrors: recentErrors.length, updatedAt: new Date().toISOString() };
}

module.exports = { getLogs, getState };
