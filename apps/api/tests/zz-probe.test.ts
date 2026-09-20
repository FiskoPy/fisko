import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/services/ai-reader', () => ({ isAiReaderEnabled: () => true, readInvoiceWithAI: vi.fn() }));
import { readInvoiceWithAI } from '../src/services/ai-reader';
import { importPhoto } from '../src/modules/invoices/invoices.service';

describe('probe', () => {
  it('queue', async () => {
    vi.mocked(readInvoiceWithAI).mockResolvedValueOnce({ total: 1 } as never);
    console.log('direct call ->', await readInvoiceWithAI('x'));
    vi.mocked(readInvoiceWithAI).mockResolvedValueOnce({ total: 2 } as never);
    console.log('second ->', await readInvoiceWithAI('x'));
    expect(typeof importPhoto).toBe('function');
  });
});
