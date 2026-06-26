import { redirect } from "next/navigation";

// The app has no marketing landing page yet — send the root straight into the
// app. /dashboard is gated by the (app) layout, which bounces unauthenticated
// users to /onboarding → /sign-in as appropriate.
export default function Home() {
  redirect("/dashboard");
}
