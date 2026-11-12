import { getClient, llmAvailable, llmModel } from "@gtm/core";
import { PageHead } from "@/components/ui";
import { Chat } from "./chat";

export default async function ChatPage({ params }: { params: Promise<{ client: string }> }) {
  const { client } = await params;
  const c = getClient(client);
  const enabled = llmAvailable();
  return (
    <>
      <PageHead title="Ask the brain" lead={`Chat with ${c.name}'s brain. It can look up, score, enrich and draft, and it can propose brain changes. It cannot approve them.`}>
        <span className="pill">{enabled ? llmModel() : "No Anthropic key"}</span>
      </PageHead>
      <Chat client={client} enabled={enabled} />
    </>
  );
}
