import { redirect } from "next/navigation";

/**
 * There is no anonymous landing page: every screen requires an authenticated
 * session (`docs/api-and-security.md:5`). `/my-work` is behind the authenticated
 * shell, which redirects to `/login` when there is no valid session, so this single
 * hop covers both cases.
 */
export default function HomePage() {
  redirect("/my-work");
}
