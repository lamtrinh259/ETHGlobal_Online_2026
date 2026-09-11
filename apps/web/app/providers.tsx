"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { WebConfig } from "@/lib/config";

const ConfigContext = createContext<WebConfig | null>(null);

export function useWebConfig(): WebConfig {
  const c = useContext(ConfigContext);
  if (!c) throw new Error("useWebConfig outside Providers");
  return c;
}

/**
 * The providers every page sits inside.
 *
 * These used to withhold their children until after mount, so that react-query and Privy never ran
 * during SSR. It also meant no page had any server-rendered body at all: every reader without
 * JavaScript — a crawler, a link unfurler, an agent following a name — got a title and an empty
 * document, on a product whose whole claim is that a name can be read without its app. The pages that
 * matter are Server Components and never touch these hooks; the interactive parts hydrate as usual.
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
          {children}
        </PrivyProvider>
      </QueryClientProvider>
    </ConfigContext.Provider>
  );
}
