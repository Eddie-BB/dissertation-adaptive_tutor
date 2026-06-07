/**
 * Thin adapter helpers for text and structured scoring generation.
 *
 * Adapters never own simulation logic. They only transform explicit contracts
 * into text or structured JSON payloads.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCAL_ENV_PATH = path.resolve(__dirname, '../../../../.env');
const LOCAL_ENV_OVERRIDE_KEYS = new Set([
  'OPENAI_API_KEY',
  'OPENAI_PROJECT_ID',
  'OPENAI_ORG_ID',
  'OPENAI_BASE_URL',
  'OPENAI_APPRAISAL_MODEL',
  'OPENAI_STUDENT_TEXT_MODEL',
  'OPENAI_TEACHER_MESSAGE_MODEL',
  'OPENAI_STATE_AWARE_APPRAISAL_MODEL',
  'OPENAI_ANSWER_EVALUATOR_MODEL',
  'OPENAI_TIMEOUT_MS',
  'OPENAI_MAX_RETRIES',
  'OPENAI_RETRY_DELAY_MS',
  'OATUTOR_ANSWER_EVALUATOR_MODE'
]);

let localEnvLoaded = false;
const DEFAULT_OPENAI_TIMEOUT_MS = 60000;
const DEFAULT_OPENAI_MAX_RETRIES = 2;
const DEFAULT_OPENAI_RETRY_DELAY_MS = 750;

function normalizeAdapterMessage(output, messageKeys = []) {
  if (typeof output === 'string' && output.trim().length > 0) {
    return output.trim();
  }

  if (!output || typeof output !== 'object') {
    return '';
  }

  for (const key of messageKeys) {
    const value = output[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return '';
}

function parseEnvLine(line = '') {
  const trimmed = String(line).trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex < 0) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  if (!key) {
    return null;
  }

  let value = trimmed.slice(separatorIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadLocalEnvFile() {
  if (localEnvLoaded) {
    return;
  }

  localEnvLoaded = true;

  if (!fs.existsSync(LOCAL_ENV_PATH)) {
    return;
  }

  const fileContents = fs.readFileSync(LOCAL_ENV_PATH, 'utf8');
  for (const line of fileContents.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }

    const shouldPreferLocalValue = LOCAL_ENV_OVERRIDE_KEYS.has(parsed.key);

    if (
      shouldPreferLocalValue
      || process.env[parsed.key] == null
      || process.env[parsed.key] === ''
    ) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

function getAdapterMetadata(adapter = null, metadata = {}) {
  return {
    adapter_id: adapter?.adapter_id || null,
    provider: adapter?.provider || null,
    model: adapter?.model || null,
    ...metadata
  };
}

function extractOpenAiResponseText(payload = {}) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim().length > 0) {
    return payload.output_text.trim();
  }

  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  const segments = [];

  for (const output of outputs) {
    const content = Array.isArray(output?.content) ? output.content : [];
    for (const item of content) {
      const textValue = item?.text || item?.value || '';
      if ((item?.type === 'output_text' || item?.type === 'text') && typeof textValue === 'string') {
        segments.push(textValue);
      }
    }
  }

  return segments.join('\n').trim();
}

function safePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createOpenAiHttpError(status, responseText) {
  const error = new Error(`OpenAI Responses API error ${status}: ${responseText}`);
  error.status = status;
  return error;
}

function isRetryableOpenAiError(error) {
  const status = Number(error?.status);
  if (Number.isFinite(status)) {
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }

  const message = String(error?.message || '').toLowerCase();
  return (
    error?.name === 'AbortError'
    || message.includes('timeout')
    || message.includes('timed out')
    || message.includes('econnreset')
    || message.includes('socket')
    || message.includes('upstream connect error')
    || message.includes('disconnect/reset')
  );
}

async function callOpenAiResponsesApi({
  apiKey,
  project = null,
  organization = null,
  baseUrl = 'https://api.openai.com/v1',
  model,
  prompt = {},
  jsonSchema = null,
  timeoutMs = DEFAULT_OPENAI_TIMEOUT_MS,
  maxOutputTokens = 800,
  maxRetries = DEFAULT_OPENAI_MAX_RETRIES,
  retryDelayMs = DEFAULT_OPENAI_RETRY_DELAY_MS
} = {}) {
  const trimmedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  const trimmedProject = typeof project === 'string' ? project.trim() : '';
  const trimmedOrganization = typeof organization === 'string' ? organization.trim() : '';
  const safeTimeoutMs = safePositiveInteger(timeoutMs, DEFAULT_OPENAI_TIMEOUT_MS);
  const safeMaxRetries = safePositiveInteger(maxRetries, DEFAULT_OPENAI_MAX_RETRIES);
  const safeRetryDelayMs = safePositiveInteger(retryDelayMs, DEFAULT_OPENAI_RETRY_DELAY_MS);

  if (!trimmedApiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const endpoint = `${String(baseUrl).replace(/\/$/, '')}/responses`;

  const requestBody = {
    model,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: prompt.system || '' }]
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: prompt.user || '' }]
      }
    ],
    temperature: 0,
    max_output_tokens: maxOutputTokens
  };

  if (jsonSchema) {
    requestBody.text = {
      format: {
        type: 'json_schema',
        name: jsonSchema.name || 'structured_output',
        strict: true,
        schema: jsonSchema.schema
      }
    };
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${trimmedApiKey}`
  };

  if (trimmedProject) {
    headers['OpenAI-Project'] = trimmedProject;
  }

  if (trimmedOrganization) {
    headers['OpenAI-Organization'] = trimmedOrganization;
  }

  let lastError = null;
  const attemptCount = safeMaxRetries + 1;
  for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), safeTimeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw createOpenAiHttpError(response.status, responseText);
      }

      const payload = JSON.parse(responseText);
      const outputText = extractOpenAiResponseText(payload);
      if (!outputText) {
        throw new Error('OpenAI Responses API returned no structured output text');
      }

      return outputText;
    } catch (error) {
      lastError = error;
      if (attempt >= attemptCount || !isRetryableOpenAiError(error)) {
        break;
      }

      await sleep(safeRetryDelayMs * attempt);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  if (safeMaxRetries > 0 && isRetryableOpenAiError(lastError)) {
    throw new Error(`${lastError.message} after ${attemptCount} attempts`);
  }

  throw lastError;
}

function normalizeStructuredOutput(rawOutput) {
  if (!rawOutput) {
    return null;
  }

  if (typeof rawOutput === 'object') {
    return rawOutput;
  }

  if (typeof rawOutput === 'string') {
    try {
      return JSON.parse(rawOutput);
    } catch (_error) {
      return null;
    }
  }

  return null;
}

export function createFunctionModelAdapter(generate, options = {}) {
  if (typeof generate !== 'function') {
    return null;
  }

  return {
    adapter_id: options.adapter_id || 'function_adapter',
    mode: options.mode || 'mock',
    async generate(contract) {
      return generate(contract);
    }
  };
}

export function createLegacyHookAdapter(hook, options = {}) {
  if (typeof hook !== 'function') {
    return null;
  }

  return createFunctionModelAdapter(hook, {
    adapter_id: options.adapter_id || 'legacy_hook',
    mode: options.mode || 'legacy_hook'
  });
}

export function createOpenAiStructuredJsonAdapter(options = {}) {
  loadLocalEnvFile();

  const apiKey = (
    options.apiKey
    || process.env.OPENAI_API_KEY
    || null
  );
  const project = (
    options.project
    || process.env.OPENAI_PROJECT_ID
    || null
  );
  const organization = (
    options.organization
    || process.env.OPENAI_ORG_ID
    || null
  );
  const model = (
    options.model
    || (options.modelEnvKey ? process.env[options.modelEnvKey] : null)
    || process.env.OPENAI_APPRAISAL_MODEL
    || 'gpt-4.1-mini'
  );
  const baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const timeoutMs = options.timeoutMs || process.env.OPENAI_TIMEOUT_MS || DEFAULT_OPENAI_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? process.env.OPENAI_MAX_RETRIES ?? DEFAULT_OPENAI_MAX_RETRIES;
  const retryDelayMs =
    options.retryDelayMs ?? process.env.OPENAI_RETRY_DELAY_MS ?? DEFAULT_OPENAI_RETRY_DELAY_MS;
  const maxOutputTokens = options.maxOutputTokens || 800;
  const promptBuilder = options.promptBuilder;
  const jsonSchema = options.jsonSchema || null;

  if (!apiKey || typeof promptBuilder !== 'function') {
    return null;
  }

  return {
    adapter_id: options.adapter_id || 'openai_structured_json',
    mode: options.mode || 'openai_responses_json_schema',
    provider: 'openai',
    model,
    async generate(contract) {
      const prompt = promptBuilder(contract);
      return callOpenAiResponsesApi({
        apiKey,
        project,
        organization,
        baseUrl,
        model,
        prompt,
        jsonSchema,
        timeoutMs,
        maxRetries,
        retryDelayMs,
        maxOutputTokens
      });
    }
  };
}

export async function generateTextWithAdapter(adapter, contract, options = {}) {
  const {
    message_keys = ['message', 'text'],
    fallback_text = '',
    fallback_mode = 'fallback',
    metadata = {}
  } = options;

  if (!adapter || typeof adapter.generate !== 'function') {
    return {
      message: fallback_text,
      adapter_metadata: {
        adapter_id: null,
        generation_mode: fallback_mode,
        used_fallback: true,
        raw_output_type: 'none',
        ...metadata
      }
    };
  }

  try {
    const rawOutput = await adapter.generate(contract);
    const message = normalizeAdapterMessage(rawOutput, message_keys);
    if (message) {
      return {
        message,
        adapter_metadata: {
          ...getAdapterMetadata(adapter, {
            generation_mode: adapter.mode || 'adapter',
            used_fallback: false,
            raw_output_type: typeof rawOutput,
            ...metadata
          })
        }
      };
    }

    return {
      message: fallback_text,
      adapter_metadata: {
        ...getAdapterMetadata(adapter, {
          generation_mode: fallback_mode,
          used_fallback: true,
          raw_output_type: typeof rawOutput,
          error: 'empty_adapter_output',
          ...metadata
        })
      }
    };
  } catch (error) {
    return {
      message: fallback_text,
      adapter_metadata: {
        ...getAdapterMetadata(adapter, {
          generation_mode: fallback_mode,
          used_fallback: true,
          raw_output_type: 'error',
          error: error.message,
          ...metadata
        })
      }
    };
  }
}

export async function generateStructuredDataWithAdapter(adapter, contract, options = {}) {
  const {
    fallback_data = null,
    fallback_mode = 'fallback',
    metadata = {}
  } = options;

  if (!adapter || typeof adapter.generate !== 'function') {
    return {
      data: fallback_data,
      adapter_metadata: {
        ...getAdapterMetadata(adapter, {
          generation_mode: fallback_mode,
          used_fallback: true,
          raw_output_type: 'none',
          ...metadata
        })
      }
    };
  }

  try {
    const rawOutput = await adapter.generate(contract);
    const data = normalizeStructuredOutput(rawOutput);

    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return {
        data,
        adapter_metadata: {
          ...getAdapterMetadata(adapter, {
            generation_mode: adapter.mode || 'adapter',
            used_fallback: false,
            raw_output_type: typeof rawOutput,
            ...metadata
          })
        }
      };
    }

    return {
      data: fallback_data,
      adapter_metadata: {
        ...getAdapterMetadata(adapter, {
          generation_mode: fallback_mode,
          used_fallback: true,
          raw_output_type: typeof rawOutput,
          error: 'invalid_structured_output',
          ...metadata
        })
      }
    };
  } catch (error) {
    return {
      data: fallback_data,
      adapter_metadata: {
        ...getAdapterMetadata(adapter, {
          generation_mode: fallback_mode,
          used_fallback: true,
          raw_output_type: 'error',
          error: error.message,
          ...metadata
        })
      }
    };
  }
}

export default {
  createFunctionModelAdapter,
  createLegacyHookAdapter,
  createOpenAiStructuredJsonAdapter,
  generateTextWithAdapter,
  generateStructuredDataWithAdapter
};
