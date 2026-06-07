import assert from 'node:assert/strict';
import test from 'node:test';

import { createOpenAiStructuredJsonAdapter } from '../src/sim/lib/learner/modelAdapters.js';

function createAdapter(options = {}) {
  return createOpenAiStructuredJsonAdapter({
    apiKey: 'test-key',
    model: 'test-model',
    timeoutMs: 1000,
    retryDelayMs: 1,
    promptBuilder() {
      return {
        system: 'Return JSON.',
        user: '{"task":"test"}'
      };
    },
    jsonSchema: {
      name: 'test_payload',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' }
        },
        required: ['ok']
      }
    },
    ...options
  });
}

function createResponse({ ok, status = 200, body }) {
  return {
    ok,
    status,
    async text() {
      return body;
    }
  };
}

test('OpenAI adapter retries transient 503 errors before succeeding', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return createResponse({ ok: false, status: 503, body: 'upstream timeout' });
    }

    return createResponse({
      ok: true,
      body: JSON.stringify({ output_text: '{"ok":true}' })
    });
  };

  try {
    const adapter = createAdapter({ maxRetries: 2 });
    const output = await adapter.generate({});

    assert.equal(output, '{"ok":true}');
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAI adapter does not retry non-transient HTTP errors', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    return createResponse({ ok: false, status: 400, body: 'bad request' });
  };

  try {
    const adapter = createAdapter({ maxRetries: 2 });

    await assert.rejects(
      () => adapter.generate({}),
      /OpenAI Responses API error 400: bad request/
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
