import type { Address, Hex } from "viem";
import { findConversion, publishConversion, updateConversionStatus, type ArkivReader, type ArkivWriter } from "@numa/arkiv";
import type { ConversionSink } from "../services/indexer.js";

/** Arkiv-backed conversion sink: all Arkiv access for conversions goes through @numa/arkiv. */
export function arkivConversionSink(reader: ArkivReader, writer: ArkivWriter, writerAddress: Address): ConversionSink {
  return {
    async get(orderId: Hex) {
      const c = await findConversion(reader, { orderId, writer: writerAddress });
      return c ? { gross: c.gross } : undefined;
    },
    async publish(c) { await publishConversion(writer, c); },
    async setStatus(orderId, status) {
      const c = await findConversion(reader, { orderId, writer: writerAddress });
      if (c) await updateConversionStatus(writer, c.entityKey, status);
    },
  };
}
