/**
 * 审批流程路由
 */
const router = require('express').Router();
const { requireLogin, requireAdmin } = require('../utils/middleware');
const { addOpLog } = require('../utils/logger');
const {
  getWorkflows, getWorkflowById, createWorkflow, updateWorkflow, deleteWorkflow,
  getInstances, getInstancesByUser, getPendingInstancesForApprover, 
  getApprovedInstancesByUser, createInstance, approveInstance, 
  rejectInstance, withdrawInstance, deleteInstance
} = require('../utils/workflow');
const { getUsers } = require('../utils/db');
const { getDepartments } = require('../utils/materials');

// ========== 审批流程定义（管理员） ==========

// 获取所有流程
router.get('/definitions', requireLogin, (req, res) => {
  const workflows = getWorkflows();
  res.json(workflows);
});

// 获取单个流程
router.get('/definitions/:id', requireLogin, (req, res) => {
  const workflow = getWorkflowById(req.params.id);
  if (!workflow) return res.status(404).json({ error: '流程不存在' });
  res.json(workflow);
});

// 创建流程（管理员）
router.post('/definitions', requireAdmin, (req, res) => {
  try {
    const { name, description, category, steps } = req.body;
    
    if (!name || !steps || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: '流程名称和审批步骤不能为空' });
    }
    
    // 验证步骤格式
    for (const step of steps) {
      if (!step.name || !step.approvers || !Array.isArray(step.approvers)) {
        return res.status(400).json({ error: '每个步骤必须包含名称和审批人' });
      }
    }
    
    const workflow = createWorkflow({
      name,
      description,
      category,
      steps,
      createdBy: req.session.userId,
    });
    
    addOpLog({
      username: req.session.username,
      action: 'create-workflow',
      detail: `创建审批流程: ${name}`
    });
    
    res.json({ success: true, workflow });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 更新流程（管理员）
router.put('/definitions/:id', requireAdmin, (req, res) => {
  try {
    const { name, description, category, steps, enabled } = req.body;
    const workflow = updateWorkflow(req.params.id, {
      name, description, category, steps, enabled
    });
    
    if (!workflow) return res.status(404).json({ error: '流程不存在' });
    
    addOpLog({
      username: req.session.username,
      action: 'update-workflow',
      detail: `更新审批流程: ${workflow.name}`
    });
    
    res.json({ success: true, workflow });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 删除流程（管理员）
router.delete('/definitions/:id', requireAdmin, (req, res) => {
  const workflow = getWorkflowById(req.params.id);
  if (!workflow) return res.status(404).json({ error: '流程不存在' });
  
  deleteWorkflow(req.params.id);
  
  addOpLog({
    username: req.session.username,
    action: 'delete-workflow',
    detail: `删除审批流程: ${workflow.name}`
  });
  
  res.json({ success: true });
});

// 获取可选审批人列表
router.get('/approvers', requireLogin, (req, res) => {
  const users = getUsers().map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
  }));
  const departments = getDepartments().map(d => ({
    id: d.id,
    name: d.name,
    type: 'department'
  }));
  
  res.json({
    users,
    departments,
    roles: [
      { id: 'admin', name: '所有管理员' },
      { id: 'user', name: '所有普通用户' }
    ]
  });
});

// ========== 审批实例（普通用户） ==========

// 获取我的申请
router.get('/my-applications', requireLogin, (req, res) => {
  const instances = getInstancesByUser(req.session.userId);
  res.json(instances);
});

// 获取待我审批
router.get('/pending-approvals', requireLogin, (req, res) => {
  const instances = getPendingInstancesForApprover(req.session.userId);
  res.json(instances);
});

// 获取我已审批
router.get('/my-approved', requireLogin, (req, res) => {
  const instances = getApprovedInstancesByUser(req.session.userId);
  res.json(instances);
});

// 获取所有审批实例（管理员）
router.get('/instances', requireAdmin, (req, res) => {
  const instances = getInstances();
  res.json(instances);
});

// 创建申请
router.post('/applications', requireLogin, (req, res) => {
  try {
    const { workflowId, title, content, formData } = req.body;
    
    if (!workflowId || !title) {
      return res.status(400).json({ error: '流程和标题不能为空' });
    }
    
    const workflow = getWorkflowById(workflowId);
    if (!workflow) return res.status(404).json({ error: '流程不存在' });
    if (!workflow.enabled) return res.status(400).json({ error: '该流程已停用' });
    
    const instance = createInstance({
      workflowId,
      applicantId: req.session.userId,
      applicantName: req.session.username,
      applicantDept: req.session.departmentId || null,
      title,
      content,
      formData,
    });
    
    addOpLog({
      username: req.session.username,
      action: 'create-application',
      detail: `提交申请: ${title}`
    });
    
    res.json({ success: true, instance });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 审批通过
router.post('/instances/:id/approve', requireLogin, (req, res) => {
  try {
    const { comment } = req.body;
    const instance = approveInstance(
      req.params.id,
      req.session.userId,
      req.session.username,
      comment
    );
    
    if (!instance) return res.status(404).json({ error: '申请不存在' });
    
    addOpLog({
      username: req.session.username,
      action: 'approve-application',
      detail: `审批通过: ${instance.title}`
    });
    
    res.json({ success: true, instance });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 审批拒绝
router.post('/instances/:id/reject', requireLogin, (req, res) => {
  try {
    const { comment } = req.body;
    const instance = rejectInstance(
      req.params.id,
      req.session.userId,
      req.session.username,
      comment
    );
    
    if (!instance) return res.status(404).json({ error: '申请不存在' });
    
    addOpLog({
      username: req.session.username,
      action: 'reject-application',
      detail: `审批拒绝: ${instance.title}`
    });
    
    res.json({ success: true, instance });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 撤回申请
router.post('/instances/:id/withdraw', requireLogin, (req, res) => {
  try {
    const instance = withdrawInstance(req.params.id, req.session.userId);
    if (!instance) return res.status(404).json({ error: '申请不存在' });
    
    addOpLog({
      username: req.session.username,
      action: 'withdraw-application',
      detail: `撤回申请: ${instance.title}`
    });
    
    res.json({ success: true, instance });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 删除申请（管理员）
router.delete('/instances/:id', requireAdmin, (req, res) => {
  const instance = getInstances().find(i => i.id === req.params.id);
  if (!instance) return res.status(404).json({ error: '申请不存在' });
  
  deleteInstance(req.params.id);
  
  addOpLog({
    username: req.session.username,
    action: 'delete-application',
    detail: `删除申请: ${instance.title}`
  });
  
  res.json({ success: true });
});

module.exports = router;
