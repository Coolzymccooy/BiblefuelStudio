/**
 * What to do about a failed webhook delivery, from the message the server
 * stored for it. The message alone ("Webhook failed: 400 Queue is full.") says
 * what Make answered, not how to fix it. Null when there is no clear advice.
 */
export function webhookAdvice(message: string | undefined): string | null {
    const text = String(message || '');
    if (!text) return null;
    if (/queue is full/i.test(text)) {
        return "Make has stopped taking posts because the scenario is off or out of operations. In Make, empty the webhook's queue first so old posts don't all go out at once, then turn the scenario on and press Test.";
    }
    if (/took longer than/i.test(text)) {
        return "Make or Zapier took too long to reply. Check the scenario's run history there, then press Test.";
    }
    // Live posts say "Webhook dispatch error: …"; the Test button says "Couldn't reach the webhook URL. …".
    if (/dispatch error|couldn't reach/i.test(text)) {
        return "Make or Zapier couldn't be reached. Check the URL, then press Test.";
    }
    // Live posts say "Webhook failed: 404 …"; the Test button says "Webhook returned HTTP 404. …".
    const status = Number(/Webhook (?:failed:|returned HTTP) (\d{3})/.exec(text)?.[1] || 0);
    if (status === 404 || status === 410) {
        return 'This webhook no longer exists in Make or Zapier. Add the new URL with Add another webhook, then remove this one.';
    }
    if (status === 401 || status === 403) {
        return 'Make or Zapier refused the post. Check the URL was copied in full.';
    }
    if (status >= 500) {
        return 'Make or Zapier had a problem on its side. It usually clears by itself; press Test later.';
    }
    return null;
}
