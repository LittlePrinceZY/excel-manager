/**
 * 审批流程管理模块
 * 支持管理员自定义审批流程
 */
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const WORKFLOW_FILE = path.join(__dirname, '..', 'data', 'workflows.json');
const WORKFLOW_INSTANCE_FILE = path.join(__dirname, '..', 'data', 'workflow_instances.json');

// ========== 审批流程定义 ==========
function readWorkflows() {
  if (!fs.existsSync(WORKFLOW_FILE)) return { workflows: [] };
  try {
    return JSON.parse(fs.readFileSync(WORKFLOW_FILE, 'utf8'));
  } catch {
    return { workflows: [] };
  }
}

function writeWorkflows(data) {
  fs.writeFileSync(WORKFLOW_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// 获取所有审批流程
function getWorkflows() {
  return readWorkflows().workflows;
}

// 获取单个流程
function getWorkflowById(id) {
  return getWorkflows().find(w => w.id === id);
}

// 创建审批流程
function createWorkflow(data) {
  const db = readWorkflows();
  const workflow = {
    id: uuidv4(),
    name: data.name,
    description: data.description || '',
    category: data.category || 'general', // general, leave, expense, purchase, etc.
    steps: data.steps || [], // 审批步骤数组
    conditions: data.conditions || {}, // 触发条件
    enabled: data.enabled !== false,
    createdBy: data.createdBy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.workflows.push(workflow);
  writeWorkflows(db);
  return workflow;
}

// 更新审批流程
function updateWorkflow(id, fields) {
  const db = readWorkflows();
  const idx = db.workflows.findIndex(w => w.id === id);
  if (idx === -1) return null;
  db.workflows[idx] = { 
    ...db.workflows[idx], 
    ...fields,
    updatedAt: new Date().toISOString()
  };
  writeWorkflows(db);
  return db.workflows[idx];
}

// 删除审批流程
function deleteWorkflow(id) {
  const db = readWorkflows();
  const idx = db.workflows.findIndex(w => w.id === id);
  if (idx === -1) return false;
  db.workflows.splice(idx, 1);
  writeWorkflows(db);
  return true;
}

// ========== 审批实例管理 ==========
function readInstances() {
  if (!fs.existsSync(WORKFLOW_INSTANCE_FILE)) return { instances: [] };
  try {
    return JSON.parse(fs.readFileSync(WORKFLOW_INSTANCE_FILE, 'utf8'));
  } catch {
    return { instances: [] };
  }
}

function writeInstances(data) {
  fs.writeFileSync(WORKFLOW_INSTANCE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// 获取所有审批实例
function getInstances() {
  return readInstances().instances;
}

// 获取用户的审批实例
function getInstancesByUser(userId) {
  return getInstances().filter(i => i.applicantId === userId);
}

// 获取待我审批的实例
function getPendingInstancesForApprover(approverId) {
  return getInstances().filter(i => {
    if (i.status !== 'pending') return false;
    const currentStep = i.steps.find(s => s.status === 'pending');
    return currentStep && currentStep.approvers.includes(approverId);
  });
}

// 获取我已审批的实例
function getApprovedInstancesByUser(approverId) {
  return getInstances().filter(i => {
    return i.steps.some(s => 
      s.approvedBy === approverId || s.rejectedBy === approverId
    );
  });
}

// 创建审批实例
function createInstance(data) {
  const db = readInstances();
  const workflow = getWorkflowById(data.workflowId);
  if (!workflow) throw new Error('审批流程不存在');
  
  const instance = {
    id: uuidv4(),
    workflowId: workflow.id,
    workflowName: workflow.name,
    applicantId: data.applicantId,
    applicantName: data.applicantName,
    applicantDept: data.applicantDept,
    title: data.title,
    content: data.content,
    formData: data.formData || {},
    status: 'pending', // pending, approved, rejected
    currentStepIndex: 0,
    steps: workflow.steps.map((step, index) => ({
      index,
      name: step.name,
      approvers: step.approvers || [],
      approverType: step.approverType || 'user', // user, role, department
      status: index === 0 ? 'pending' : 'waiting', // pending, approved, rejected, waiting
      comment: null,
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };
  
  db.instances.push(instance);
  writeInstances(db);
  return instance;
}

// 审批通过
function approveInstance(instanceId, approverId, approverName, comment) {
  const db = readInstances();
  const idx = db.instances.findIndex(i => i.id === instanceId);
  if (idx === -1) return null;
  
  const instance = db.instances[idx];
  if (instance.status !== 'pending') {
    throw new Error('该申请已处理完毕');
  }
  
  const currentStep = instance.steps[instance.currentStepIndex];
  if (!currentStep || currentStep.status !== 'pending') {
    throw new Error('当前步骤状态异常');
  }
  
  if (!currentStep.approvers.includes(approverId)) {
    throw new Error('您没有权限审批此申请');
  }
  
  // 更新当前步骤
  currentStep.status = 'approved';
  currentStep.approvedBy = approverId;
  currentStep.approvedByName = approverName;
  currentStep.comment = comment || '';
  currentStep.approvedAt = new Date().toISOString();
  
  // 检查是否还有下一步
  const nextStepIndex = instance.currentStepIndex + 1;
  if (nextStepIndex < instance.steps.length) {
    instance.currentStepIndex = nextStepIndex;
    instance.steps[nextStepIndex].status = 'pending';
  } else {
    // 所有步骤完成
    instance.status = 'approved';
    instance.completedAt = new Date().toISOString();
  }
  
  instance.updatedAt = new Date().toISOString();
  writeInstances(db);
  return instance;
}

// 审批拒绝
function rejectInstance(instanceId, approverId, approverName, comment) {
  const db = readInstances();
  const idx = db.instances.findIndex(i => i.id === instanceId);
  if (idx === -1) return null;
  
  const instance = db.instances[idx];
  if (instance.status !== 'pending') {
    throw new Error('该申请已处理完毕');
  }
  
  const currentStep = instance.steps[instance.currentStepIndex];
  if (!currentStep || currentStep.status !== 'pending') {
    throw new Error('当前步骤状态异常');
  }
  
  if (!currentStep.approvers.includes(approverId)) {
    throw new Error('您没有权限审批此申请');
  }
  
  // 更新当前步骤
  currentStep.status = 'rejected';
  currentStep.rejectedBy = approverId;
  currentStep.rejectedByName = approverName;
  currentStep.comment = comment || '';
  currentStep.rejectedAt = new Date().toISOString();
  
  // 整个申请被拒绝
  instance.status = 'rejected';
  instance.completedAt = new Date().toISOString();
  instance.updatedAt = new Date().toISOString();
  
  writeInstances(db);
  return instance;
}

// 撤回申请（仅申请人）
function withdrawInstance(instanceId, userId) {
  const db = readInstances();
  const idx = db.instances.findIndex(i => i.id === instanceId);
  if (idx === -1) return null;
  
  const instance = db.instances[idx];
  if (instance.applicantId !== userId) {
    throw new Error('只能撤回自己的申请');
  }
  
  if (instance.status !== 'pending') {
    throw new Error('只能撤回待审批的申请');
  }
  
  instance.status = 'withdrawn';
  instance.updatedAt = new Date().toISOString();
  instance.completedAt = new Date().toISOString();
  
  writeInstances(db);
  return instance;
}

// 删除审批实例
function deleteInstance(id) {
  const db = readInstances();
  const idx = db.instances.findIndex(i => i.id === id);
  if (idx === -1) return false;
  db.instances.splice(idx, 1);
  writeInstances(db);
  return true;
}

module.exports = {
  // 流程定义
  getWorkflows,
  getWorkflowById,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  // 审批实例
  getInstances,
  getInstancesByUser,
  getPendingInstancesForApprover,
  getApprovedInstancesByUser,
  createInstance,
  approveInstance,
  rejectInstance,
  withdrawInstance,
  deleteInstance,
};
