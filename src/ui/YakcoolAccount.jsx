import { useEffect, useState } from 'react';
import {
  Clapperboard,
  BookOpen,
  LoaderCircle,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { api } from './workbench';
import { useGuide } from './GuideProvider';

export const balanceText = (value) =>
  value == null
    ? '—'
    : '¥' + value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export default function YakcoolBoundary({ children }) {
  const { openGuide } = useGuide();
  const [account, setAccount] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let active = true,
      timer;
    const poll = async () => {
      try {
        const state = await api('/api/account');
        if (active) {
          setAccount(state);
          setError('');
        }
      } catch {
        if (active) setError('无法连接本地工作台，请重新启动 Tutor。');
      }
      if (active) timer = setTimeout(poll, 1000);
    };
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!account?.authenticated) return;
    const timer = setInterval(
      () =>
        api('/api/account/refresh', {})
          .then(setAccount)
          .catch(() => {}),
      60000,
    );
    return () => clearInterval(timer);
  }, [account?.authenticated]);
  const refresh = async () => {
    setPending(true);
    setError('');
    try {
      setAccount(await api('/api/account/refresh', {}));
    } catch (error) {
      setError(error.message);
      setAccount(await api('/api/account'));
    } finally {
      setPending(false);
    }
  };
  const logout = async () => {
    setPending(true);
    try {
      setAccount(await api('/api/account/logout', {}));
    } catch (error) {
      setError(error.message);
    } finally {
      setPending(false);
    }
  };
  const login = async () => {
    setError('');
    setPending(true);
    try {
      if (!window.tutorDesktop?.loginYakcool)
        throw Error('请打开 Tutor 桌面版，使用 YAKCOOL 官方扫码登录。');
      await window.tutorDesktop.loginYakcool();
    } catch (error) {
      setError(error.message);
    } finally {
      setPending(false);
    }
  };
  if (account?.authenticated)
    return children({ account, refreshAccount: refresh, logout, accountPending: pending });
  const restoring = !account || account.restoring;
  return (
    <main className="yakcool-login-screen">
      <div className="yakcool-login-brand">
        <Clapperboard size={25} />
        <strong>
          Tutor<span>studio</span>
        </strong>
      </div>
      <section className="yakcool-login-card">
        <div className="yakcool-login-icon">
          <ShieldCheck size={30} />
        </div>
        <span className="yakcool-eyebrow">YAKCOOL ACCOUNT</span>
        <h1>登录，开始制作你的教程。</h1>
        <p>使用 YAKCOOL 账户连接模型服务。扫码成功后即可导入视频、共同改稿和制作成片。</p>
        <Button size="lg" onClick={login} disabled={pending || restoring}>
          {pending || restoring ? (
            <LoaderCircle className="animate-spin" size={17} />
          ) : (
            <LogIn size={17} />
          )}
          {restoring
            ? '正在恢复登录…'
            : account?.status === 'signing-in'
              ? '打开扫码登录窗口'
              : '登录 YAKCOOL'}
        </Button>
        {account?.status === 'signing-in' && (
          <p className="yakcool-login-status">
            请在官方窗口确认用户协议，再用微信扫码。登录成功后自动进入工作台。
          </p>
        )}
        {(error || account?.error) && (
          <p className="yakcool-account-error" role="alert">
            {error || account.error}
          </p>
        )}
        {account?.status === 'unavailable' && (
          <Button variant="ghost" disabled={pending} onClick={refresh}>
            <RefreshCw size={14} /> 重试连接
          </Button>
        )}
        <div className="yakcool-login-note">
          <ShieldCheck size={14} /> 官方扫码登录 · 凭据由系统安全存储保护
        </div>
      </section>
      <button className="login-guide-open" onClick={() => openGuide()}>
        <BookOpen size={14} /> 查看功能导览与使用步骤
      </button>
      <span className="yakcool-login-footer">Tutor · 把操作录像，整理成清晰的教程。</span>
    </main>
  );
}
export function YakcoolAccountCard({ account, refreshAccount, logout, accountPending }) {
  return (
    <section className="yakcool-account-card" aria-label="YAKCOOL 账户">
      <div className="yakcool-account-heading">
        <span className="yakcool-account-avatar">{Array.from(account.user.name)[0]}</span>
        <div>
          <strong title={account.user.name}>{account.user.name}</strong>
          <small>YAKCOOL 已连接</small>
        </div>
        <button
          title="退出 YAKCOOL 账户"
          aria-label="退出 YAKCOOL 账户"
          disabled={accountPending}
          onClick={logout}
        >
          <LogOut size={14} />
        </button>
      </div>
      <div className="yakcool-account-balance">
        <span>
          <Wallet size={13} /> 账户余额
        </span>
        <button
          aria-label="刷新账户余额"
          title="刷新账户余额"
          disabled={accountPending}
          onClick={refreshAccount}
        >
          <RefreshCw size={12} className={accountPending ? 'animate-spin' : ''} />
        </button>
      </div>
      <strong className="yakcool-balance-value">{balanceText(account.balance)}</strong>
      {account.balance == null && <small>余额暂不可用，可稍后刷新</small>}
      {account.balanceStale && <small>余额刷新失败，可稍后重试</small>}
    </section>
  );
}
