"use client";

import type { ReactNode } from "react";
import { explorerTx } from "@/lib/explorer";
import { Modal } from "./Modal";
import { useWebConfig } from "./providers";

/**
 * What a write ends in. Everything this portal publishes goes on chain, and the one claim a person
 * cannot check inside the app is that it actually landed — so the transaction is named, and the link
 * goes somewhere that is not us. A chain with no explorer gets the hash alone rather than a dead link.
 *
 * It sits over the page, never instead of it: the confirmation underneath — a view code above all —
 * is still there when this is closed.
 */
export function TxDone({
  title,
  hash,
  onClose,
  children,
}: {
  title: string;
  hash: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  const config = useWebConfig();
  const link = explorerTx(config.chainId, hash);

  return (
    <Modal title={title} onClose={onClose}>
      <div className="tx-done" data-testid="tx-done">
        <p className="tx-done-check" data-testid="tx-done-check" aria-hidden>
          ✓
        </p>
        <p>
          <code>{hash}</code>
        </p>
        {link && (
          <p>
            <a href={link} target="_blank" rel="noreferrer" data-testid="tx-done-link">
              View on explorer →
            </a>
          </p>
        )}
        {children}
      </div>
    </Modal>
  );
}
