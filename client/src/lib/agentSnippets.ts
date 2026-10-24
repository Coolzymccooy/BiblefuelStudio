/**
 * The connection snippets from docs/mcp.md, pointed at this server's MCP
 * endpoint. They carry the literal text `<your key>` and nothing else: a real
 * key is never put into a snippet, not even straight after it was created.
 */

export interface AgentSnippet {
  id: 'hermes' | 'codex' | 'claude-code';
  title: string;
  /** One line on where it goes. */
  where: string;
  body: string;
}

export function buildSnippets(endpoint: string): AgentSnippet[] {
  return [
    {
      id: 'hermes',
      title: 'Hermes Agent',
      where: 'Add this to your Hermes config.yaml (run `hermes config path` to find it). Replace <your key> with your key.',
      body: [
        'mcp_servers:',
        '  biblefuel:',
        `    url: "${endpoint}"`,
        '    headers:',
        '      Authorization: "Bearer <your key>"',
        '    timeout: 120',
      ].join('\n'),
    },
    {
      id: 'codex',
      title: 'Codex',
      where: 'Add this to ~/.codex/config.toml, and put your key in the BIBLEFUEL_AGENT_KEY environment variable.',
      body: [
        '[mcp_servers.biblefuel]',
        `url = "${endpoint}"`,
        'bearer_token_env_var = "BIBLEFUEL_AGENT_KEY"',
      ].join('\n'),
    },
    {
      id: 'claude-code',
      title: 'Claude Code',
      where: 'Export your key, then add the server.',
      body: [
        'export BIBLEFUEL_AGENT_KEY="<your key>"',
        `claude mcp add --transport http biblefuel ${endpoint} --header "Authorization: Bearer \${BIBLEFUEL_AGENT_KEY}"`,
      ].join('\n'),
    },
  ];
}
