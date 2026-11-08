const { EventEmitter } = require('node:events');
const ORIGIN = 'https://yakcool.com';
const GATEWAY = 'https://aibalance.yaklang.com';
const COOKIE = 'yakcool_user_session';

function trustedGateway(value = GATEWAY) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443') ||
    !['', '/'].includes(url.pathname) ||
    !(url.hostname === 'aibalance.yaklang.com' || url.hostname.endsWith('.yaklang.com'))
  )
    throw Error('YAKCOOL 返回了不受信任的模型服务地址');
  return url.origin;
}
function validCookie(cookie) {
  return (
    cookie &&
    cookie.name === COOKIE &&
    ['yakcool.com', '.yakcool.com'].includes(cookie.domain) &&
    cookie.secure === true &&
    (!cookie.expirationDate || cookie.expirationDate > Date.now() / 1000) &&
    typeof cookie.value === 'string' &&
    /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]{1,4096}$/.test(cookie.value)
  );
}
function loginURLAllowed(value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === '443') &&
      ['yakcool.com', 'yaklang.com', 'weixin.qq.com', 'wx.qq.com'].some(
        (host) => u.hostname === host || u.hostname.endsWith('.' + host),
      )
    );
  } catch {
    return false;
  }
}

class YakcoolAccount extends EventEmitter {
  #cookie = null;
  #key = '';
  #refresh = null;
  #epoch = 0;
  #initialized = false;
  constructor({ sessionIO = null, request = fetch } = {}) {
    super();
    this.sessionIO = sessionIO;
    this.request = request;
    this.state = {
      authenticated: false,
      restoring: true,
      status: 'restoring',
      user: null,
      balance: null,
      error: null,
    };
    this.gateway = GATEWAY;
    this.models = [];
    this.verifiedAt = 0;
  }
  public() {
    return {
      ...this.state,
      models: this.models.map((m) => ({ id: m.id, name: m.name })),
      updatedAt: this.verifiedAt || null,
    };
  }
  publish(patch) {
    Object.assign(this.state, patch);
    this.emit('change', this.public());
  }
  redact(value) {
    let result = String(value || '');
    for (const secret of [this.#key, this.#cookie?.value])
      if (secret) result = result.replaceAll(secret, '[REDACTED]');
    return result.replace(/\b(?:sk-|yk-)[A-Za-z0-9_-]{12,}/g, '[REDACTED]');
  }
  async api(route, { cookie = this.#cookie, method = 'GET', body, signal } = {}) {
    if (!route.startsWith('/api/') || route.includes('://') || !validCookie(cookie))
      throw Error('请先登录 YAKCOOL 账户');
    const response = await this.request(ORIGIN + route, {
      method,
      redirect: 'error',
      signal: signal || AbortSignal.timeout(20000),
      headers: {
        Cookie: COOKIE + '=' + cookie.value,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Tutor/0.2.0',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const error = Error(
        [401, 403].includes(response.status)
          ? 'YAKCOOL 登录已过期，请重新扫码登录'
          : 'YAKCOOL 服务暂时不可用，请稍后重试',
      );
      error.status = response.status;
      throw error;
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > 5 * 1024 * 1024) throw Error('YAKCOOL 返回的数据过大');
    try {
      return JSON.parse(text);
    } catch {
      throw Error('YAKCOOL 返回的数据格式无效');
    }
  }
  async init() {
    if (this.#initialized || this.state.authenticated) return;
    this.#initialized = true;
    try {
      const saved = await this.sessionIO?.load();
      if (validCookie(saved)) {
        this.#cookie = saved;
        await this.refresh();
      } else {
        this.publish({ restoring: false, status: 'signed-out' });
      }
    } catch {
      this.publish({
        authenticated: false,
        restoring: false,
        status: this.#cookie ? 'unavailable' : 'signed-out',
        error: '暂时无法恢复 YAKCOOL 登录，请重试连接或重新扫码。',
      });
    }
  }
  signingIn() {
    if (!this.state.authenticated) this.publish({ status: 'signing-in', error: null });
  }
  cancelLogin(error = null) {
    if (!this.state.authenticated) this.publish({ status: 'signed-out', restoring: false, error });
  }
  async login(cookie) {
    if (!validCookie(cookie)) throw Error('不是有效的 YAKCOOL 公开用户会话');
    this.#epoch++;
    this.#cookie = {
      name: COOKIE,
      value: cookie.value,
      domain: cookie.domain,
      secure: true,
      ...(cookie.expirationDate ? { expirationDate: cookie.expirationDate } : {}),
    };
    this.#key = '';
    return this.refresh(true);
  }
  async refresh(persist = false) {
    if (!this.#cookie) {
      this.publish({ restoring: false, status: 'signed-out' });
      return this.public();
    }
    if (this.#refresh) return this.#refresh;
    const epoch = this.#epoch,
      cookie = this.#cookie;
    const wasConnected = this.state.authenticated && !!this.#key;
    this.#refresh = (async () => {
      try {
        const me = await this.api('/api/auth/me', { cookie });
        if (epoch !== this.#epoch) return this.public();
        if (me.staff_session || !me.user || me.user.id == null)
          throw Object.assign(Error('只接受 YAKCOOL 公开用户账户登录'), { status: 401 });
        const [dashboard, keyList] = await Promise.all([
          this.api('/api/user/dashboard', { cookie }),
          this.api('/api/user/api-keys', { cookie }),
        ]);
        if (epoch !== this.#epoch) return this.public();
        if (
          !dashboard.user ||
          String(dashboard.user.id) !== String(me.user.id) ||
          !Array.isArray(keyList.keys)
        )
          throw Error('YAKCOOL 账户数据格式无效');
        const gateway = trustedGateway(dashboard.gateway_url || GATEWAY);
        let key =
          keyList.keys.find(
            (k) => k.active === true && /^Tutor(?:\b|$)/i.test(k.label || '') && k.api_key,
          ) || keyList.keys.find((k) => k.active === true && k.api_key);
        if (!key) {
          // Login authorizes Tutor to provision its service credential when none exists.
          const created = await this.api('/api/user/api-keys', {
            cookie,
            method: 'POST',
            body: { label: 'Tutor' },
          });
          key = created.key;
        }
        if (
          !key?.api_key ||
          typeof key.api_key !== 'string' ||
          !/^[\x21-\x7E]{1,512}$/.test(key.api_key)
        )
          throw Error('账户暂时没有可用的模型凭据，请在 YAKCOOL 账户中确认服务状态后刷新。');
        if (epoch !== this.#epoch) return this.public();
        if (persist) await this.sessionIO?.save(cookie);
        if (epoch !== this.#epoch) return this.public();
        this.#key = key.api_key;
        this.gateway = gateway;
        const credit = dashboard.ai_service_credit || {};
        const remaining = credit.token_remaining,
          divisor = credit.weighted_tokens_per_rmb ?? 10000000;
        const balance =
          remaining != null &&
          Number.isFinite(Number(remaining)) &&
          Number(divisor) > 0 &&
          Number.isFinite(Number(divisor))
            ? Number(remaining) / Number(divisor)
            : null;
        this.verifiedAt = Date.now();
        this.publish({
          authenticated: true,
          restoring: false,
          status: 'connected',
          user: { id: String(me.user.id), name: String(me.user.display_name || 'YAKCOOL 用户') },
          balance,
          error: null,
          balanceStale: false,
        });
        try {
          const result = await this.api('/api/user/models', { cookie });
          if (epoch === this.#epoch)
            this.models = (result.models || [])
              .filter((m) => typeof m.model_id === 'string')
              .map((m) => ({ id: m.model_id, name: String(m.display_name || m.model_id) }));
        } catch {
          /* Catalogue availability does not invalidate the verified account. */
        }
        return this.public();
      } catch (error) {
        if (epoch !== this.#epoch) return this.public();
        const safeError = this.redact(error.message || 'YAKCOOL 连接失败，请重试');
        if ([401, 403].includes(error.status)) {
          this.#key = '';
          this.#cookie = null;
          await this.sessionIO?.clear();
        } else if (wasConnected && validCookie(cookie)) {
          this.publish({
            restoring: false,
            balanceStale: true,
            error: '余额暂时无法刷新，可稍后重试。',
          });
          throw Object.assign(Error(safeError), { status: error.status });
        }
        this.#key = '';
        this.publish({
          authenticated: false,
          restoring: false,
          status: this.#cookie ? 'unavailable' : 'signed-out',
          user: null,
          balance: null,
          error: safeError,
        });
        throw Object.assign(Error(safeError), { status: error.status });
      } finally {
        this.#refresh = null;
      }
    })();
    return this.#refresh;
  }
  async requireLogin({ fresh = false } = {}) {
    if (this.state.authenticated && !validCookie(this.#cookie)) await this.logout();
    if (fresh && this.#cookie && this.state.authenticated && Date.now() - this.verifiedAt > 60000)
      await this.refresh();
    if (!this.state.authenticated || !this.#key || !validCookie(this.#cookie))
      throw Object.assign(Error('请先登录 YAKCOOL 账户后使用 Tutor'), { status: 401 });
  }
  credentials() {
    if (!this.state.authenticated || !this.#key) throw Error('请先登录 YAKCOOL 账户');
    return { yakcool: this.#key };
  }
  async logout() {
    const cookie = this.#cookie;
    this.#epoch++;
    this.#cookie = null;
    this.#key = '';
    this.models = [];
    this.verifiedAt = 0;
    this.publish({
      authenticated: false,
      restoring: false,
      status: 'signed-out',
      user: null,
      balance: null,
      error: null,
    });
    await this.sessionIO?.clear();
    if (validCookie(cookie))
      this.api('/api/auth/logout', { cookie, method: 'POST' }).catch(() => {});
    return this.public();
  }
}
module.exports = {
  YakcoolAccount,
  ORIGIN,
  GATEWAY,
  COOKIE,
  validCookie,
  loginURLAllowed,
  trustedGateway,
};
