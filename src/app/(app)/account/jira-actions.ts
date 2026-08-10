"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { disconnectJiraAccount } from "@/domain/jira-credentials";
import { failState, runAction, type FormState } from "@/ui/action";

/**
 * Disconnect the signed-in person's Jira account.
 *
 * Takes no input at all — deliberately. Whose credential is removed comes from the session,
 * never from the form, so no submitted field can be pointed at somebody else's connection.
 * That is the same rule the rest of this codebase applies to the actor's role.
 */
export async function disconnectJiraAction(): Promise<FormState> {
  const result = await runAction((actor) => disconnectJiraAccount(actor));

  if (!result.ok) return failState(result);

  // Both places the panel is mounted, plus the Lead's roster, which just changed.
  revalidatePath("/account");
  revalidatePath("/admin/integrations");
  redirect("/account?jira=disconnected");
}
