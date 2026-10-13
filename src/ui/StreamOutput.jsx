import { useEffect, useRef, useState } from 'react';
import { Check, Code2, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './components/ui/button';

export default function StreamOutput({ text, stage, estimate }) {
  const content = useRef(null);
  const follows = useRef(true);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (follows.current && content.current)
      content.current.scrollTop = content.current.scrollHeight;
  }, [text]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <section className="stream-code" aria-label="模型中间输出代码框">
      <div className="stream-code-bar">
        <span>
          <Code2 size={13} /> 中间输出 <i>JSON · 流式</i>
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="复制模型中间输出"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              toast.error('无法复制，请在代码框中选择文本');
            }
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </Button>
      </div>
      <pre
        ref={content}
        onScroll={(e) => {
          const el = e.currentTarget;
          follows.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        <code>{text}</code>
      </pre>
      <div className="stream-code-foot">
        <span>{stage}</span>
        <span>约 {estimate || 0} Token</span>
      </div>
    </section>
  );
}
