/**
 * Excel 文件管理路由
 */
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { addOpLog } = require('../utils/logger');
const { requireLogin, requireAdmin } = require('../utils/middleware');

const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');
const META_FILE = path.join(__dirname, '..', 'data', 'files.json');

// 文件元数据管理
function readMeta() {
  if (!fs.existsSync(META_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { return []; }
}
function writeMeta(data) {
  fs.writeFileSync(META_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Multer 配置
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname)),
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) cb(null, true);
    else cb(new Error('只支持 .xlsx / .xls 文件'));
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// multer v2 错误处理包装
function uploadMiddleware(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

// 解析 Excel -> JSON
function parseExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const result = {};
  wb.SheetNames.forEach(name => {
    const ws = wb.Sheets[name];
    result[name] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  });
  return result;
}

// --- 文件列表 ---
router.get('/files', requireLogin, (req, res) => {
  const meta = readMeta();
  res.json(meta.map(f => ({
    id: f.id, displayName: f.displayName, originalName: f.originalName,
    uploadedAt: f.uploadedAt, uploadedBy: f.uploadedBy, size: f.size,
  })));
});

// --- 上传文件 ---
router.post('/upload', requireAdmin, uploadMiddleware, (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });

  const displayName = (req.body.displayName || req.file.originalname).trim();
  const meta = readMeta();
  const entry = {
    id: uuidv4(),
    displayName,
    originalName: req.file.originalname,
    storedName: req.file.filename,
    uploadedAt: new Date().toISOString(),
    uploadedBy: req.session.username,
    size: req.file.size,
  };
  meta.push(entry);
  writeMeta(meta);

  addOpLog({ username: req.session.username, action: 'upload', detail: `上传文件: ${displayName}` });
  res.json({ success: true, file: entry });
});

// --- 读取文件数据 ---
router.get('/data/:id', requireLogin, (req, res) => {
  const meta = readMeta();
  const f = meta.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: '文件不存在' });

  const filePath = path.join(UPLOADS_DIR, f.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件已丢失' });

  try {
    const data = parseExcel(filePath);
    addOpLog({ username: req.session.username, action: 'view', detail: `查看文件: ${f.displayName}` });
    res.json({ fileName: f.displayName, sheets: data });
  } catch (e) {
    res.status(500).json({ error: '解析文件失败: ' + e.message });
  }
});

// --- 查询（模糊搜索）---
router.get('/search', requireLogin, (req, res) => {
  const { keyword, fileId } = req.query;
  if (!keyword) return res.status(400).json({ error: '请提供搜索关键词' });

  const meta = readMeta();
  const files = fileId ? meta.filter(f => f.id === fileId) : meta;
  const kw = keyword.toLowerCase();
  const results = [];

  files.forEach(f => {
    const filePath = path.join(UPLOADS_DIR, f.storedName);
    if (!fs.existsSync(filePath)) return;
    try {
      const data = parseExcel(filePath);
      Object.entries(data).forEach(([sheet, rows]) => {
        rows.forEach((row, rowIdx) => {
          const match = Object.values(row).some(v =>
            String(v).toLowerCase().includes(kw)
          );
          if (match) results.push({ fileId: f.id, fileName: f.displayName, sheet, rowIndex: rowIdx, row });
        });
      });
    } catch {}
  });

  addOpLog({ username: req.session.username, action: 'search', detail: `搜索: "${keyword}"，命中 ${results.length} 条` });
  res.json({ keyword, total: results.length, results });
});

// --- 编辑文件数据（替换整个sheet数据）---
router.put('/data/:id', requireAdmin, (req, res) => {
  const { sheets } = req.body; // { sheetName: [rows] }
  const meta = readMeta();
  const f = meta.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: '文件不存在' });

  const filePath = path.join(UPLOADS_DIR, f.storedName);

  try {
    const wb = XLSX.utils.book_new();
    Object.entries(sheets).forEach(([name, rows]) => {
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
    XLSX.writeFile(wb, filePath);

    // 更新文件大小
    const stat = fs.statSync(filePath);
    const idx = meta.findIndex(x => x.id === req.params.id);
    meta[idx].size = stat.size;
    writeMeta(meta);

    addOpLog({ username: req.session.username, action: 'edit', detail: `编辑文件: ${f.displayName}` });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '保存失败: ' + e.message });
  }
});

// --- 重命名 ---
router.patch('/rename/:id', requireAdmin, (req, res) => {
  const { displayName } = req.body;
  if (!displayName?.trim()) return res.status(400).json({ error: '名称不能为空' });

  const meta = readMeta();
  const idx = meta.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '文件不存在' });

  const oldName = meta[idx].displayName;
  meta[idx].displayName = displayName.trim();
  writeMeta(meta);

  addOpLog({ username: req.session.username, action: 'rename', detail: `重命名: "${oldName}" -> "${displayName.trim()}"` });
  res.json({ success: true });
});

// --- 删除文件 ---
router.delete('/:id', requireAdmin, (req, res) => {
  const meta = readMeta();
  const idx = meta.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '文件不存在' });

  const f = meta[idx];
  const filePath = path.join(UPLOADS_DIR, f.storedName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  meta.splice(idx, 1);
  writeMeta(meta);

  addOpLog({ username: req.session.username, action: 'delete', detail: `删除文件: ${f.displayName}` });
  res.json({ success: true });
});

// --- 导出 ---
router.get('/export/:id', requireLogin, (req, res) => {
  const { format = 'xlsx' } = req.query;
  const meta = readMeta();
  const f = meta.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: '文件不存在' });

  const filePath = path.join(UPLOADS_DIR, f.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });

  try {
    if (format === 'xlsx') {
      addOpLog({ username: req.session.username, action: 'export', detail: `导出Excel: ${f.displayName}` });
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.displayName)}.xlsx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.sendFile(filePath);
    } else if (format === 'csv') {
      const data = parseExcel(filePath);
      const sheetName = Object.keys(data)[0];
      const rows = data[sheetName];
      if (!rows.length) return res.status(400).json({ error: '数据为空' });

      const headers = Object.keys(rows[0]);
      const csvLines = [
        headers.join(','),
        ...rows.map(row => headers.map(h => JSON.stringify(String(row[h] ?? ''))).join(','))
      ];
      addOpLog({ username: req.session.username, action: 'export', detail: `导出CSV: ${f.displayName}` });
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.displayName)}.csv"`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.send('\uFEFF' + csvLines.join('\r\n')); // BOM for Excel
    } else {
      res.status(400).json({ error: '不支持的格式' });
    }
  } catch (e) {
    res.status(500).json({ error: '导出失败: ' + e.message });
  }
});

module.exports = router;
