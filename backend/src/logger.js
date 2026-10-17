const pad = (value, width = 2) => String(value).padStart(width, '0');

export function formatDateTime(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatLogStamp(date = new Date()) {
  return `${formatDateTime(date)},${pad(date.getMilliseconds(), 3)}`;
}

function write(level, message) {
  process.stderr.write(`${formatLogStamp()} [${level}] ${message}\n`);
}

export const logger = {
  info: (message) => write('INFO', message),
  warn: (message) => write('WARNING', message),
  error: (message) => write('ERROR', message),
};
