import { describe, expect, it } from 'vitest';
import { postableWebhooks, testWebhookId } from './postableWebhooks';

describe('postableWebhooks', () => {
    it('offers only enabled webhooks, so the default choice is one the server will post to', () => {
        const list = [
            { id: 'w_off', name: 'Old Make', url: 'https://hook.make.com/a', enabled: false },
            { id: 'w_on', name: 'Zapier', url: 'https://hooks.zapier.com/b', enabled: true },
        ];
        expect(postableWebhooks(list)).toEqual([{ id: 'w_on', name: 'Zapier' }]);
    });

    it('tolerates a missing list', () => {
        expect(postableWebhooks(undefined)).toEqual([]);
    });
});

describe('testWebhookId', () => {
    it('names an enabled webhook by id, and tests a disabled one by its URL alone', () => {
        expect(testWebhookId({ id: 'w_on', enabled: true })).toBe('w_on');
        expect(testWebhookId({ id: 'w_off', enabled: false })).toBeUndefined();
        expect(testWebhookId({ enabled: true })).toBeUndefined();
    });
});
