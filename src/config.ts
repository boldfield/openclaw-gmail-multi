export interface GogConfig {
  includeBody: boolean;
  maxBytes: number;
}

export interface HookConfig {
  model?: string;
  thinking?: string;
  sessionKey: string;
  prompt: string;
}

export interface AccountConfig {
  email: string;
  port: number;
  pubsubPath: string;
  token: string;
  gog: GogConfig;
  hooks: Record<string, HookConfig>;
}

export interface PluginConfig {
  accounts: Record<string, AccountConfig>;
}

export function parseConfig(raw: unknown): PluginConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("Plugin config must be an object");
  }

  const obj = raw as Record<string, unknown>;
  const rawAccounts = obj.accounts;

  if (!rawAccounts || typeof rawAccounts !== "object") {
    throw new Error("Plugin config must have an 'accounts' object");
  }

  const accountEntries = Object.entries(rawAccounts as Record<string, unknown>);
  if (accountEntries.length === 0) {
    throw new Error("Plugin config must have at least one account");
  }

  const seenPorts = new Map<number, string>();
  const accounts: Record<string, AccountConfig> = {};

  for (const [key, value] of accountEntries) {
    if (!value || typeof value !== "object") {
      throw new Error(`Account '${key}' must be an object`);
    }

    const acc = value as Record<string, unknown>;

    if (typeof acc.email !== "string" || !acc.email) {
      throw new Error(`Account '${key}' must have a non-empty 'email' string`);
    }
    if (typeof acc.port !== "number" || !Number.isInteger(acc.port)) {
      throw new Error(`Account '${key}' must have an integer 'port'`);
    }
    if (typeof acc.pubsubPath !== "string" || !acc.pubsubPath) {
      throw new Error(`Account '${key}' must have a non-empty 'pubsubPath' string`);
    }
    if (typeof acc.token !== "string" || !acc.token) {
      throw new Error(`Account '${key}' must have a non-empty 'token' string`);
    }

    const existingPortOwner = seenPorts.get(acc.port as number);
    if (existingPortOwner) {
      throw new Error(
        `Duplicate port ${acc.port}: accounts '${existingPortOwner}' and '${key}' both use it`
      );
    }
    seenPorts.set(acc.port as number, key);

    // Parse gog config with defaults
    const rawGog = (acc.gog as Record<string, unknown>) ?? {};
    const gog: GogConfig = {
      includeBody: typeof rawGog.includeBody === "boolean" ? rawGog.includeBody : true,
      maxBytes: typeof rawGog.maxBytes === "number" ? rawGog.maxBytes : 20000,
    };

    // Parse hooks
    const rawHooks = acc.hooks;
    if (!rawHooks || typeof rawHooks !== "object") {
      throw new Error(`Account '${key}' must have a 'hooks' object`);
    }

    const hookEntries = Object.entries(rawHooks as Record<string, unknown>);
    if (hookEntries.length === 0) {
      throw new Error(`Account '${key}' must have at least one hook`);
    }

    const hooks: Record<string, HookConfig> = {};
    for (const [hookName, hookValue] of hookEntries) {
      if (!hookValue || typeof hookValue !== "object") {
        throw new Error(`Hook '${hookName}' in account '${key}' must be an object`);
      }

      const h = hookValue as Record<string, unknown>;
      if (typeof h.sessionKey !== "string" || !h.sessionKey) {
        throw new Error(
          `Hook '${hookName}' in account '${key}' must have a non-empty 'sessionKey' string`
        );
      }
      if (typeof h.prompt !== "string" || !h.prompt) {
        throw new Error(
          `Hook '${hookName}' in account '${key}' must have a non-empty 'prompt' string`
        );
      }

      hooks[hookName] = {
        sessionKey: h.sessionKey as string,
        prompt: h.prompt as string,
        ...(typeof h.model === "string" ? { model: h.model } : {}),
        ...(typeof h.thinking === "string" ? { thinking: h.thinking } : {}),
      };
    }

    accounts[key] = {
      email: acc.email as string,
      port: acc.port as number,
      pubsubPath: acc.pubsubPath as string,
      token: acc.token as string,
      gog,
      hooks,
    };
  }

  return { accounts };
}
