import { NextRequest } from "next/server";
import { handleAssistant } from "@/lib/assistant/handle";
import { lookupAssistantLeads } from "@/lib/assistant/leads";

export async function GET(request: NextRequest) {
  return handleAssistant(request, "lookup_lead", (ctx) => lookupAssistantLeads(ctx));
}
