import { NextRequest } from "next/server";
import { createAssistantDraft, listAssistantDrafts } from "@/lib/assistant/drafts";
import { handleAssistant } from "@/lib/assistant/handle";

export async function GET(request: NextRequest) {
  return handleAssistant(request, "list_drafts", (ctx) => listAssistantDrafts(ctx));
}

export async function POST(request: NextRequest) {
  return handleAssistant(request, "create_draft", (ctx) => createAssistantDraft(ctx));
}
