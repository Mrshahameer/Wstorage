import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { SearchAssistant } from "@/components/search-assistant";

export default async function AssistantPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <SearchAssistant />;
}
