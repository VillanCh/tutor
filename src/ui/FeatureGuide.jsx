import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Clapperboard,
  FileText,
  History,
  Layers3,
  MessageSquare,
  Play,
  ShieldCheck,
  Sparkles,
  Video,
  X,
  Download,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';
import { GUIDE_FEATURES, GUIDE_GROUPS } from '../guide-content.mjs';
import { WATERMARK_STYLES } from '../branding-options.mjs';

// Visual references: ReactBits Pro Bento Builder, Bento 16 (layers), Bento 42 (comparison).
// This guide uses Tutor-specific content and interactions, with no copied vendor source.
const ICONS = {
  video: Video,
  chat: MessageSquare,
  book: BookOpen,
  shield: ShieldCheck,
  brand: Layers3,
  export: Download,
  history: History,
};

function FeatureVisual({ feature }) {
  if (feature.visual === 'files')
    return (
      <div className="guide-file-visual" aria-hidden="true">
        <div className="guide-film guide-film-back">
          <Video size={17} />
          <span>03 / 验证结果</span>
          <i />
        </div>
        <div className="guide-film guide-film-middle">
          <Video size={17} />
          <span>02 / 操作过程</span>
          <i />
        </div>
        <div className="guide-film guide-film-front">
          <span className="guide-film-play">
            <Play size={22} fill="currentColor" />
          </span>
          <span>
            01 / 准备工作<small>多段录像，共同编排</small>
          </span>
          <span className="guide-film-bars">▂ ▅ ▃ ▆ ▄ ▂</span>
        </div>
        <div className="guide-file-footer">
          <Check size={11} /> 导入检查 <span>→</span> 排序 <span>→</span> 生成分镜
        </div>
      </div>
    );
  if (feature.visual === 'chat')
    return (
      <div className="guide-chat-visual" aria-hidden="true">
        <span>示例要求</span>
        <p>先展示结果，再讲操作。</p>
        <small>
          <Sparkles size={11} /> 让修改要求落到具体分镜
        </small>
      </div>
    );
  if (feature.visual === 'notes')
    return (
      <div className="guide-notes-visual" aria-hidden="true">
        <FileText size={19} />
        <span>
          教学目标.md<small>术语 / 受众 / 事实边界</small>
        </span>
        <Check size={13} />
      </div>
    );
  if (feature.visual === 'review')
    return (
      <div className="guide-review-visual" aria-hidden="true">
        {['对照画面', '核对提示', '确认制作'].map((step, i) => (
          <span key={step}>
            <i>{i + 1}</i>
            {step}
          </span>
        ))}
      </div>
    );
  if (feature.visual === 'brand')
    return (
      <div className="guide-brand-visual" aria-hidden="true">
        <span>清晰的教学内容</span>
        <div className="guide-brand-pattern">
          TUTOR · 品牌 TUTOR · 品牌
          <br />
          TUTOR · 品牌 TUTOR · 品牌
        </div>
        <small>{WATERMARK_STYLES.tiled.opacity}% 不透明度 · 轻盈水印</small>
      </div>
    );
  if (feature.visual === 'timeline')
    return (
      <div className="guide-timeline-visual" aria-hidden="true">
        <div className="guide-export-film">
          <Play size={22} />
          <span>
            成片预览<small>配音 · 字幕 · 章节</small>
          </span>
          <span>MP4</span>
        </div>
        <div className="guide-export-track">
          <i>片头</i>
          <i>第一章</i>
          <i>第二章</i>
          <i>片尾</i>
        </div>
        <div className="guide-export-files">
          <span>
            <FileText size={12} /> 字幕 SRT
          </span>
          <span>
            <FileText size={12} /> 剧本 JSON
          </span>
          <span>
            <Layers3 size={12} /> 剪辑时间表
          </span>
        </div>
      </div>
    );
  return (
    <div className="guide-recovery-visual" aria-hidden="true">
      <span>
        <i />
        <strong>本机草稿</strong>
        <small>继续编辑</small>
      </span>
      <div>
        <Check size={12} /> 素材已保留
        <ChevronRight size={11} />
        <History size={12} /> 从当前步骤继续
      </div>
    </div>
  );
}

export default function FeatureGuide({ open, firstRun, initialFeature, onClose }) {
  const [group, setGroup] = useState('all');
  const [selected, setSelected] = useState(null);
  const scrollRef = useRef(null);
  const overviewScroll = useRef(0);
  const reduceMotion = useReducedMotion();
  const feature = GUIDE_FEATURES.find((item) => item.id === selected);
  useEffect(() => {
    if (!open) return;
    setGroup('all');
    setSelected(initialFeature || null);
    overviewScroll.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [open, initialFeature]);
  const inspect = (id) => {
    overviewScroll.current = scrollRef.current?.scrollTop || 0;
    setSelected(id);
    scrollRef.current?.scrollTo({ top: 0 });
  };
  const overview = () => {
    setSelected(null);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: overviewScroll.current }));
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="feature-guide" showCloseButton={false}>
        <header className="feature-guide-header">
          <div className="guide-wordmark">
            <span>
              <Clapperboard size={20} />
            </span>
            <strong>
              Tutor <small>studio</small>
            </strong>
            <i />
            <span>功能导览</span>
          </div>
          <div className="guide-header-actions">
            <span>随时回来，接着了解</span>
            <Button variant="ghost" size="sm" className="guide-dismiss" onClick={() => onClose()}>
              {firstRun ? '稍后了解' : '返回工作台'}
              <X size={14} />
            </Button>
          </div>
        </header>
        <div className="feature-guide-scroll" ref={scrollRef}>
          {!feature ? (
            <>
              <div className="guide-intro">
                <div>
                  <span className="guide-eyebrow">
                    {firstRun ? '从这里，开始第一节教程' : '需要的时候，找到下一步'}
                  </span>
                  <DialogTitle>
                    从一段录屏，<span>到一节讲得清楚的教程。</span>
                  </DialogTitle>
                  <DialogDescription>
                    先了解能做什么，再按步骤开始。每张卡片都有具体用法，也能直接带你进入对应操作。
                  </DialogDescription>
                </div>
                <nav className="guide-workflow" aria-label="教程制作路径">
                  {[
                    ['import', '导入'],
                    ['chat', '改稿'],
                    ['review', '审核'],
                    ['export', '导出'],
                  ].map(([id, label], i) => (
                    <button type="button" key={id} onClick={() => inspect(id)}>
                      <small>0{i + 1}</small>
                      {label}
                      {i < 3 && <ArrowRight size={12} />}
                    </button>
                  ))}
                </nav>
              </div>
              <div className="guide-feature-toolbar">
                <div role="group" aria-label="筛选导览功能">
                  {GUIDE_GROUPS.map(([id, label]) => (
                    <button
                      type="button"
                      key={id}
                      aria-pressed={group === id}
                      onClick={() => {
                        setGroup(id);
                        overviewScroll.current = 0;
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span>
                  {group === 'all'
                    ? GUIDE_FEATURES.length
                    : GUIDE_FEATURES.filter((item) => item.group === group).length}{' '}
                  项功能 · 按需了解
                </span>
              </div>
              <div
                className={'guide-bento-grid ' + (group !== 'all' ? 'is-filtered' : '')}
                aria-label="Tutor 功能 Bento"
              >
                {GUIDE_FEATURES.filter((item) => group === 'all' || item.group === group).map(
                  (item, index) => {
                    const Icon = ICONS[item.icon];
                    return (
                      <motion.article
                        key={item.id}
                        className={'guide-bento-card guide-bento-' + item.id}
                        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.22, delay: Math.min(index * 0.025, 0.12) }}
                      >
                        <div className="guide-card-copy">
                          <div className="guide-card-eyebrow">
                            <Icon size={14} />
                            <span>{item.eyebrow}</span>
                          </div>
                          <h3>{item.title}</h3>
                          <p>{item.short}</p>
                        </div>
                        <FeatureVisual feature={item} />
                        <div className="guide-card-bottom">
                          <div>
                            {item.tags.slice(0, 2).map((tag) => (
                              <span key={tag}>{tag}</span>
                            ))}
                          </div>
                          <button
                            type="button"
                            data-guide-feature={item.id}
                            onClick={() => inspect(item.id)}
                          >
                            查看怎么用
                            <ArrowRight size={13} />
                          </button>
                        </div>
                      </motion.article>
                    );
                  },
                )}
              </div>
            </>
          ) : (
            <>
              <button className="guide-back" onClick={overview}>
                <ArrowLeft size={14} /> 返回功能总览
              </button>
              <div className="guide-detail-layout">
                <nav className="guide-detail-nav" aria-label="功能用法列表">
                  {GUIDE_FEATURES.map((item) => {
                    const Icon = ICONS[item.icon];
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-current={selected === item.id ? 'page' : undefined}
                        onClick={() => {
                          setSelected(item.id);
                          scrollRef.current?.scrollTo({ top: 0 });
                        }}
                      >
                        <Icon size={15} />
                        <span>{item.eyebrow.replace(/^\d+ \/ /, '')}</span>
                        <ChevronRight size={12} />
                      </button>
                    );
                  })}
                </nav>
                <article className="guide-detail" data-guide-detail={feature.id}>
                  <span className="guide-eyebrow">{feature.eyebrow}</span>
                  <DialogTitle>{feature.title}</DialogTitle>
                  <DialogDescription>{feature.purpose}</DialogDescription>
                  <ol className="guide-detail-steps">
                    {feature.steps.map(([title, description], index) => (
                      <li key={title}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <div>
                          <h3>{title}</h3>
                          <p>{description}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <div className="guide-detail-examples">
                    <h3>可以这样用</h3>
                    {feature.examples.map((example) => (
                      <div key={example}>
                        <span>{example}</span>
                        {feature.id === 'chat' && (
                          <button type="button" onClick={() => onClose(feature.id, example)}>
                            放入对话草稿
                            <ArrowRight size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="guide-detail-note">
                    <BookOpen size={15} />
                    {feature.note}
                  </p>
                  <div className="guide-detail-actions">
                    <Button className="guide-feature-action" onClick={() => onClose(feature.id)}>
                      {feature.action}
                      <ArrowRight size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSelected(feature.next);
                        scrollRef.current?.scrollTo({ top: 0 });
                      }}
                    >
                      继续了解下一项
                      <ChevronRight size={13} />
                    </Button>
                  </div>
                </article>
              </div>
            </>
          )}
        </div>
        <footer className="feature-guide-footer">
          <span>
            <BookOpen size={14} /> 右上角「功能导览」或 F1，随时查看用法。
          </span>
          <Button className="guide-start" onClick={() => onClose(firstRun ? 'import' : undefined)}>
            {firstRun ? '开始制作第一节教程' : '返回工作台'}
            <ArrowRight size={14} />
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
