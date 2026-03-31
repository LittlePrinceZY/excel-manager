/**
 * 日志工具
 */
const fs = require('fs');
const path = require('path');

const LOGIN_LOG_FILE = path.join(__dirname, '..', 'data', 'logs', 'login.json');
const OP_LOG_FILE = path.join(__dirname, '..', 'data', 'logs', 'operations.json');
const LOGIN_MAX = 500;
const OP_MAX = 1000;

function readLog(file) {
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

function writeLog(file, logs) {
  fs.writeFileSync(file, JSON.stringify(logs, null, 2), 'utf8');
}

function addLoginLog(entry) {
  let logs = readLog(LOGIN_LOG_FILE);
  logs.unshift({ ...entry, time: new Date().toISOString() });
  if (logs.length > LOGIN_MAX) logs = logs.slice(0, LOGIN_MAX);
  writeLog(LOGIN_LOG_FILE, logs);
}

function addOpLog(entry) {
  let logs = readLog(OP_LOG_FILE);
  logs.unshift({ ...entry, time: new Date().toISOString() });
  if (logs.length > OP_MAX) logs = logs.slice(0, OP_MAX);
  writeLog(OP_LOG_FILE, logs);
}

function getLoginLogs() { return readLog(LOGIN_LOG_FILE); }
function getOpLogs() { return readLog(OP_LOG_FILE); }

module.exports = { addLoginLog, addOpLog, getLoginLogs, getOpLogs };
