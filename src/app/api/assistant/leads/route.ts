import { NextRequest } from "next/server";
import { handleAssistant } from "@/lib/assistant/handle";
import { addAssistantLead } from "@/lib/assistant/leads";

export async function POST(request: NextRequest) {
  return handleAssistant(request, "add_lead", (ctx) => addAssistantLead(ctx));
}
