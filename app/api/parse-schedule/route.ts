import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseScheduleImage, RecognitionError } from "@/lib/parse-schedule";
import {
  accountStore,
  accountUsage,
  accountFailure,
  signedInAccount,
} from "@/lib/account-access";

export const maxDuration = 120;
const ACCEPTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_BYTES = 15 * 1024 * 1024;
export async function POST(request: NextRequest) {
  let accountId = "",
    jobId = "",
    reserved = false;
  try {
    accountId = await signedInAccount();
    await accountUsage(accountId);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "請上傳課表圖片。" }, { status: 400 });
    }
    const image = form.get("image");
    if (!(image instanceof File) || !image.size)
      return NextResponse.json({ error: "請上傳課表圖片。" }, { status: 400 });
    if (!ACCEPTED_TYPES.has(image.type))
      return NextResponse.json(
        { error: "請使用 PNG、JPG、WEBP 或 GIF 圖片。" },
        { status: 400 },
      );
    if (image.size > MAX_BYTES)
      return NextResponse.json(
        { error: "圖片超過 15 MB，請先縮小圖片。" },
        { status: 400 },
      );
    const submitted = form.get("jobId");
    jobId = typeof submitted === "string" ? submitted : "";
    const buffer = Buffer.from(await image.arrayBuffer());
    const fingerprint = createHash("sha256").update(buffer).digest("hex");
    const job = await accountStore().begin(accountId, jobId, fingerprint);
    if (!job.started) {
      return NextResponse.json(
        {
          jobId,
          state: job.state,
          courses: job.courses ?? [],
          usage: await accountUsage(accountId),
        },
        {
          status:
            job.state === "running"
              ? 202
              : job.state === "succeeded" && job.courses
                ? 200
                : 409,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    reserved = true;
    const courses = await parseScheduleImage(
      { mimeType: image.type, base64: buffer.toString("base64") },
      { accountId, jobId, creditBucket: job.funding },
    );
    await accountStore().complete(accountId, jobId, courses);
    reserved = false;
    return NextResponse.json(
      {
        courses,
        usage: await accountUsage(accountId),
        model: "gpt-4o",
        jobId,
        state: "succeeded",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof RecognitionError) {
      const status =
        error.code === "logging_failed"
          ? 500
          : error.code === "model_timeout"
            ? 504
            : error.code === "model_unavailable"
              ? 503
              : error.code === "model_failed"
                ? 502
                : 422;
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
          courses: [],
        },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return accountFailure(error);
  } finally {
    if (reserved) {
      try {
        await accountStore().fail(accountId, jobId);
      } catch {
        console.error(
          "Unable to release recognition reservation; expiry will recover it.",
        );
      }
    }
  }
}
