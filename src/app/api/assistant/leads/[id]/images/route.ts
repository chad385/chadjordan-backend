import { NextRequest } from "next/server";
import { handleAssistant } from "@/lib/assistant/handle";
import { addAssistantLeadImage } from "@/lib/assistant/leads";

const ASSISTANT_IMAGE_MAX_BODY_BYTES = 6 * 1024 * 1024;

export async function POST(request: NextRequest) {
  return handleAssistant(request, "add_lead_image", (ctx) => addAssistantLeadImage(ctx), {
    maxBodyBytes: ASSISTANT_IMAGE_MAX_BODY_BYTES,
  });
}
