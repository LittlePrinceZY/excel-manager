/**
 * 物资管理数据存储
 */
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const MATERIALS_FILE = path.join(__dirname, '..', 'data', 'materials.json');
const APPLICATIONS_FILE = path.join(__dirname, '..', 'data', 'applications.json');
const DEPTS_FILE = path.join(__dirname, '..', 'data', 'departments.json');
const QUOTAS_FILE = path.join(__dirname, '..', 'data', 'quotas.json');
const BROADCAST_FILE = path.join(__dirname, '..', 'data', 'broadcast.json');

// ========== 部门管理 ==========
function readDepts() {
  if (!fs.existsSync(DEPTS_FILE)) return { departments: [] };
  try {
    return JSON.parse(fs.readFileSync(DEPTS_FILE, 'utf8'));
  } catch {
    return { departments: [] };
  }
}

function writeDepts(data) {
  fs.writeFileSync(DEPTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getDepartments() {
  return readDepts().departments;
}

function getDepartmentById(id) {
  return getDepartments().find(d => d.id === id);
}

function getDepartmentByName(name) {
  return getDepartments().find(d => d.name === name);
}

function createDepartment(name, quota = 0) {
  const db = readDepts();
  const dept = {
    id: require('uuid').v4(),
    name,
    quota,
    createdAt: new Date().toISOString(),
  };
  db.departments.push(dept);
  writeDepts(db);
  return dept;
}

function updateDepartment(id, fields) {
  const db = readDepts();
  const idx = db.departments.findIndex(d => d.id === id);
  if (idx === -1) return null;
  db.departments[idx] = { ...db.departments[idx], ...fields };
  writeDepts(db);
  return db.departments[idx];
}

function deleteDepartment(id) {
  const db = readDepts();
  const idx = db.departments.findIndex(d => d.id === id);
  if (idx === -1) return false;
  db.departments.splice(idx, 1);
  writeDepts(db);
  return true;
}

// ========== 物资清单管理 ==========
function readMaterials() {
  if (!fs.existsSync(MATERIALS_FILE)) return { materials: [], uploadHistory: [] };
  try {
    return JSON.parse(fs.readFileSync(MATERIALS_FILE, 'utf8'));
  } catch {
    return { materials: [], uploadHistory: [] };
  }
}

function writeMaterials(data) {
  fs.writeFileSync(MATERIALS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getMaterials() {
  return readMaterials().materials;
}

function getMaterialById(id) {
  return getMaterials().find(m => m.id === id);
}

function parseMaterialsExcel(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  
  if (data.length < 2) return [];
  
  const headers = data[0];
  const nameIdx = headers.findIndex(h => /物品名|名称|品名|物资/i.test(h));
  const priceIdx = headers.findIndex(h => /单价|价格|金额/i.test(h));
  const specIdx = headers.findIndex(h => /规格|型号|单位/i.test(h));
  
  if (nameIdx === -1) throw new Error('未找到物品名列，请确保列名包含"物品名"、"名称"或"品名"');
  
  const materials = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[nameIdx]) continue;
    
    materials.push({
      id: require('uuid').v4(),
      name: String(row[nameIdx]).trim(),
      price: priceIdx >= 0 ? parseFloat(row[priceIdx]) || 0 : 0,
      spec: specIdx >= 0 ? String(row[specIdx] || '').trim() : '',
      createdAt: new Date().toISOString(),
    });
  }
  
  return materials;
}

function saveMaterials(materials, uploadedBy) {
  const db = readMaterials();
  db.materials = materials;
  db.uploadHistory.push({
    id: require('uuid').v4(),
    uploadedBy,
    count: materials.length,
    uploadedAt: new Date().toISOString(),
  });
  // 只保留最近10次上传记录
  if (db.uploadHistory.length > 10) {
    db.uploadHistory = db.uploadHistory.slice(-10);
  }
  writeMaterials(db);
  return materials;
}

// 手动添加单个物资
function addMaterial(name, price, spec, addedBy) {
  const db = readMaterials();
  const material = {
    id: require('uuid').v4(),
    name: name.trim(),
    price: parseFloat(price) || 0,
    spec: (spec || '').trim(),
    createdAt: new Date().toISOString(),
    addedBy: addedBy || 'admin',
    source: 'manual'
  };
  db.materials.push(material);
  writeMaterials(db);
  return material;
}

// 更新物资
function updateMaterial(id, fields) {
  const db = readMaterials();
  const idx = db.materials.findIndex(m => m.id === id);
  if (idx === -1) return null;
  db.materials[idx] = { ...db.materials[idx], ...fields };
  writeMaterials(db);
  return db.materials[idx];
}

// 删除物资
function deleteMaterial(id) {
  const db = readMaterials();
  const idx = db.materials.findIndex(m => m.id === id);
  if (idx === -1) return false;
  db.materials.splice(idx, 1);
  writeMaterials(db);
  return true;
}

// ========== 申领记录管理 ==========
function readApplications() {
  if (!fs.existsSync(APPLICATIONS_FILE)) return { applications: [] };
  try {
    return JSON.parse(fs.readFileSync(APPLICATIONS_FILE, 'utf8'));
  } catch {
    return { applications: [] };
  }
}

function writeApplications(data) {
  fs.writeFileSync(APPLICATIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getApplications() {
  return readApplications().applications;
}

function getApplicationsByUser(userId) {
  return getApplications().filter(a => a.userId === userId);
}

function getApplicationsByDepartment(deptId) {
  return getApplications().filter(a => a.departmentId === deptId);
}

function createApplication(data) {
  const db = readApplications();
  const app = {
    id: require('uuid').v4(),
    ...data,
    status: 'pending', // pending, approved, rejected
    createdAt: new Date().toISOString(),
  };
  db.applications.push(app);
  writeApplications(db);
  return app;
}

function updateApplication(id, fields) {
  const db = readApplications();
  const idx = db.applications.findIndex(a => a.id === id);
  if (idx === -1) return null;
  db.applications[idx] = { ...db.applications[idx], ...fields };
  writeApplications(db);
  return db.applications[idx];
}

function deleteApplication(id) {
  const db = readApplications();
  const idx = db.applications.findIndex(a => a.id === id);
  if (idx === -1) return false;
  db.applications.splice(idx, 1);
  writeApplications(db);
  return true;
}

// ========== 部门额度管理 ==========
function getDepartmentUsedQuota(deptId, month) {
  const apps = getApplications().filter(a => 
    a.departmentId === deptId && 
    a.status !== 'rejected' &&
    a.month === month
  );
  return apps.reduce((sum, a) => sum + (a.totalAmount || 0), 0);
}

function getDepartmentRemainingQuota(deptId, month) {
  const dept = getDepartmentById(deptId);
  if (!dept) return 0;
  const used = getDepartmentUsedQuota(deptId, month);
  return (dept.quota || 0) - used;
}

// ========== 广播管理 ==========
function readBroadcast() {
  if (!fs.existsSync(BROADCAST_FILE)) return { content: '', updatedAt: null, updatedBy: null };
  try {
    return JSON.parse(fs.readFileSync(BROADCAST_FILE, 'utf8'));
  } catch {
    return { content: '', updatedAt: null, updatedBy: null };
  }
}

function writeBroadcast(data) {
  fs.writeFileSync(BROADCAST_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getBroadcast() {
  return readBroadcast();
}

function setBroadcast(content, updatedBy) {
  const data = {
    content: content || '',
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy || 'admin'
  };
  writeBroadcast(data);
  return data;
}

module.exports = {
  // 部门
  getDepartments,
  getDepartmentById,
  getDepartmentByName,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  // 物资
  getMaterials,
  getMaterialById,
  parseMaterialsExcel,
  saveMaterials,
  addMaterial,
  updateMaterial,
  deleteMaterial,
  // 申领
  getApplications,
  getApplicationsByUser,
  getApplicationsByDepartment,
  createApplication,
  updateApplication,
  deleteApplication,
  // 额度
  getDepartmentUsedQuota,
  getDepartmentRemainingQuota,
  // 广播
  getBroadcast,
  setBroadcast,
};