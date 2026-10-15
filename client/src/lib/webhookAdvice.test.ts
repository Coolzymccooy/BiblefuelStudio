import { describe, expect, it } from 'vitest';
import { webhookAdvice } from './webhookAdvice';

describe('webhookAdvice', () => {
    it('a full Make queue says the scenario is off and to empty the queue first', () => {
        const advice = webhookAdvice('Webhook failed: 400 Queue is full.');
        expect(advice).toMatch(/scenario is off or out of operations/);
        expect(advice).toMatch(/empty the webhook's queue first/);
    });

    it('a webhook that no longer exists says to paste the new URL', () => {
        expect(webhookAdvice('Webhook failed: 410 There is no scenario listening for this webhook.')).toMatch(/no longer exists/);
        expect(webhookAdvice('Webhook failed: 404 Not Found')).toMatch(/no longer exists/);
    });

    it('a refused post says to check the URL', () => {
        expect(webhookAdvice('Webhook failed: 403 Forbidden')).toMatch(/copied in full/);
    });

    it('a server error on their side says to try later', () => {
        expect(webhookAdvice('Webhook failed: 502 Bad Gateway')).toMatch(/on its side/);
    });

    it('a slow reply and an unreachable URL each get their own advice', () => {
        expect(webhookAdvice('Webhook took longer than 10s to acknowledge — your Make/Zapier scenario may be doing too much work synchronously')).toMatch(/took too long/);
        expect(webhookAdvice('Webhook dispatch error: fetch failed')).toMatch(/couldn't be reached/);
    });

    it('anything else gets no advice', () => {
        expect(webhookAdvice('Webhook failed: 400 Something new')).toBeNull();
        expect(webhookAdvice('')).toBeNull();
        expect(webhookAdvice(undefined)).toBeNull();
    });
});
