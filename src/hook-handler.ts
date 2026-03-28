import type { PluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { AccountConfig, HookConfig } from "./config.js";
import { renderTemplate } from "./template.js";

export function registerHooks(
  api: PluginApi,
  accounts: Record<string, AccountConfig>
): void {
  for (const [accountKey, accountConfig] of Object.entries(accounts)) {
    for (const [hookName, hookConfig] of Object.entries(accountConfig.hooks)) {
      const path = `/hooks/gmail-multi/${accountKey}/${hookName}`;

      api.registerHook(path, async (req) => {
        try {
          const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

          const context: Record<string, unknown> = {
            ...payload,
            account: {
              email: accountConfig.email,
              key: accountKey,
            },
          };

          const renderedPrompt = renderTemplate(hookConfig.prompt, context);

          const sessionOptions: Record<string, unknown> = {
            sessionKey: hookConfig.sessionKey,
          };
          if (hookConfig.model) {
            sessionOptions.model = hookConfig.model;
          }
          if (hookConfig.thinking) {
            sessionOptions.thinking = hookConfig.thinking;
          }

          await api.sendMessage(renderedPrompt, sessionOptions);

          api.log.info(
            `[${accountKey}/${hookName}] Dispatched message to session '${hookConfig.sessionKey}'`
          );
        } catch (err) {
          api.log.error(
            `[${accountKey}/${hookName}] Error processing hook: ${err}`
          );
        }

        // Always return 200 — don't make Pub/Sub retry on our errors
        return { status: 200, body: "ok" };
      });

      api.log.info(`Registered hook: ${path}`);
    }
  }
}
