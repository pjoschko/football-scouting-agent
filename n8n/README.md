# n8n Hello World Workflow

A minimal n8n workflow that proves the n8n environment for this project is
working end to end.

## What it does

1. **When clicking 'Execute workflow'** (Manual Trigger) — starts the
   workflow when you click "Execute workflow" in the n8n editor.
2. **Set Hello World** (Set node) — sets an output field `message` to the
   text `Hello World`.

The workflow contains no credentials or secrets, so it can be imported and
run in any n8n instance without further configuration.

## Import & run

1. Open your n8n instance.
2. Go to **Workflows** → **Add workflow** → **Import from File** (or use the
   "⋮" menu → **Import from File** on an existing workflow).
3. Select [`hello-world-workflow.json`](./hello-world-workflow.json) from
   this directory.
4. Open the imported workflow and click **Execute workflow**.
5. Open the **Set Hello World** node's output panel — the `message` field
   contains the text `Hello World`, confirming the workflow ran
   successfully.

Alternatively, with the [n8n CLI](https://docs.n8n.io/hosting/cli-commands/)
available:

```bash
n8n import:workflow --input=n8n/hello-world-workflow.json
```
