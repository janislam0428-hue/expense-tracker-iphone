"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/session";
import { parseMultipleNotifications, type ParsedNotification } from "@/lib/parsers/notification";
import { ingestNotificationRecord } from "@/lib/parsers/ingest";

export type PastePreviewState = {
  ok?: boolean;
  error?: string;
  parsedList?: ParsedNotification[];
  rawText?: string;
} | undefined;

export async function previewNotificationText(
  _prev: PastePreviewState,
  formData: FormData,
): Promise<PastePreviewState> {
  await requireAuth();
  const text = String(formData.get("text") || "").trim();
  if (!text) return { error: "Please paste notification text first." };

  const parsedList = parseMultipleNotifications(text);
  if (parsedList.length === 0) {
    return {
      error: "Could not detect payment details. Make sure the text includes an amount and merchant/recipient.",
      rawText: text,
    };
  }

  return {
    ok: true,
    parsedList,
    rawText: text,
  };
}

export async function importNotificationRecords(
  _prev: { ok?: string; error?: string } | undefined,
  formData: FormData,
): Promise<{ ok?: string; error?: string } | undefined> {
  await requireAuth();
  const text = String(formData.get("rawText") || "").trim();
  if (!text) return { error: "No records to import." };

  const parsedList = parseMultipleNotifications(text);
  if (parsedList.length === 0) return { error: "No valid records found." };

  const batch = await db.importBatch.create({
    data: {
      channel: "paste",
      sourceHint: "Manual text paste",
      capturedAt: new Date(),
      added: 0,
      needsReview: 0,
    },
  });

  let added = 0;
  let duplicates = 0;
  let needsReview = 0;

  for (const item of parsedList) {
    const res = await ingestNotificationRecord(db, {
      parsed: item,
      channel: "paste",
      batchId: batch.id,
    });
    if (res.ok) {
      if (res.isDuplicate) duplicates++;
      else {
        added++;
        if (res.purposeStatus === "needs_review") needsReview++;
      }
    }
  }

  await db.importBatch.update({
    where: { id: batch.id },
    data: {
      added,
      skippedDuplicates: duplicates,
      needsReview,
    },
  });

  revalidatePath("/", "layout");
  return {
    ok: `Imported ${added} transaction(s). ${duplicates > 0 ? `(${duplicates} duplicate(s) skipped).` : ""} ${needsReview > 0 ? `${needsReview} waiting in To confirm.` : ""}`,
  };
}
