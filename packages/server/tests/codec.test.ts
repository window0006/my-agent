/**
 * Codec unit tests — pure functions, no DB / LangChain runtime.
 *
 * Run: `cd packages/server && node --experimental-strip-types --test tests/codec.test.ts`
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { safeParseJson } from '../src/codec/json.ts';
import { blocksToText, textToBlocks, parseThinkTags } from '../src/codec/content-block.ts';
import {
  baseMessageToMessage,
  normaliseContent,
  type LangChainMessage,
} from '../src/codec/langchain.ts';
import { ThinkTagParser, ToolCallAccumulator, StreamParser } from '../src/service/stream/parser.ts';

// ============================================================
// codec/json.ts
// ============================================================

describe('safeParseJson', () => {
  test('parses valid JSON', () => {
    assert.deepEqual(safeParseJson('{"a":1}'), { a: 1 });
    assert.deepEqual(safeParseJson('[1,2,3]'), [1, 2, 3]);
    assert.deepEqual(safeParseJson('"hi"'), 'hi');
  });
  test('returns {__raw} on bad JSON — original string preserved', () => {
    assert.deepEqual(safeParseJson('not json'), { __raw: 'not json' });
    assert.deepEqual(safeParseJson('{unclosed'), { __raw: '{unclosed' });
  });
});

// ============================================================
// codec/content-block.ts
// ============================================================

describe('blocksToText', () => {
  test('returns string input as-is', () => {
    assert.equal(blocksToText('hello'), 'hello');
  });
  test('flattens text blocks', () => {
    assert.equal(blocksToText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'ab');
  });
  test('renders reasoning as plain text', () => {
    assert.equal(blocksToText([{ type: 'reasoning', reasoning: 'thinking...' }]), 'thinking...');
  });
  test('renders tool_call as `[tool:name(args)]`', () => {
    assert.equal(
      blocksToText([{ type: 'tool_call', name: 'shell', args: { cmd: 'ls' } }]),
      '[tool:shell({"cmd":"ls"})]',
    );
  });
  test('renders image as [image] placeholder', () => {
    assert.equal(blocksToText([{ type: 'image', url: 'x' } as never]), '[image]');
  });
  test('handles mixed blocks in order', () => {
    const blocks = [
      { type: 'text' as const, text: 'I will ' },
      { type: 'reasoning' as const, reasoning: 'think' },
      { type: 'text' as const, text: ' and ' },
      { type: 'tool_call' as const, name: 'ls', args: {} },
    ];
    assert.equal(blocksToText(blocks), 'I will think and [tool:ls({})]');
  });
});

describe('textToBlocks', () => {
  test('wraps string in single text block', () => {
    assert.deepEqual(textToBlocks('hi'), [{ type: 'text', text: 'hi' }]);
  });
});

describe('parseThinkTags — M3 inline reasoning format', () => {
  test('no <think> tags → single text block', () => {
    assert.deepEqual(parseThinkTags('hello world'), [
      { type: 'text', text: 'hello world' },
    ]);
  });

  test('plain <think>...</think> → text + reasoning + text', () => {
    assert.deepEqual(parseThinkTags('before<think>inside</think>after'), [
      { type: 'text', text: 'before' },
      { type: 'reasoning', reasoning: 'inside' },
      { type: 'text', text: 'after' },
    ]);
  });

  test('only reasoning, no surrounding text', () => {
    assert.deepEqual(parseThinkTags('<think>just thinking</think>'), [
      { type: 'reasoning', reasoning: 'just thinking' },
    ]);
  });

  test('multiple think blocks in one string', () => {
    assert.deepEqual(parseThinkTags('a<think>one</think>b<think>two</think>c'), [
      { type: 'text', text: 'a' },
      { type: 'reasoning', reasoning: 'one' },
      { type: 'text', text: 'b' },
      { type: 'reasoning', reasoning: 'two' },
      { type: 'text', text: 'c' },
    ]);
  });

  test('unclosed <think> → rest treated as text (no data loss)', () => {
    // The text before the unclosed tag is kept as-is; the unclosed tag
    // itself + tail is also a text block (we don't drop data).
    assert.deepEqual(parseThinkTags('hello<think>oops'), [
      { type: 'text', text: 'hello' },
      { type: 'text', text: '<think>oops' },
    ]);
  });

  test('empty reasoning block is dropped', () => {
    assert.deepEqual(parseThinkTags('before<think></think>after'), [
      { type: 'text', text: 'before' },
      { type: 'text', text: 'after' },
    ]);
  });

  test('empty string → empty array (caller decides fallback)', () => {
    assert.deepEqual(parseThinkTags(''), []);
  });
});

// ============================================================
// codec/langchain.ts — normaliseContent
// ============================================================

describe('normaliseContent', () => {
  test('string → single text block', () => {
    assert.deepEqual(normaliseContent('hi'), [{ type: 'text', text: 'hi' }]);
  });
  test('empty array → empty text block', () => {
    assert.deepEqual(normaliseContent([]), [{ type: 'text', text: '' }]);
  });
  test('Anthropic tool_use → tool_call block', () => {
    const out = normaliseContent([{ type: 'tool_use', id: 'u1', name: 'shell', input: { cmd: 'ls' } }]);
    assert.deepEqual(out, [{ type: 'tool_call', name: 'shell', args: { cmd: 'ls' }, callId: 'u1' }]);
  });
  test('LC v1 reasoning block maps to reasoning', () => {
    const out = normaliseContent([{ type: 'reasoning', reasoning: 'thinking...' }]);
    assert.deepEqual(out, [{ type: 'reasoning', reasoning: 'thinking...' }]);
  });
  test('legacy `thinking` type (MiniMax M3 inline) maps to reasoning', () => {
    const out = normaliseContent([{ type: 'thinking', thinking: 'old form' }]);
    assert.deepEqual(out, [{ type: 'reasoning', reasoning: 'old form' }]);
  });
  test('unknown block type → non_standard wrapper, content preserved', () => {
    const odd = { type: 'audio', data: 'abc' };
    const out = normaliseContent([odd]) as Array<{ type: string; value: unknown }>;
    assert.equal(out[0].type, 'non_standard');
    assert.deepEqual(out[0].value, odd);
  });
});

// ============================================================
// codec/langchain.ts — baseMessageToMessage
// ============================================================

describe('baseMessageToMessage', () => {
  function lcMsg(overrides: Partial<LangChainMessage> = {}): LangChainMessage {
    return {
      constructor: { name: 'AIMessage' },
      content: 'hi',
      ...overrides,
    };
  }

  test('returns null for SystemMessage / SystemMessage2', () => {
    assert.equal(baseMessageToMessage({ constructor: { name: 'SystemMessage' }, content: 'sys' }, 's1'), null);
    assert.equal(baseMessageToMessage({ constructor: { name: 'SystemMessage2' }, content: 'sys' }, 's1'), null);
  });

  test('AIMessage → role=assistant, content normalised', () => {
    const row = baseMessageToMessage(lcMsg({ content: 'hello' }), 's1');
    assert.equal(row?.role, 'assistant');
    assert.deepEqual(row?.content, [{ type: 'text', text: 'hello' }]);
  });

  test('HumanMessage → role=user', () => {
    const row = baseMessageToMessage(lcMsg({ constructor: { name: 'HumanMessage' }, content: 'q' }), 's1');
    assert.equal(row?.role, 'user');
  });

  test('ToolMessage → role=tool, tool_call_id and name copied', () => {
    const row = baseMessageToMessage(
      lcMsg({ constructor: { name: 'ToolMessage' }, content: 'out', tool_call_id: 'tc-1', name: 'shell' }),
      's1',
    );
    assert.equal(row?.role, 'tool');
    assert.equal(row?.toolCallId, 'tc-1');
    assert.equal(row?.toolName, 'shell');
  });

  test('AIMessageChunk → role=assistant (treated same as AIMessage)', () => {
    const row = baseMessageToMessage(lcMsg({ constructor: { name: 'AIMessageChunk' }, content: 'chunk' }), 's1');
    assert.equal(row?.role, 'assistant');
  });

  test('tool_calls JSON string args get parsed', () => {
    const row = baseMessageToMessage(
      lcMsg({ tool_calls: [{ id: 'a', name: 'shell', args: '{"cmd":"ls"}' }] }),
      's1',
    );
    assert.deepEqual(row?.toolCalls?.[0].args, { cmd: 'ls' });
  });

  test('tool_calls object args pass through', () => {
    const row = baseMessageToMessage(
      lcMsg({ tool_calls: [{ id: 'a', name: 'shell', args: { cmd: 'pwd' } }] }),
      's1',
    );
    assert.deepEqual(row?.toolCalls?.[0].args, { cmd: 'pwd' });
  });

  test('usage_metadata → TokenUsage', () => {
    const row = baseMessageToMessage(
      lcMsg({ usage_metadata: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } }),
      's1',
    );
    assert.deepEqual(row?.usage, { inputTokens: 10, outputTokens: 20, totalTokens: 30 });
  });

  test('response_metadata → model + finishReason', () => {
    const row = baseMessageToMessage(
      lcMsg({ response_metadata: { model_name: 'MiniMax-M3', finish_reason: 'stop' } }),
      's1',
    );
    assert.equal(row?.model, 'MiniMax-M3');
    assert.equal(row?.finishReason, 'stop');
  });
});

// ============================================================
// service/stream/parser.ts — ThinkTagParser
// ============================================================

describe('ThinkTagParser', () => {
  test('plain text passes through', () => {
    const p = new ThinkTagParser();
    assert.deepEqual([...p.feed('hello world')], [{ kind: 'text', text: 'hello world' }]);
  });

  test('splits <think>...</think> into thinking + text', () => {
    const p = new ThinkTagParser();
    const deltas = [
      ...p.feed('before<think>inside</think>after'),
    ];
    assert.deepEqual(deltas, [
      { kind: 'text', text: 'before' },
      { kind: 'thinking', text: 'inside' },
      { kind: 'text', text: 'after' },
    ]);
  });

  test('marker straddling chunks is handled (state preserved)', () => {
    const p = new ThinkTagParser();
    const first = [...p.feed('hi<think>par')];
    const second = [...p.feed('tial</think>done')];
    assert.deepEqual(first, [{ kind: 'text', text: 'hi' }]);
    assert.deepEqual(second, [
      { kind: 'thinking', text: 'partial' },
      { kind: 'text', text: 'done' },
    ]);
  });

  test('flush() returns remaining buffer with correct kind', () => {
    const p = new ThinkTagParser();
    p.feed('foo<think>bar');  // unclosed
    assert.deepEqual([...p.flush()], [{ kind: 'thinking', text: 'bar' }]);
  });

  test('toContentBlocks rebuilds full structure from mirror', () => {
    const p = new ThinkTagParser();
    p.feed('a<think>b</think>c');
    assert.deepEqual(p.toContentBlocks(), [
      { type: 'text', text: 'a' },
      { type: 'reasoning', reasoning: 'b' },
      { type: 'text', text: 'c' },
    ]);
  });
});

// ============================================================
// service/stream/parser.ts — ToolCallAccumulator
// ============================================================

describe('ToolCallAccumulator', () => {
  test('completes when id+name+args all present', () => {
    const acc = new ToolCallAccumulator();
    assert.equal(acc.add({ id: 'c1' }), null);
    assert.equal(acc.add({ name: 'shell' }), null);
    const done = acc.add({ args: '{"cmd":"ls"}' });
    assert.deepEqual(done, { id: 'c1', name: 'shell', args: { cmd: 'ls' } });
  });

  test('drainAll flushes in-progress calls', () => {
    const acc = new ToolCallAccumulator();
    acc.add({ id: 'c1', name: 'shell', index: 0 });  // id+name, no args yet — stays in-progress
    acc.add({ id: 'c2', name: 'grep', args: '{}', index: 1 });  // complete, gets removed
    const drained = acc.drainAll();
    assert.equal(drained.length, 1);
    assert.equal(drained[0].id, 'c1');
    assert.deepEqual(drained[0].args, {});  // empty args → {}
  });
});

// ============================================================
// service/stream/parser.ts — StreamParser
// ============================================================

describe('StreamParser', () => {
  function aiChunk(content: string, toolCallChunks?: Array<{ name?: string; args?: string; id?: string; index?: number }>) {
    return { constructor: { name: 'AIMessageChunk' }, content, tool_call_chunks: toolCallChunks };
  }
  function toolMsg(toolCallId: string, name: string, content: string) {
    return { constructor: { name: 'ToolMessage' }, tool_call_id: toolCallId, name, content };
  }

  test('AIMessageChunk text → start + text_delta events', () => {
    const p = new StreamParser();
    const events = [...p.feed(aiChunk('hello'))];
    assert.equal(events[0].event, 'start');
    assert.equal(events[1].event, 'text_delta');
    assert.equal((events[1].data as { content: string }).content, 'hello');
  });

  test('AIMessageChunk with <think> → start + thinking_delta + text_delta', () => {
    const p = new StreamParser();
    const events = [...p.feed(aiChunk('a<think>b</think>c'))];
    const kinds = events.map((e) => e.event);
    assert.deepEqual(kinds, ['start', 'text_delta', 'thinking_delta', 'text_delta']);
  });

  test('tool_call_chunks accumulate, emit tool_call when complete', () => {
    const p = new StreamParser();
    const e1 = [...p.feed(aiChunk('', [{ id: 'c1' }]))];
    const e2 = [...p.feed(aiChunk('', [{ name: 'shell' }]))];
    const e3 = [...p.feed(aiChunk('', [{ args: '{"x":1}' }]))];
    assert.equal(e1.find((e) => e.event === 'tool_call'), undefined);
    assert.equal(e2.find((e) => e.event === 'tool_call'), undefined);
    assert.equal(e3.find((e) => e.event === 'tool_call')?.event, 'tool_call');
  });

  test('ToolMessage → tool_result event + collected in toolMessages', () => {
    const p = new StreamParser();
    const events = [...p.feed(toolMsg('c1', 'shell', 'out'))];
    assert.equal(events.find((e) => e.event === 'tool_result')?.event, 'tool_result');
    const f = p.finalize();
    assert.equal(f.toolMessages.length, 1);
    assert.equal(f.toolMessages[0].tool_call_id, 'c1');
  });

  test('finalize reconstructs AI message with text + reasoning + tool_call + tool_result blocks', () => {
    const p = new StreamParser();
    [...p.feed(aiChunk('before<think>think</think>after'))];
    [...p.feed(aiChunk('', [{ id: 'c1', name: 'shell', args: '{"x":1}' }]))];
    [...p.feed(toolMsg('c1', 'shell', 'result'))];
    const f = p.finalize();
    const types = f.aiMessage.content.map((b) => b.type);
    assert.deepEqual(types, ['text', 'reasoning', 'text', 'tool_call', 'tool_result']);
  });
});
