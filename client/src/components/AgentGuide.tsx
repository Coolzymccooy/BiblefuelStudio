import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import guide from '../../../docs/mcp.md?raw';

// The guide's own H1 repeats the card title, so the page drops it. The comment line that splits
// the agent part from the setup part is for the server (react-markdown would show it as text).
const BODY = guide.replace(/^# .*\r?\n/, '').replace(/^<!--.*-->[ \t]*\r?$/gm, '');

const components: Components = {
    h2: ({ children }) => (
        <h4 className="text-base font-semibold text-bf-cream mt-8 mb-2 border-b border-white/5 pb-2">{children}</h4>
    ),
    h3: ({ children }) => <h5 className="text-sm font-semibold text-bf-cream mt-5 mb-1">{children}</h5>,
    p: ({ children }) => <p className="text-help my-2 max-w-[72ch]">{children}</p>,
    ul: ({ children }) => <ul className="text-help list-disc pl-5 my-2 space-y-1 max-w-[72ch]">{children}</ul>,
    ol: ({ children }) => <ol className="text-help list-decimal pl-5 my-2 space-y-1 max-w-[72ch]">{children}</ol>,
    strong: ({ children }) => <strong className="font-semibold text-bf-cream">{children}</strong>,
    a: ({ href, children }) => (
        <a href={href} className="text-primary-400 underline" target="_blank" rel="noreferrer">{children}</a>
    ),
    code: ({ children }) => <code className="font-mono text-primary-400">{children}</code>,
    pre: ({ children }) => (
        <pre className="my-3 overflow-x-auto rounded-lg border border-white/10 bg-white/5 p-3 font-mono text-xs leading-relaxed text-content-secondary [&>code]:text-inherit">
            {children}
        </pre>
    ),
    table: ({ children }) => (
        <div className="my-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs text-content-secondary">{children}</table>
        </div>
    ),
    th: ({ children }) => <th className="border-b border-white/10 px-2 py-1.5 font-semibold text-bf-cream">{children}</th>,
    td: ({ children }) => <td className="border-b border-white/5 px-2 py-1.5 align-top">{children}</td>,
};

/** The agent guide (docs/mcp.md), rendered at build time from the same file the server serves. */
export function AgentGuide() {
    return <Markdown remarkPlugins={[remarkGfm]} components={components}>{BODY}</Markdown>;
}
