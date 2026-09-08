"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { WebConfig } from "@/lib/config";

const ConfigContext = createContext<WebConfig | null>(null);

export function useWebConfig(): WebConfig {
  const c = useContext(ConfigContext);
  if (!c) throw new Error("useWebConfig outside Providers");
  return c;
}

/**
 * Client-only providers. Children render only AFTER mount so react-query and Privy never execute
 * during SSR — the app is a client SPA behind a sign-in; only /v/<name> is server-rendered content
 * and it does not use these hooks.
 */
export function Providers({ config, children }: { config: WebConfig; children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => {
              const status = (err as { status?: number })?.status;
              if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
              return count < 3;
            },
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
          },
        },
      })
  );
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <ConfigContext.Provider value={config}>
      <QueryClientProvider client={client}>
        <PrivyProvider
          appId={config.privyAppId}
          clientId={config.privyClientId}
          config={{
            loginMethods: ["email", "google", "twitter", "github", "wallet"],
            embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
            appearance: { theme: "dark" },
          }}
        >
          {mounted ? children : null}
        </PrivyProvider>
      </QueryClientProvider>
    </ConfigContext.Provider>
  );
}
