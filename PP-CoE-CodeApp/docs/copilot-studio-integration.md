# Copilot Studio integration

The PP-CoE Code App ships with a global floating "CoE Assistant" chat panel
that talks to the **`msftcsa_PPCoEAgent`** Microsoft Copilot Studio agent
through the `shared_microsoftcopilotstudio` connector. **It is gated
behind a feature flag and ships disabled by default** so customers that
don't permit AI / Copilot Studio see no AI surface, no lazy chunk loads,
and the MCS connector is never contacted.

> **Source:** [Connect code apps to Copilot Studio](https://learn.microsoft.com/en-us/power-apps/developer/code-apps/how-to/connect-to-copilot-studio).
> This file captures the project-specific bits on top of the official doc.

## Turning it on

The feature flag lives at **Settings → Feature flags → CoE Assistant
(Copilot Studio)**. Flip the switch on to enable. The setting is per-user,
stored in `localStorage` (key: `ppcoe.featureFlag.copilotStudioAssistant`),
and persists across reloads.

When the flag is **off** (the default):

- The bottom-right floating FAB is not rendered.
- The lazy chunks for the launcher, panel, hook, and service wrapper are
  never fetched by the browser.
- No call to `MicrosoftCopilotStudioService` ever happens.

When the flag is **on**:

- The FAB appears on every route.
- Click it to open the slide-in chat panel and talk to the configured
  agent.

> 📦 The intent is to migrate this flag from local storage to a real
> environment variable once the team picks an approach (Dataverse
> environment variables read via the Power Platform SDK, or build-time
> `import.meta.env.VITE_*`). The Settings page is the contract; the
> storage backend is private and lives in `src/featureFlags/storage.ts`.
> See its `TODO(env-vars)` comment block for the migration sketch.

## How to point at a different agent

1. Publish the new agent in Copilot Studio.
2. Copy its `connectionId` (`pac connection list`) and its agent name
   (Copilot Studio → Channels → Web app URL — copy the `{agentName}`
   segment, e.g. `msftcsa_PPCoEAgent`; case-sensitive, includes the
   publisher prefix).
3. Run, from `PP-CoE-CodeApp/`:
   ```powershell
   pac code add-data-source -a "shared_microsoftcopilotstudio" -c <connectionId>
   ```
   ⚠️ `pac` does **not** remove pre-existing `shared_microsoftcopilotstudio`
   connection-reference blocks from `power.config.json` — if you're
   swapping connections, delete the old block manually so only one
   entry remains.
4. Update `AGENT_NAME` in `src/services/copilotStudio.ts`.
5. `npm run build` to verify, then `npm run dev`.

## Prerequisites

- A **published** Microsoft Copilot Studio agent in the same Power Platform
  environment as the code app (`environmentId` in `power.config.json`).
- A `shared_microsoftcopilotstudio` connection in that environment. Check
  with:
  ```powershell
  pac connection list
  ```
  Look for the row whose `apiId` is
  `/providers/Microsoft.PowerApps/apis/shared_microsoftcopilotstudio`
  and copy its `connectionId` GUID. If none exists, create one from the
  Power Apps maker portal (Data → Connections → New connection).

## 1. Wire the connector into the code app

From the code-app project root (`PP-CoE-CodeApp/`), run:

```powershell
pac code add-data-source -a "shared_microsoftcopilotstudio" -c <connectionId>
```

That command:

- Rewrites `power.config.json` with a real GUID for the Copilot Studio
  connection reference (replacing the `TODO-REPLACE-WITH-MCS-CONNECTION-ID`
  placeholder we ship by default).
- Regenerates `.power/schemas/appschemas/dataSourcesInfo.ts` so the
  `shared_microsoftcopilotstudio` data source is known to the Power Apps
  SDK at runtime.
- Generates `src/generated/services/CopilotStudioService.ts` and
  `src/generated/models/CopilotStudioModel.ts`.

## 2. Configure the agent name

Open Copilot Studio → your agent → **Channels** → **Web app**. The
connection-string URL has the shape:

```
https://{id}.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/{agentName}/conversations?api-version=2022-03-01-preview
```

Copy the `{agentName}` segment (e.g. `cr3e1_coeAssistant`). It's
**case-sensitive** and usually carries a publisher prefix.

Paste it into `PP-CoE-CodeApp/src/services/copilotStudio.ts`:

```ts
export const AGENT_NAME = "cr3e1_coeAssistant"; // <- your value
```

Until you do this, the assistant panel still renders, but sending a message
throws a friendly setup error so you can't ship a half-configured build by
accident.

## 3. How the integration is wired

```
src/components/CopilotChat/
├── CopilotChatLauncher.tsx   # Bottom-right FAB, lazy-loads the panel.
├── CopilotChatPanel.tsx      # Slide-in panel + message list + composer.
└── index.ts

src/services/
└── copilotStudio.ts          # Wrapper over the generated service:
                              #   - holds AGENT_NAME
                              #   - normalises conversationId casing
                              #   - threads conversationId across turns
                              #   - opportunistically JSON.parse()s responses[0]
                              #   - hides the positional vs. object-shaped
                              #     ExecuteCopilotAsyncV2 signature mismatch.
```

`App.tsx` mounts `<CopilotChatLauncher />` once, outside `<main>`, so the
FAB persists across every route. Both the launcher and the panel are
code-split (`lazy(() => import(...))`) — the chat code never enters the
initial bundle.

The panel keeps a `useRef` of the connector-allocated `conversationId` and
passes it on every follow-up turn so the agent treats subsequent messages
as part of the same dialog. Clearing the conversation resets the ref so
the next message starts a new dialog.

All agent calls go through `ExecuteCopilotAsyncV2`
(`/proactivecopilot/executeAsyncV2`). The doc warns explicitly that the
other variants are broken: `ExecuteCopilot` is fire-and-forget, and
`ExecuteCopilotAsync` is known to return 502s.

### Generated client gotchas

The official learn-doc snippet shows an object-shaped signature
(`{ message, notificationUrl, agentName }`). The connector schema this
tenant actually receives is positional and uses a different class name:

```ts
MicrosoftCopilotStudioService.ExecuteCopilotAsyncV2(
  Copilot: string,             // == agent name (URL path segment)
  body: { message: string; notificationUrl: string; ... },
  x_ms_conversation_id?: string,
  environmentId?: string,
): Promise<IOperationResult<void>>
```

The wrapper in `src/services/copilotStudio.ts` papers over this so
callers can keep working with the simpler logical model. The wrapper also
casts `result.data` from `void` to the real response shape — the
connector swagger doesn't declare a 201 body, but the SDK still passes
the response through at runtime.

## 4. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `Copilot Studio agent is not configured yet…` thrown on send | You still have the TODO placeholder in `AGENT_NAME`. Fill it in. |
| Build errors mentioning `MicrosoftCopilotStudioService` | The connector data source isn't registered. Either run `pac code add-data-source -a shared_microsoftcopilotstudio -c <connectionId>`, or make sure `power.config.json` still has the `shared_microsoftcopilotstudio` `connectionReferences` entry so the Vite plugin can regenerate the client on `npm run build`. |
| Agent returns nothing | Make sure the agent is **published**, the agent name matches exactly (case-sensitive, with publisher prefix), and the agent has topics that handle the message you sent. |
| `conversationId` looks blank in the response | The connector inconsistently casings it as `conversationId` / `ConversationId` / `conversationID`. The wrapper already coalesces all three into `reply.conversationId` — read that, not `reply.raw.conversationId`. |
| Agent returns a JSON blob as a string | Read `reply.parsed` instead of `reply.text`. The wrapper attempts `JSON.parse` on `responses[0]` when it looks like JSON. |

## 5. Roadmap

The current wrapper supports single-turn send/receive. Natural follow-ups:

- **Route-aware context.** From e.g. `AgentDetail.tsx`, pass the selected
  record's `objectid` and properties as a JSON-stringified message so the
  agent can answer "summarise this agent" without the user retyping the
  context.
- **Multi-turn conversation tracking.** Persist `conversationId` between
  sends to keep the agent in the same dialog.
- **Streaming.** `ExecuteCopilotAsyncV2` is synchronous-only today; if MS
  ships a streaming variant we should switch to it for long replies.
