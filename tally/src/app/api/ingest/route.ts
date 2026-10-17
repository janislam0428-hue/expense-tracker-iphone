import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { ensureDatabaseInitialized } from "@/lib/db-init";
import { ingestNotificationRecord } from "@/lib/parsers/ingest";
import { parseMultipleNotifications } from "@/lib/parsers/notification";
import { normalizeMerchant } from "@/lib/text";

function sha256(str: string): Buffer {
  return createHash("sha256").update(str).digest();
}

/**
 * Validates the bearer token against Settings.apiTokenHash or fallback.
 */
async function verifyApiToken(token: string | null): Promise<boolean> {
  if (!token) return false;
  await ensureDatabaseInitialized();
  const settings = await db.settings.findUnique({ where: { id: 1 }, select: { apiTokenHash: true } });

  const candidateHash = sha256(token.trim());

  if (settings?.apiTokenHash) {
    const expected = Buffer.from(settings.apiTokenHash, "hex");
    return expected.length === candidateHash.length && timingSafeEqual(expected, candidateHash);
  }

  // Fallback if token has not yet been generated in Settings:
  // Accept APP_PASSWORD or local default token so local testing works immediately.
  const appPw = (process.env.APP_PASSWORD || "tally").trim().replace(/^["']+|["']+$/g, "");
  const defaultToken = "tally_secret_token";
  return token === appPw || token === defaultToken;
}

export async function GET() {
  await ensureDatabaseInitialized();
  return NextResponse.json({
    ok: true,
    status: "Tally Ingest API ready",
    timestamp: new Date().toISOString(),
    guide: "POST notification text or JSON with Authorization: Bearer <token>",
  });
}

export async function POST(req: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    // 1. Authenticate token from Header, Query, or Body
    const authHeader = req.headers.get("authorization") || "";
    let token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    if (!token) {
      token = req.nextUrl.searchParams.get("token");
    }

    let rawText = "";
    let payloadJson: Record<string, unknown> | null = null;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      try {
        payloadJson = await req.json();
        if (!token && typeof payloadJson?.token === "string") {
          token = payloadJson.token;
        }
      } catch {
        return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
      }
    } else {
      rawText = await req.text();
    }

    const isAuthed = await verifyApiToken(token);
    if (!isAuthed) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized. Provide a valid Bearer token in the Authorization header or ?token= query parameter.",
        },
        { status: 401 },
      );
    }

    // 2. Direct structured fields support (e.g. from Apple Wallet automation, even if Merchant is omitted by iOS)
    if (payloadJson) {
      const directAmount = payloadJson.Amount ?? payloadJson.amount ?? payloadJson.value;
      const directMerchant = payloadJson.Merchant ?? payloadJson.merchant ?? payloadJson.payee ?? payloadJson.name;
      const directCard = payloadJson.Card ?? payloadJson.card ?? payloadJson.source ?? payloadJson.pass;

      if (directAmount !== undefined && String(directAmount).trim() !== "") {
        const numericAmount = parseFloat(String(directAmount).replace(/[^0-9.]/g, ""));
        if (!Number.isNaN(numericAmount) && numericAmount > 0) {
          const amountMinor = Math.round(numericAmount * 100);
          const cardName = String(directCard || "Octopus").trim() || "Octopus";
          const isOctopus = cardName.toLowerCase().includes("octopus") || cardName.includes("八達通");
          const merchant =
            directMerchant && String(directMerchant).trim() !== ""
              ? String(directMerchant).trim()
              : isOctopus
                ? "Octopus Purchase"
                : `${cardName} Purchase`;

          const result = await ingestNotificationRecord(db, {
            parsed: {
              amountMinor,
              currency: String(payloadJson.Currency ?? payloadJson.currency ?? "HKD"),
              merchant,
              merchantNormalized: normalizeMerchant(merchant),
              type: "expense",
              sourceName: isOctopus ? "Octopus" : cardName,
              sourceKind: isOctopus ? "octopus" : "credit_card",
              datePrecision: "minute",
              isPersonToPerson: false,
              confidence: 1.0,
              rawText: JSON.stringify(payloadJson),
            },
            channel: "shortcut",
          });

          return NextResponse.json(result);
        }
      }

      if (typeof payloadJson.text === "string") {
        rawText = payloadJson.text;
      } else if (typeof payloadJson.notification === "string") {
        rawText = payloadJson.notification;
      } else if (typeof payloadJson.body === "string") {
        rawText = payloadJson.body;
      } else if (Array.isArray(payloadJson.records)) {
        const batch = await db.importBatch.create({
          data: {
            channel: "shortcut",
            sourceHint: "iPhone 14 Pro Batch",
            capturedAt: new Date(),
          },
        });
        const results = [];
        for (const item of payloadJson.records) {
          const itemText = typeof item === "string" ? item : item?.text || "";
          if (itemText) {
            const r = await ingestNotificationRecord(db, { text: itemText, channel: "shortcut", batchId: batch.id });
            results.push(r);
          }
        }
        const addedCount = results.filter((r) => r.ok && !r.isDuplicate).length;
        const skippedCount = results.filter((r) => r.isDuplicate).length;
        const reviewCount = results.filter((r) => r.purposeStatus === "needs_review").length;
        await db.importBatch.update({
          where: { id: batch.id },
          data: { added: addedCount, skippedDuplicates: skippedCount, needsReview: reviewCount },
        });
        return NextResponse.json({
          ok: true,
          message: `Processed ${results.length} records. Added ${addedCount}.`,
          results,
        });
      }
    }

    if (!rawText.trim()) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing text. Provide 'text' in JSON or raw notification text in request body.",
          receivedKeys: payloadJson ? Object.keys(payloadJson) : [],
        },
        { status: 400 },
      );
    }

    // Check if multi-line notifications or Wallet screenshot list are present
    const multi = parseMultipleNotifications(rawText);
    if (multi.length > 1) {
      const batch = await db.importBatch.create({
        data: {
          channel: "shortcut",
          sourceHint: "iPhone 14 Pro Screenshot",
          capturedAt: new Date(),
        },
      });
      const results = [];
      for (const parsed of multi) {
        const r = await ingestNotificationRecord(db, { parsed, channel: "shortcut", batchId: batch.id });
        results.push(r);
      }
      const added = results.filter((r) => r.ok && !r.isDuplicate).length;
      const skipped = results.filter((r) => r.isDuplicate).length;
      const review = results.filter((r) => r.purposeStatus === "needs_review").length;
      await db.importBatch.update({
        where: { id: batch.id },
        data: { added, skippedDuplicates: skipped, needsReview: review },
      });
      return NextResponse.json({
        ok: true,
        message: `Imported ${added} transaction(s) from screenshot${skipped ? ` (${skipped} duplicate skipped)` : ""}.`,
        results,
      });
    }

    // Single notification ingestion
    const result = await ingestNotificationRecord(db, {
      parsed: multi[0],
      text: rawText,
      channel: "shortcut",
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.message,
          receivedText: rawText.slice(0, 300),
        },
        { status: 422 },
      );
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal Server Error";
    console.error("Ingest error:", err);
    return NextResponse.json({ ok: false, error: errorMsg }, { status: 500 });
  }
}
