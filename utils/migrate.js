/**
 * 明文密码自动迁移
 */
const bcrypt = require('bcryptjs');
const { getUsers, updateUser } = require('./db');

module.exports = function migrate() {
  const { ensureAdmin } = require('./db');
  ensureAdmin();

  const users = getUsers();
  users.forEach(user => {
    // bcrypt hash 以 $2b$ 或 $2a$ 开头
    if (user.password && !user.password.startsWith('$2')) {
      console.log(`🔄 迁移用户 ${user.username} 密码为加密格式`);
      const hash = bcrypt.hashSync(user.password, 10);
      updateUser(user.id, { password: hash });
    }
  });
};
