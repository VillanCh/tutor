const { EventEmitter } = require('node:events');
const { GATEWAY } = require('../../src/yakcool.cjs');
class TestAccount extends EventEmitter {
  constructor(authenticated = true) {
    super();
    this.authenticated = authenticated;
    this.gateway = GATEWAY;
    this.balance = 12.5;
    this.models = [
      { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
      { id: 'qwen3.8-flash', name: 'Qwen Flash' },
      { id: 'qwen3.8-max', name: 'Qwen Max' },
    ];
  }
  async init() {}
  public() {
    return {
      authenticated: this.authenticated,
      restoring: false,
      status: this.authenticated ? 'connected' : 'signed-out',
      user: this.authenticated ? { id: 'test-account', name: '测试账户' } : null,
      balance: this.authenticated ? this.balance : null,
      models: this.authenticated ? this.models : [],
      error: null,
    };
  }
  async requireLogin() {
    if (!this.authenticated)
      throw Object.assign(Error('请先登录 YAKCOOL 账户后使用 Tutor'), { status: 401 });
  }
  credentials() {
    if (!this.authenticated) throw Error('请先登录 YAKCOOL 账户');
    return { yakcool: 'unit-test-private-key' };
  }
  redact(text) {
    return String(text).replaceAll('unit-test-private-key', '[REDACTED]');
  }
  signIn() {
    this.authenticated = true;
    this.emit('change', this.public());
  }
  async refresh() {
    this.refreshCalls = (this.refreshCalls || 0) + 1;
    return this.public();
  }
  async logout() {
    this.authenticated = false;
    this.emit('change', this.public());
    return this.public();
  }
}
async function confirmModels(store) {
  await store.settings(store.publicConfig().config, undefined, true);
}
module.exports = { TestAccount, confirmModels };
