import { AlertTriangle, Copy, Settings2, History } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './components/ui/button';
import { errorInfo, projectFailure } from '../diagnostics.mjs';

const time = (value) => (value ? new Date(value).toLocaleString() : '未记录');
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('排查信息已复制');
  } catch {
    toast.error('复制失败，请选择下方错误文本手动复制。');
  }
}
function diagnosticText(project, failure) {
  return [
    'Tutor 任务排查信息',
    '项目 ID：' + project.id,
    '剧本版本：' + project.revision,
    '剧本哈希：' + (project.scriptHash || '未生成'),
    '失败时间：' + time(failure.at),
    '任务：' + (failure.task || '未记录'),
    '阶段：' + failure.stage,
    '模型：' + (failure.model || '未记录'),
    '源：' + (failure.source || '未记录'),
    '接口：' + (failure.endpoint || '未记录'),
    'HTTP：' + (failure.httpStatus || '未记录'),
    '错误码：' + (failure.code || '未记录'),
    '请求 ID：' + (failure.requestId || '未记录'),
    '\n原始错误：\n' + failure.message,
  ].join('\n');
}
export default function FailurePanel({ project, openSettings, showActivity, requestError }) {
  const failure = requestError
    ? { ...errorInfo(requestError.message, requestError), ...requestError, cancelled: false }
    : projectFailure(project);
  if (!failure) return null;
  return (
    <section
      className={'failure-panel' + (failure.cancelled ? ' cancelled' : '')}
      role="alert"
      aria-label="任务错误详情"
    >
      <div className="failure-heading">
        <AlertTriangle size={20} aria-hidden="true" />
        <div>
          <h3>{failure.cancelled ? '任务已取消' : failure.title || '任务失败'}</h3>
          <p>
            {failure.cancelled ? '本次任务已停止，可检查当前内容后重新开始。' : failure.summary}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => copy(diagnosticText(project, failure))}>
          <Copy size={13} /> 复制排查信息
        </Button>
      </div>
      <dl className="failure-meta">
        <div>
          <dt>失败阶段</dt>
          <dd>{failure.stage}</dd>
        </div>
        <div>
          <dt>模型</dt>
          <dd>{failure.model || '未记录'}</dd>
        </div>
        {failure.source && (
          <div>
            <dt>模型源</dt>
            <dd>{failure.source}</dd>
          </div>
        )}
        <div>
          <dt>错误码</dt>
          <dd>
            {[failure.httpStatus && 'HTTP ' + failure.httpStatus, failure.code]
              .filter(Boolean)
              .join(' · ') || '未返回'}
          </dd>
        </div>
        <div>
          <dt>发生时间</dt>
          <dd>{time(failure.at)}</dd>
        </div>
        {failure.requestId && (
          <div className="failure-wide">
            <dt>请求 ID</dt>
            <dd>{failure.requestId}</dd>
          </div>
        )}
        {failure.endpoint && (
          <div className="failure-wide">
            <dt>请求接口</dt>
            <dd>{failure.endpoint}</dd>
          </div>
        )}
      </dl>
      <div className="failure-raw">
        <span>原始错误</span>
        <pre tabIndex={0}>{failure.raw}</pre>
      </div>
      {!failure.cancelled && <p className="failure-hint">{failure.hint}</p>}
      <div className="failure-actions">
        <Button variant="outline" size="sm" onClick={openSettings}>
          <Settings2 size={13} /> 检查模型与 Key
        </Button>
        <Button variant="ghost" size="sm" onClick={showActivity}>
          <History size={13} /> 查看失败调用记录
        </Button>
      </div>
    </section>
  );
}

export function RequestFailures({ records = [] }) {
  const failures = records.filter((record) => record.error).toReversed();
  if (!failures.length) return null;
  return (
    <section className="request-failures" aria-label="失败调用记录">
      <h3>
        失败调用记录 <span>{failures.length} 次</span>
      </h3>
      <p>按最近一次优先排列，保留每次失败的模型、错误与请求 ID。</p>
      {failures.map((record) => {
        const info = errorInfo(record.error, record.error_details);
        return (
          <details key={record.id}>
            <summary>
              <AlertTriangle size={14} />
              <span>
                <strong>
                  {record.stage} · {record.model}
                </strong>
                <small>
                  {time(record.at)} · {info.httpStatus ? 'HTTP ' + info.httpStatus : '请求失败'}{' '}
                  {info.code}
                </small>
              </span>
              <span className="request-expand">展开详情</span>
            </summary>
            <div className="request-failure-body">
              <p>{info.summary}</p>
              {info.requestId && <p>请求 ID：{info.requestId}</p>}
              {record.error_details?.endpoint && <p>接口：{record.error_details.endpoint}</p>}
              <pre tabIndex={0}>{info.raw}</pre>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  copy(
                    JSON.stringify(
                      {
                        stage: record.stage,
                        model: record.model,
                        at: record.at,
                        error: record.error,
                        details: record.error_details,
                      },
                      null,
                      2,
                    ),
                  )
                }
              >
                <Copy size={13} /> 复制这次调用
              </Button>
            </div>
          </details>
        );
      })}
    </section>
  );
}
