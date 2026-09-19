import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({
  env: { OCR_AI: 'on' as 'on' | 'off', OPENAI_API_KEY: 'sk-test' as string | undefined },
}));
vi.mock('../src/config/env', () => config);
vi.mock('../src/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { isAiReaderEnabled, readInvoiceWithAI } from '../src/services/ai-reader';
import { aiFixture } from './fixtures/ai';

/**
 * The second reader is a paid call over the network, to a model that can
 * answer anything. Everything it can do badly — refuse the call, answer out
 * of shape, answer nothing, take too long — reads as "no second reading",
 * and the photo is the parser's alone (see photo-decision).
 */

const IMAGE = 'iVBORw0KGgoAAAANSUhEUg==';
const answered = (content: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  config.env.OCR_AI = 'on';
  config.env.OPENAI_API_KEY = 'sk-test';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const bodyOf = () => JSON.parse(fetchMock.mock.calls[0]?.[1].body as string);

describe('the model reader', () => {
  it('asks for one invoice, as an image, in the shape we can check', async () => {
    const fixture = aiFixture('minas281');
    fetchMock.mockResolvedValue(answered(fixture));

    const got = await readInvoiceWithAI('/9j/4AAQSkZJRg==');

    expect(got).toEqual(fixture);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const body = bodyOf();
    expect(body.model).toBe('gpt-4.1-mini');
    expect(body.temperature).toBe(0);
    expect(body.response_format.json_schema.strict).toBe(true);
    const image = body.messages[1].content[0];
    expect(image.image_url.url).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
    expect(image.image_url.detail).toBe('high');
  });

  it('sends a PNG as a PNG', async () => {
    fetchMock.mockResolvedValue(answered(aiFixture('minas281')));
    await readInvoiceWithAI('iVBORw0KGgo=');
    expect(bodyOf().messages[1].content[0].image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it.each([
    ['OpenAI refuses the call', { ok: false, status: 429, json: async () => ({}) }],
    ['the answer is not JSON', { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'no' } }] }) }],
    ['the answer is empty', { ok: true, status: 200, json: async () => ({ choices: [] }) }],
  ])('reads nothing when %s', async (_why, response) => {
    fetchMock.mockResolvedValue(response);
    await expect(readInvoiceWithAI(IMAGE)).resolves.toBeNull();
  });

  it('reads nothing when the answer is out of shape', async () => {
    const { total: _dropped, ...rest } = aiFixture('minas281');
    fetchMock.mockResolvedValue(answered({ ...rest, moneda: 'GUARANI' }));
    await expect(readInvoiceWithAI(IMAGE)).resolves.toBeNull();
  });

  it('reads nothing when the call fails or is cut off', async () => {
    fetchMock.mockRejectedValue(new Error('aborted'));
    await expect(readInvoiceWithAI(IMAGE)).resolves.toBeNull();
  });

  it('does not call OpenAI when the feature is off, or has no key', async () => {
    config.env.OCR_AI = 'off';
    expect(isAiReaderEnabled()).toBe(false);
    await expect(readInvoiceWithAI(IMAGE)).resolves.toBeNull();

    config.env.OCR_AI = 'on';
    config.env.OPENAI_API_KEY = undefined;
    expect(isAiReaderEnabled()).toBe(false);
    await expect(readInvoiceWithAI(IMAGE)).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
