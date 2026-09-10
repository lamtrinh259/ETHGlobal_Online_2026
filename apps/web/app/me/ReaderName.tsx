"use client";

import Link from "next/link";
import type { Address } from "viem";
import type { Api } from "@/lib/api";
import { short } from "@/app/ui";
import { useReverse } from "@/lib/hooks";

/**
 * Who a permission was given to, said as a name.
 *
 * An address tells the holder nothing about who they shared with, and the whole point of having names
 * is not having to read one. A wallet that answers to no name falls back to the address, which is at
 * least true.
 */
export function ReaderName({ api, address }: { api: Api; address: Address }) {
  const reverse = useReverse(api, address);
  const name = reverse.data?.name;
  return (
    <span data-testid="reader-name">
      {name ? (
        <Link href={`/v/${name}`}>
          <code>{name}</code>
        </Link>
      ) : (
        <code>{short(address)}</code>
      )}
    </span>
  );
}
