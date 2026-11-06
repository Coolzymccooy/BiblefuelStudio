export function TimingQualityNotice({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return (
    <div role="note" aria-label="Caption timing evidence" className="space-y-1 text-xs text-bf-gold">
      {[...new Set(messages)].map((message) => <p key={message}>{message}</p>)}
    </div>
  );
}
