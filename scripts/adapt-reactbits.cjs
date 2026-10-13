// Business adapters are generated from the licensed, installed JSX. This file
// contains Tutor integration logic, never a copy of ReactBits component source.
const fs = require('node:fs/promises');
const path = require('node:path');
const parser = require('@babel/parser');
const generate = require('@babel/generator').default;
const root = path.resolve(__dirname, '../src/ui/vendor');
const parse = (source) => parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
const expression = (source) => parser.parseExpression(source, { plugins: ['jsx'] });
const slot = (name) => ({ type: 'JSXExpressionContainer', expression: expression(name) });
const text = (value) => ({ type: 'StringLiteral', value });

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (
      ['loc', 'start', 'end', 'extra', 'comments', 'leadingComments', 'trailingComments'].includes(
        key,
      )
    )
      continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
const jsxName = (node) =>
  node?.type === 'JSXIdentifier'
    ? node.name
    : node?.type === 'JSXMemberExpression'
      ? jsxName(node.object) + '.' + jsxName(node.property)
      : '';
function attribute(node, name, value) {
  const attrs = node.openingElement.attributes;
  const existing = attrs.find((a) => a.name?.name === name);
  const attr = { type: 'JSXAttribute', name: { type: 'JSXIdentifier', name }, value };
  if (existing) Object.assign(existing, attr);
  else attrs.push(attr);
}
const prop = (node, name, source) => attribute(node, name, slot(source));
function replaceNode(node, source) {
  const replacement = expression(source);
  for (const key of Object.keys(node)) delete node[key];
  Object.assign(node, replacement);
}
function find(node, predicate) {
  let found;
  walk(node, (item) => {
    if (!found && predicate(item)) found = item;
  });
  if (!found)
    throw Error('ReactBits adapter cannot find expected JSX. Please review the installed version.');
  return found;
}
function strings(node, mapping) {
  walk(node, (item) => {
    if (item.type === 'JSXText' && mapping[item.value.trim()])
      item.value = mapping[item.value.trim()];
  });
}
function classReplace(node, from, to) {
  walk(node, (item) => {
    if (
      item.type === 'JSXAttribute' &&
      item.name?.name === 'className' &&
      item.value?.type === 'StringLiteral'
    ) {
      item.value.value = item.value.value.replaceAll(from, to);
    }
    if (item.type === 'StringLiteral') item.value = item.value.replaceAll(from, to);
  });
}

async function adapt(name, params, prefix, transform) {
  const source = await fs.readFile(path.join(root, name + '.jsx'), 'utf8');
  const ast = parse(source);
  const exported = ast.program.body.find((n) => n.type === 'ExportDefaultDeclaration');
  const fn = exported?.declaration;
  if (fn?.type !== 'FunctionDeclaration') throw Error('Unexpected ReactBits export: ' + name);
  const originalReturn = fn.body.body.find((n) => n.type === 'ReturnStatement');
  const body = parse('function Adapter(' + params + ') {' + prefix + '}').program.body[0];
  const returned = transform(originalReturn.argument);
  fn.params = body.params;
  fn.body.body = [...body.body.body, { type: 'ReturnStatement', argument: returned }];
  const output = path.join(root, 'tutor', name + '.jsx');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(
    output,
    '// Derived locally from licensed ReactBits Pro ' +
      name +
      '.\n' +
      generate(ast, { jsescOption: { minimal: true } }).code +
      '\n',
  );
}

async function main() {
  await adapt(
    'ai-chat-2',
    '{ messages = [], busy, liveContent, header, welcome, placeholder, disabled, onSend, onCancel, onAttach, onArtifact, draftOffer }',
    `
    const transcript = useScrollFade();
    const { showJump, jumpToLatest } = useStickToBottom(transcript.ref);
    const textareaRef = useRef(null);
    const [value, setValue] = useState('');
    const streaming = Boolean(busy);
    const LIVE_ID = 'live';
    useEffect(() => { if (draftOffer) { setValue(draftOffer.text); textareaRef.current?.focus(); } }, [draftOffer]);
    const autosize = () => { const el = textareaRef.current; if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px'; } };
    const handleSend = (draft) => { if (disabled || busy || !draft.trim()) return; onSend(draft.trim()); setValue(''); };
    const handleStop = () => onCancel?.();
  `,
    (original) => {
      const result = original.children.find((n) => n.type === 'JSXElement');
      attribute(result, 'className', text('relative flex h-full min-h-0 min-w-0 flex-col'));
      const headerIndex = result.children.findIndex(
        (n) => n.type === 'JSXElement' && jsxName(n.openingElement.name) === 'header',
      );
      result.children[headerIndex] = slot('header');
      const messages = find(
        result,
        (n) => n.type === 'CallExpression' && n.callee?.object?.name === 'messages',
      );
      const list = find(
        result,
        (n) =>
          n.type === 'JSXElement' &&
          n.children.some((c) => c.type === 'JSXExpressionContainer' && c.expression === messages),
      );
      list.children.unshift(slot('welcome'));
      classReplace(list, 'mt-auto ', '');
      const streamed = find(
        result,
        (n) =>
          n.type === 'ConditionalExpression' &&
          n.test?.name === 'live' &&
          n.consequent?.type === 'JSXElement',
      );
      const streamParagraph = find(
        result,
        (n) =>
          n.type === 'JSXElement' &&
          n.children.some(
            (child) => child.type === 'JSXExpressionContainer' && child.expression === streamed,
          ),
      );
      streamParagraph.openingElement.name.name = 'div';
      streamParagraph.closingElement.name.name = 'div';
      streamed.consequent = expression('liveContent');
      walk(result, (n) => {
        if (n.type === 'LogicalExpression' && n.left?.name === 'settled')
          replaceNode(n, 'message.actions || null');
        if (n.type === 'JSXElement') {
          const name = jsxName(n.openingElement.name);
          const label = n.openingElement.attributes.find((a) => a.name?.name === 'aria-label')
            ?.value?.value;
          if (label === 'Add attachment') {
            prop(n, 'onClick', 'onAttach');
            attribute(n, 'aria-label', text('添加知识资料'));
            prop(n, 'disabled', 'busy');
          }
          if (label === 'Send') {
            prop(n, 'disabled', 'disabled || !value.trim()');
            attribute(n, 'aria-label', text('发送修改要求'));
          }
          if (label === 'Stop generating') attribute(n, 'aria-label', text('停止当前任务'));
          if (name === 'textarea') {
            prop(n, 'placeholder', 'placeholder');
            prop(n, 'disabled', 'disabled || busy');
            attribute(n, 'aria-label', text('修改剧本要求'));
            prop(
              n,
              'onKeyDown',
              `(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend(value); } }`,
            );
          }
          const handler = n.openingElement.attributes.find((a) => a.name?.name === 'onClick');
          if (
            handler?.value?.expression?.type === 'ArrowFunctionExpression' &&
            generate(handler.value.expression).code.includes('setTab')
          )
            prop(n, 'onClick', 'onArtifact');
        }
      });
      strings(result, { 'Open in panel': '查看剧本', 'Jump to latest': '回到最新消息' });
      return result;
    },
  );
  await adapt(
    'app-shell-9',
    '{ sidebar, header, children }',
    'const rootRef = useRef(null); const sidebarOpen = true;',
    (original) => {
      const wrapper = original.children.find((n) => n.type === 'JSXElement');
      const aside = wrapper.children.find(
        (n) => n.type === 'JSXElement' && jsxName(n.openingElement.name) === 'aside',
      );
      const sidebarPanel = aside.children.find((n) => n.type === 'JSXElement');
      sidebarPanel.children = [slot('sidebar')];
      const main = wrapper.children.find((n) => n.type === 'JSXElement' && n !== aside);
      main.children = [slot('header'), slot('children')];
      for (const [node, part] of [
        [original, 'root'],
        [wrapper, 'wrapper'],
        [aside, 'aside'],
        [sidebarPanel, 'sidebar'],
        [main, 'main'],
      ])
        attribute(node, 'data-tutor-shell', text(part));
      original.children = [wrapper];
      classReplace(original, 'min-h-[720px]', 'min-h-0');
      classReplace(original, 'w-72', 'w-[212px]');
      return original;
    },
  );
  await adapt(
    'wizard-1',
    '{ steps, step, onStep }',
    'const STEPS = steps; const setStep = onStep;',
    (original) => {
      const result = find(
        original,
        (n) => n.type === 'JSXElement' && jsxName(n.openingElement.name) === 'ol',
      );
      attribute(result, 'aria-label', text('教程制作流程'));
      walk(result, (n) => {
        if (n.type === 'JSXElement' && jsxName(n.openingElement.name) === 'button')
          prop(n, 'aria-label', '`第 ${i + 1} 步：${label}`');
      });
      return result;
    },
  );
  await adapt(
    'agent-approval-1',
    '{ title, description, request, busy, onApprove, onBack }',
    `
    const [showRequest, setShowRequest] = useState(false);
    const reduceMotion = useReducedMotion();
    const REQUEST_ARGS = request;
    const enter = reduceMotion ? {} : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2 } };
  `,
    (original) => {
      const result = find(
        original,
        (n) => n.type === 'JSXElement' && jsxName(n.openingElement.name) === 'motion.section',
      );
      const heading = find(
        result,
        (n) =>
          n.type === 'JSXElement' &&
          n.openingElement.attributes.some(
            (a) => a.name?.name === 'id' && a.value?.value === 'aa1-title',
          ),
      );
      heading.children = [slot('title')];
      const descriptionNode = find(
        result,
        (n) =>
          n.type === 'JSXElement' &&
          n.children.some((c) => c.type === 'JSXText' && c.value.includes('Frees 4.2 GB')),
      );
      descriptionNode.children = [slot('description')];
      walk(result, (n) => {
        if (n.type !== 'JSXElement' || jsxName(n.openingElement.name) !== 'button') return;
        const raw = n.children
          .filter((c) => c.type === 'JSXText')
          .map((c) => c.value)
          .join('')
          .trim();
        if (raw === 'Reject') {
          prop(n, 'onClick', 'onBack');
          n.children = [slot('"继续修改"')];
        }
        if (raw === 'Delete 12 projects') {
          prop(n, 'onClick', 'onApprove');
          prop(n, 'disabled', 'busy');
          n.children = [slot('busy ? "正在提交…" : "我确认，开始生成"')];
        }
      });
      walk(result, (n) => {
        if (n.type === 'StringLiteral') {
          if (n.value === 'Hide request') n.value = '收起制作详情';
          if (n.value === 'Show request') n.value = '查看制作详情';
        }
      });
      strings(result, { 'Needs approval': '等待你的确认' });
      return result;
    },
  );
  await adapt(
    'agent-activity-1',
    '{ steps = [], busy, elapsed = 0, title, onCancel }',
    `
    const feed = useScrollFade(); const STEPS = steps; const stopped = !busy;
    const stepElapsed = elapsed; const totalElapsed = elapsed;
    const fmt = (seconds) => seconds > 0 ? seconds.toFixed(1) + 's' : '已完成';
  `,
    (result) => {
      classReplace(result, 'min-h-[560px]', 'min-h-0');
      walk(result, (n) => {
        if (n.type === 'JSXElement' && jsxName(n.openingElement.name) === 'button')
          prop(n, 'onClick', 'onCancel');
      });
      const heading = find(
        result,
        (n) => n.type === 'JSXElement' && jsxName(n.openingElement.name) === 'h2',
      );
      heading.children = [slot('title')];
      walk(result, (n) => {
        if (n.type === 'StringLiteral') {
          if (n.value === 'Stopped') n.value = '已结束';
          if (n.value === 'Running') n.value = '正在执行';
        }
      });
      strings(result, { Stop: '停止任务' });
      return result;
    },
  );
  await adapt(
    'ai-usage-1',
    '{ records = [], totals: actualTotals }',
    `
    const [active, setActive] = useState(null); const range = '本次项目'; const setRange = () => {};
    const RANGES = ['本次项目'];
    const days = records.filter((r) => r.type !== 'download').map((r, i) => ({ label: String(i + 1), input: (r.input_tokens || 0) / 1000000, output: (r.output_tokens || 0) / 1000000, cost: r.estimated_cny }));
    if (!days.length) days.push({ label: '0', input: 0, output: 0, cost: 0 });
    const totals = { input: actualTotals.input, output: actualTotals.output, tokens: actualTotals.input + actualTotals.output, cost: actualTotals.cost };
    const max = Math.max(0.000001, ...days.map((d) => d.input + d.output));
    const shown = active === null ? null : days[active]; const shownCost = shown?.cost ?? null;
    const money = (n) => n === null ? '未返回用量' : '¥' + n.toFixed(4);
  `,
    (result) => {
      classReplace(result, 'min-h-[480px]', 'min-h-0');
      strings(result, {
        'Token usage': '模型调用与费用',
        'Input and output tokens billed to this workspace.':
          '每次调用的真实用量，费用按配置单价估算。',
        Input: '输入',
        Output: '输出',
      });
      walk(result, (n) => {
        if (n.type === 'StringLiteral') {
          if (n.value === 'Total tokens') n.value = '总 Token';
          if (n.value === 'Spend') n.value = '估算费用';
          if (n.value === 'Input') n.value = '输入';
          if (n.value === 'Output') n.value = '输出';
          if (n.value === 'Hover a bar for detail') n.value = '悬停或聚焦查看单次调用';
        }
        if (n.type === 'BinaryExpression' && n.operator === '/' && n.right?.name === 'total')
          n.right = expression('Math.max(total, 0.000001)');
        if (
          n.type === 'CallExpression' &&
          n.callee?.name === 'money' &&
          n.arguments[0]?.type === 'LogicalExpression' &&
          n.arguments[0].left?.name === 'shownCost'
        )
          n.arguments = [expression('shownCost')];
      });
      return result;
    },
  );
  console.log('已接入 ReactBits Pro：对话、应用框架、流程、人工审核、任务和真实用量。');
}
module.exports = { main };
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
