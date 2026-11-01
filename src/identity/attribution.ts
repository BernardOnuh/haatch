import { Attribution } from "ox/erc8021";
import type { Hex } from "viem";

/**
 * ERC-8021 transaction attribution (required by the Agents on Open Rails hackathon).
 *
 * The code (from your Loops registration) is appended to the calldata of every transaction
 * haatch sends, e.g. the ERC-8004 registration: `<code bytes><length><schema 0><0x8021…8021>`.
 * x402 payments are exempt (the facilitator submits them; tags aren't supported there yet).
 */
export function attributionSuffix(code: string | undefined): Hex {
  if (!code?.trim()) {
    throw new Error(
      "ATTRIBUTION_CODE is not set. Untagged transactions can't be credited later — add your Loops ERC-8021 code first.",
    );
  }
  return Attribution.toDataSuffix({ codes: [code.trim()] }) as Hex;
}

/** Reads the attribution codes back out of a transaction's calldata (for verification). */
export function readAttribution(calldata: Hex): readonly string[] | undefined {
  try {
    return Attribution.fromData(calldata)?.codes;
  } catch {
    return undefined;
  }
}
