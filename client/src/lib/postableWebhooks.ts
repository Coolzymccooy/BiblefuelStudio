/**
 * The server posts to a named webhook only while it is enabled, and fails
 * the post otherwise rather than sending it to another webhook (R40). So the
 * share panels offer enabled webhooks only, and the Settings test send names
 * a disabled webhook by its URL, not its id.
 */

interface SavedWebhook {
    id?: string;
    name?: string;
    url?: string;
    enabled?: boolean;
}

export function postableWebhooks(list: SavedWebhook[] | undefined): { id: string; name: string }[] {
    return (list || [])
        .filter((w) => w.enabled === true && w.id)
        .map((w) => ({ id: String(w.id), name: String(w.name || '') }));
}

export function testWebhookId(hook: SavedWebhook): string | undefined {
    return hook.enabled === true && hook.id ? hook.id : undefined;
}
