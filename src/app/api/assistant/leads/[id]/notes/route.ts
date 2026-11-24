import { NextRequest } from "next/server";
import { handleAssistant } from "@/lib/assistant/handle";
import { addAssistantLeadNote } from "@/lib/assistant/leads";

export async function POST(request: NextRequest) {
  return handleAssistant(request, "add_lead_note", (ctx) => addAssistantLeadNote(ctx));
}
