'use client';

import { Button } from '@campuspilot/ui/components/button';
import { Label } from '@campuspilot/ui/components/label';

import { CopyValueField } from './copy-value-field';

const KEY_PLACEHOLDER = '<your API key>';

/**
 * Ready-to-paste client configurations. Both header styles are accepted by the
 * MCP endpoint; when both are sent, `x-api-key` wins.
 */
function apiKeySnippets(mcpUrl: string, key: string) {
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      value: `claude mcp add --transport http campuspilot ${mcpUrl} --header "x-api-key: ${key}"`,
    },
    {
      id: 'cursor',
      label: 'Cursor (mcp.json)',
      value: JSON.stringify(
        {
          mcpServers: {
            campuspilot: {
              url: mcpUrl,
              headers: { Authorization: `Bearer ${key}` },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: 'vscode',
      label: 'VS Code (mcp.json)',
      value: JSON.stringify(
        {
          servers: {
            campuspilot: {
              type: 'http',
              url: mcpUrl,
              headers: { Authorization: `Bearer ${key}` },
            },
          },
        },
        null,
        2,
      ),
    },
  ];
}

/** Explains where a key is used: the MCP URL plus per-client snippets. */
export function ApiKeyUsage({
  mcpUrl,
  apiKey,
}: {
  mcpUrl: string;
  /** The just-created secret; omitted afterwards, when a placeholder is shown. */
  apiKey?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="api-key-mcp-url">MCP server URL</Label>
        <CopyValueField
          id="api-key-mcp-url"
          value={mcpUrl}
          label="Copy MCP server URL"
        />
      </div>
      {apiKeySnippets(mcpUrl, apiKey ?? KEY_PLACEHOLDER).map((snippet) => (
        <div key={snippet.id} className="flex flex-col gap-2">
          <Label htmlFor={`api-key-snippet-${snippet.id}`}>{snippet.label}</Label>
          <CopyValueField
            id={`api-key-snippet-${snippet.id}`}
            value={snippet.value}
            label={`Copy ${snippet.label} configuration`}
            multiline
          />
        </div>
      ))}
    </div>
  );
}

/** One-time display of a newly created secret and how to use it. */
export function CreatedApiKey({
  apiKey,
  mcpUrl,
  onDismiss,
}: {
  apiKey: string;
  mcpUrl: string;
  onDismiss: () => void;
}) {
  return (
    <section
      aria-label="New API key"
      className="flex flex-col gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Copy your new API key</p>
          <p className="mt-1 text-xs text-muted-foreground">
            It is shown only once. Store it somewhere secure.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          Done
        </Button>
      </div>
      <CopyValueField id="api-key-secret" value={apiKey} label="Copy API key" />
      <ApiKeyUsage mcpUrl={mcpUrl} apiKey={apiKey} />
    </section>
  );
}
