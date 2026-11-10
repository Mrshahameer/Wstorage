import { redirect } from "next/navigation";
import { getSessionUser, roleAtLeast } from "@/lib/auth";
import { SearchAssistant } from "@/components/search-assistant";

export default async function AssistantPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const canShare = roleAtLeast(user.role, "bd_manager");
  return <SearchAssistant canShare={canShare} userId={user.id} />;
}
