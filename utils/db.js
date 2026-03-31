/**
 * 用户数据存储（JSON文件）
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_FILE = path.join(__dirname, '..', 'data', 'users.json');

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    return { users: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { users: [] };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getUsers() {
  return readDB().users;
}

function getUserByUsername(username) {
  return getUsers().find(u => u.username.toLowerCase() === username.toLowerCase());
}

function getUserById(id) {
  return getUsers().find(u => u.id === id);
}

function createUser(username, password, role = 'user') {
  const db = readDB();
  const hash = bcrypt.hashSync(password, 10);
  const user = {
    id: require('uuid').v4(),
    username,
    password: hash,
    role,
    createdAt: new Date().toISOString(),
    loginAttempts: 0,
    lockedUntil: null,
  };
  db.users.push(user);
  writeDB(db);
  return user;
}

function updateUser(id, fields) {
  const db = readDB();
  const idx = db.users.findIndex(u => u.id === id);
  if (idx === -1) return null;
  db.users[idx] = { ...db.users[idx], ...fields };
  writeDB(db);
  return db.users[idx];
}

function deleteUser(id) {
  const db = readDB();
  const idx = db.users.findIndex(u => u.id === id);
  if (idx === -1) return false;
  db.users.splice(idx, 1);
  writeDB(db);
  return true;
}

function ensureAdmin() {
  const existing = getUserByUsername('Admin');
  if (!existing) {
    console.log('🔑 创建默认管理员账号 Admin/123456');
    createUser('Admin', '123456', 'admin');
  }
}

module.exports = { getUsers, getUserByUsername, getUserById, createUser, updateUser, deleteUser, ensureAdmin };
