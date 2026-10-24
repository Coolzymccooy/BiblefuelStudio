import { CopyButton } from './CopyButton';
import { buildSnippets } from '../../lib/agentSnippets';

/** The MCP endpoint and one ready-to-paste snippet per agent. Snippets carry `<your key>`, never a real key. */
export function ConnectSnippets({ endpoint }: { endpoint: string }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <h4 className="text-sm font-semibold text-bf-cream">Endpoint</h4>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-editor-line bg-bf-input px-3 py-2 font-mono text-xs text-bf-cream">
            {endpoint}
          </code>
          <CopyButton text={endpoint} label="Copy endpoint URL" />
        </div>
      </div>

      {buildSnippets(endpoint).map((snippet) => (
        <div key={snippet.id} className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-bf-cream">{snippet.title}</h4>
            <CopyButton text={snippet.body} label={`Copy ${snippet.title} snippet`} />
          </div>
          <p className="text-help">{snippet.where}</p>
          <pre className="overflow-x-auto rounded-lg border border-editor-line bg-bf-input p-3 font-mono text-xs text-bf-cream">
            {snippet.body}
          </pre>
        </div>
      ))}
    </div>
  );
}
