import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { editorModelOptions, isBlockedModel } from '../model-policy.mjs';

export default function ModelPicker({ value, onChange, models, disabled, id }) {
  const listId = useId();
  const root = useRef(null);
  const input = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const options = editorModelOptions(models);
  const filtered = options.filter((model) =>
    (model.id + ' ' + model.name).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const openList = () => {
    setQuery('');
    setActive(
      Math.max(
        0,
        options.findIndex((model) => model.id === value),
      ),
    );
    setOpen(true);
  };
  const select = (model) => {
    onChange(model.id);
    setOpen(false);
    setQuery('');
    input.current?.focus();
  };
  useEffect(() => {
    if (open)
      root.current?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open, query]);
  return (
    <div
      className="model-picker"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setQuery('');
        }
      }}
    >
      <div className="model-picker-input">
        <Search size={14} aria-hidden="true" />
        <input
          id={id}
          ref={input}
          role="combobox"
          aria-label="剧本改写模型"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && filtered[active] ? listId + '-' + active : undefined}
          autoComplete="off"
          value={open ? query : value}
          placeholder={value || '搜索可用的剧本模型'}
          disabled={disabled}
          onFocus={openList}
          onClick={() => {
            if (!open) openList();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
              event.preventDefault();
              if (!open) openList();
              else
                setActive((index) =>
                  filtered.length
                    ? (index + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) %
                      filtered.length
                    : 0,
                );
            } else if (event.key === 'Enter' && open) {
              event.preventDefault();
              if (filtered[active]) select(filtered[active]);
            } else if (event.key === 'Escape' && open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              setQuery('');
            }
          }}
        />
        <button
          type="button"
          aria-label="展开剧本模型列表"
          aria-expanded={open}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            input.current?.focus();
            if (open) setOpen(false);
            else openList();
          }}
        >
          <ChevronDown size={15} />
        </button>
      </div>
      {open && (
        <div className="model-picker-results">
          <div
            role="listbox"
            id={listId}
            aria-label="可用剧本模型"
            className="model-picker-options"
          >
            {filtered.map((model, index) => (
              <div
                key={model.id}
                role="option"
                id={listId + '-' + index}
                aria-selected={model.id === value}
                data-active={index === active}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(model)}
              >
                <span>
                  <strong>{model.id}</strong>
                  <small>{model.name}</small>
                </span>
                {model.recommended && <span className="model-recommended">推荐</span>}
                {model.id === value && <Check size={14} aria-hidden="true" />}
              </div>
            ))}
          </div>
          {!filtered.length && (
            <p role="status">
              {isBlockedModel(query)
                ? '此模型已停用，请选择其他剧本模型。'
                : '没有匹配的可用模型，试试其他名称。'}
            </p>
          )}
          <small className="model-picker-help">输入名称筛选，↑ ↓ 选择，Enter 确认</small>
        </div>
      )}
    </div>
  );
}
