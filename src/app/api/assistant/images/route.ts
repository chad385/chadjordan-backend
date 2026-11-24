import { NextRequest } from "next/server";
import { handleAssistant } from "@/lib/assistant/handle";
import { createAssistantImage } from "@/lib/assistant/images";

export async function POST(request: NextRequest) {
  return handleAssistant(request, "create_image", (ctx) => createAssistantImage(ctx));
}
